import { SkillContext, SkillHandler } from "../../hermes/types";
import {
  GallerySearchSessionRecord,
  gallerySearchSessionRepository,
} from "../../repositories/gallery-search-session.repository";
import { Prisma } from "@prisma/client";
import { GalleryCardDto, GalleryRefreshResult, galleryService } from "../../services/gallery.service";
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

export const refreshGallerySkill: SkillHandler<RefreshGalleryInput, RefreshGalleryOutput> = async (
  input,
  context
) => {
  logger.info("[REFRESH GALLERY SKILL] refreshing batch");

  const previousSession = await gallerySearchSessionRepository.findLatest({
    discordUserId: input.discordUserId,
    discordChannelId: input.discordChannelId,
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
    };
  }

  const recentSessions = await gallerySearchSessionRepository.findRecentByUserId({
    discordUserId: input.discordUserId,
    take: 20,
  });

  const excludeIds = Array.from(new Set(recentSessions.flatMap(extractCardIds)));
  const firstBatchCardIds = extractCardIds(previousSession);

  const refreshResult = await galleryService.refreshGalleryCards({
    discordUserId: input.discordUserId,
    currentMessage: input.currentMessage,
    previousSession,
    excludeIds,
    limit: 10,
  });

  const secondBatchCardIds = refreshResult.cards.map((card) => card.id);

  if (refreshResult.cards.length > 0) {
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
  };
};
