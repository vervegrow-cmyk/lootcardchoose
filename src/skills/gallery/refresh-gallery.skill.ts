import { SkillContext, SkillHandler } from "../../hermes/types";
import {
  GallerySearchSessionRecord,
  gallerySearchSessionRepository,
} from "../../repositories/gallery-search-session.repository";
import { Prisma } from "@prisma/client";
import {
  GalleryCardDto,
  GalleryRefreshResult,
  RefreshPlannerSessionMetadata,
  galleryService,
} from "../../services/gallery.service";
import { detectPreferredLanguage } from "../../utils/gallery-language";
import { logger } from "../../utils/logger";

export type RefreshGalleryInput = {
  discordUserId: string;
  discordChannelId: string;
  currentMessage: string;
};

export type RefreshGalleryOutput = {
  query: string;
  language: SkillContext["language"];
  refreshMode: GalleryRefreshResult["refreshMode"];
  reason: string;
  shortQuestion?: string;
  results: GalleryCardDto[];
  limit: number;
  previousSessionFound: boolean;
  firstBatchCardIds: string[];
  secondBatchCardIds: string[];
  keep: string[];
  avoid: string[];
  broaden: string[];
  searchKeywords: string[];
};

const extractCardIds = (session: GallerySearchSessionRecord): string[] => {
  if (!Array.isArray(session.results)) {
    return [];
  }

  const isJsonObject = (value: Prisma.JsonValue): value is Prisma.JsonObject =>
    typeof value === "object" && value !== null && !Array.isArray(value);

  return session.results
    .filter(isJsonObject)
    .map((item) => (typeof item.id === "string" ? item.id : ""))
    .filter(Boolean);
};

const readSessionResultMetadata = (
  session: GallerySearchSessionRecord
): {
  batchIndex: number | null;
  refreshMode: string | null;
  originalQuery: string | null;
} => {
  if (!Array.isArray(session.results)) {
    return {
      batchIndex: null,
      refreshMode: null,
      originalQuery: null,
    };
  }

  const isJsonObject = (value: Prisma.JsonValue): value is Prisma.JsonObject =>
    typeof value === "object" && value !== null && !Array.isArray(value);

  const firstResult = session.results.find(isJsonObject);
  if (!firstResult) {
    return {
      batchIndex: null,
      refreshMode: null,
      originalQuery: null,
    };
  }

  return {
    batchIndex: typeof firstResult.batchIndex === "number" ? firstResult.batchIndex : null,
    refreshMode: typeof firstResult.refreshMode === "string" ? firstResult.refreshMode : null,
    originalQuery: typeof firstResult.originalQuery === "string" ? firstResult.originalQuery : null,
  };
};

export const refreshGallerySkill: SkillHandler<RefreshGalleryInput, RefreshGalleryOutput> = async (
  input,
  context
) => {
  logger.info("[REFRESH GALLERY SKILL] start");

  const previousSession = await gallerySearchSessionRepository.findLatest({
    discordUserId: input.discordUserId,
    discordChannelId: input.discordChannelId,
    status: "active",
  });

  if (!previousSession) {
    return {
      query: "",
      language: detectPreferredLanguage(input.currentMessage),
      refreshMode: "need_clarification",
      reason: "no previous search session",
      results: [],
      limit: 10,
      previousSessionFound: false,
      firstBatchCardIds: [],
      secondBatchCardIds: [],
      keep: [],
      avoid: [],
      broaden: [],
      searchKeywords: [],
    };
  }

  const recentSessions = await gallerySearchSessionRepository.findRecentByUserId({
    discordUserId: input.discordUserId,
    discordChannelId: input.discordChannelId,
    take: 20,
  });

  const excludeIds = Array.from(new Set(recentSessions.flatMap(extractCardIds)));
  const firstBatchCardIds = extractCardIds(previousSession);
  const recentActiveSessionCount = recentSessions.filter((session) => session.status === "active").length;
  const previousSessionMetadata = readSessionResultMetadata(previousSession);
  const recentRefreshModes = Array.from(
    new Set(
      recentSessions
        .map((session) => readSessionResultMetadata(session).refreshMode)
        .filter((value): value is string => Boolean(value))
    )
  );
  const sessionMetadata: RefreshPlannerSessionMetadata = {
    previousSessionId: previousSession.id,
    previousQuery: previousSession.query,
    originalQuery: previousSessionMetadata.originalQuery ?? previousSession.query,
    previousBatchSize: firstBatchCardIds.length,
    previousBatchCardIds: firstBatchCardIds,
    recentActiveSessionCount,
    totalExcludedCardCount: excludeIds.length,
    latestBatchIndex: previousSessionMetadata.batchIndex ?? recentSessions.length,
    recentRefreshModes,
    hasSelectedCard: Boolean(previousSession.selectedGalleryCardId),
  };
  logger.info("[REFRESH GALLERY SKILL] session metadata=" + JSON.stringify(sessionMetadata));

  const refreshResult = await galleryService.refreshGalleryCards({
    discordUserId: input.discordUserId,
    currentMessage: input.currentMessage,
    previousSession,
    excludeIds,
    limit: 10,
    sessionMetadata,
  });

  const secondBatchCardIds = refreshResult.cards.map((card) => card.id);

  if (refreshResult.cards.length > 0) {
    const archivedCount = await gallerySearchSessionRepository.archiveActiveSessions({
      discordUserId: input.discordUserId,
      discordChannelId: input.discordChannelId,
    });
    logger.info("[REFRESH GALLERY SKILL] archived active sessions", {
      discordUserId: input.discordUserId,
      discordChannelId: input.discordChannelId,
      archivedCount,
    });

    await gallerySearchSessionRepository.create({
      discordUserId: input.discordUserId,
      discordChannelId: input.discordChannelId,
      query: previousSession.query,
      results: refreshResult.cards.map((card) => ({
        id: card.id,
        title: card.title,
        description: card.description,
        imageUrl: card.imageUrl,
        price: card.price,
        tags: card.tags,
        language: refreshResult.language,
        batchIndex: recentSessions.length + 1,
        previousSessionId: previousSession.id,
        refreshMode: refreshResult.refreshMode,
        originalQuery: previousSession.query,
      })),
      status: "active",
    });
  }

  logger.info("[REFRESH GALLERY SKILL] completed");

  return {
    query: previousSession.query,
    language: refreshResult.language,
    refreshMode: refreshResult.refreshMode,
    reason: refreshResult.reason,
    shortQuestion: refreshResult.shortQuestion,
    results: refreshResult.cards,
    limit: refreshResult.limit,
    previousSessionFound: true,
    firstBatchCardIds,
    secondBatchCardIds,
    keep: refreshResult.keep,
    avoid: refreshResult.avoid,
    broaden: refreshResult.broaden,
    searchKeywords: refreshResult.searchKeywords,
  };
};
