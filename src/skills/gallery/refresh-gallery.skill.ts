import { Prisma } from "@prisma/client";
import { SkillContext, SkillHandler } from "../../hermes/types";
import {
  GalleryCardDto,
  GalleryRefreshResult,
  RefreshPlannerSessionMetadata,
  galleryService,
} from "../../services/gallery.service";
import { detectPreferredLanguage } from "../../utils/gallery-language";
import { logger } from "../../utils/logger";
import {
  GallerySearchSessionRecord,
  gallerySearchSessionRepository,
} from "../../repositories/gallery-search-session.repository";

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
  anchorSessionId: string | null;
  displaySessionId: string | null;
  poolExhausted: boolean;
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
  anchorSessionId: string | null;
} => {
  if (!Array.isArray(session.results)) {
    return {
      batchIndex: null,
      refreshMode: null,
      originalQuery: null,
      anchorSessionId: null,
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
      anchorSessionId: null,
    };
  }

  return {
    batchIndex: typeof firstResult.batchIndex === "number" ? firstResult.batchIndex : null,
    refreshMode: typeof firstResult.refreshMode === "string" ? firstResult.refreshMode : null,
    originalQuery: typeof firstResult.originalQuery === "string" ? firstResult.originalQuery : null,
    anchorSessionId: typeof firstResult.anchorSessionId === "string" ? firstResult.anchorSessionId : null,
  };
};

const isSparseRandomFallbackSession = (session: GallerySearchSessionRecord): boolean => {
  const metadata = readSessionResultMetadata(session);
  return metadata.refreshMode === "random_fallback" && extractCardIds(session).length < 3;
};

const choosePlanningAnchorSession = (
  displaySession: GallerySearchSessionRecord,
  recentSessions: GallerySearchSessionRecord[]
): GallerySearchSessionRecord => {
  for (const session of recentSessions) {
    const resultCount = extractCardIds(session).length;
    if (resultCount < 3) {
      continue;
    }

    if (isSparseRandomFallbackSession(session)) {
      continue;
    }

    return session;
  }

  return displaySession;
};

export const refreshGallerySkill: SkillHandler<RefreshGalleryInput, RefreshGalleryOutput> = async (input, context) => {
  logger.info("[REFRESH GALLERY SKILL] start", {
    discordUserId: input.discordUserId,
    discordChannelId: input.discordChannelId,
    currentMessage: input.currentMessage,
  });

  const displaySession = await gallerySearchSessionRepository.findLatest({
    discordGuildId: context.discordGuildId,
    discordUserId: input.discordUserId,
    discordChannelId: input.discordChannelId,
    status: "active",
  });

  if (!displaySession) {
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
      anchorSessionId: null,
      displaySessionId: null,
      poolExhausted: false,
    };
  }

  const recentSessions = await gallerySearchSessionRepository.findRecentByUserId({
    discordGuildId: context.discordGuildId,
    discordUserId: input.discordUserId,
    discordChannelId: input.discordChannelId,
    take: 20,
  });
  const planningAnchorSession = choosePlanningAnchorSession(displaySession, recentSessions);

  const excludeIds = Array.from(new Set(recentSessions.flatMap(extractCardIds)));
  const firstBatchCardIds = extractCardIds(displaySession);
  const recentActiveSessionCount = recentSessions.filter((session) => session.status === "active").length;
  const anchorSessionMetadata = readSessionResultMetadata(planningAnchorSession);
  const recentRefreshModes = Array.from(
    new Set(
      recentSessions
        .map((session) => readSessionResultMetadata(session).refreshMode)
        .filter((value): value is string => Boolean(value))
    )
  );
  const sessionMetadata: RefreshPlannerSessionMetadata = {
    previousSessionId: displaySession.id,
    displaySessionId: displaySession.id,
    anchorSessionId: planningAnchorSession.id,
    previousQuery: planningAnchorSession.query,
    originalQuery: anchorSessionMetadata.originalQuery ?? planningAnchorSession.query,
    previousBatchSize: extractCardIds(planningAnchorSession).length,
    previousBatchCardIds: extractCardIds(planningAnchorSession),
    recentActiveSessionCount,
    totalExcludedCardCount: excludeIds.length,
    latestBatchIndex: anchorSessionMetadata.batchIndex ?? recentSessions.length,
    recentRefreshModes,
    hasSelectedCard: Boolean(displaySession.selectedGalleryCardId),
  };

  logger.info("[REFRESH GALLERY SKILL] session metadata", sessionMetadata);

  const refreshResult = await galleryService.refreshGalleryCards({
    discordUserId: input.discordUserId,
    currentMessage: input.currentMessage,
    previousSession: planningAnchorSession,
    displaySession,
    excludeIds,
    limit: 10,
    sessionMetadata,
  });

  const secondBatchCardIds = refreshResult.cards.map((card) => card.id);

  if (refreshResult.cards.length > 0) {
    const archivedCount = await gallerySearchSessionRepository.archiveActiveSessions({
      discordGuildId: context.discordGuildId,
      discordUserId: input.discordUserId,
      discordChannelId: input.discordChannelId,
    });
    logger.info("[REFRESH GALLERY SKILL] archived active sessions", {
      discordUserId: input.discordUserId,
      discordChannelId: input.discordChannelId,
      archivedCount,
    });

    await gallerySearchSessionRepository.create({
      discordGuildId: context.discordGuildId,
      discordUserId: input.discordUserId,
      discordChannelId: input.discordChannelId,
      query: planningAnchorSession.query,
      results: refreshResult.cards.map((card) => ({
        id: card.id,
        title: card.title,
        description: card.description,
        imageUrl: card.imageUrl,
        price: card.price,
        tags: card.tags,
        language: refreshResult.language,
        batchIndex: recentSessions.length + 1,
        previousSessionId: displaySession.id,
        anchorSessionId: planningAnchorSession.id,
        refreshMode: refreshResult.refreshMode,
        originalQuery: planningAnchorSession.query,
      })),
      status: "active",
    });
  }

  logger.info("[REFRESH GALLERY SKILL] completed", {
    discordUserId: input.discordUserId,
    discordChannelId: input.discordChannelId,
    refreshMode: refreshResult.refreshMode,
    cardCount: refreshResult.cards.length,
    poolExhausted: refreshResult.poolExhausted,
    anchorSessionId: planningAnchorSession.id,
    displaySessionId: displaySession.id,
  });

  return {
    query: planningAnchorSession.query,
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
    anchorSessionId: planningAnchorSession.id,
    displaySessionId: displaySession.id,
    poolExhausted: refreshResult.poolExhausted,
  };
};
