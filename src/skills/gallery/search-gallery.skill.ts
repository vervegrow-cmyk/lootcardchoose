import { SkillContext, SkillHandler } from "../../hermes/types";
import { gallerySearchSessionRepository } from "../../repositories/gallery-search-session.repository";
import { GalleryCardDto, GallerySearchResult, galleryService } from "../../services/gallery.service";
import { ParsedGalleryQuery } from "../../services/llm-query-parser.service";
import { logger } from "../../utils/logger";

export type SearchGalleryInput = {
  query: string;
  discordUserId: string;
  discordChannelId: string;
};

export type SearchGalleryOutput = {
  query: string;
  language: SkillContext["language"];
  parsedQuery: ParsedGalleryQuery | null;
  results: GalleryCardDto[];
  limit: number;
};

export const searchGallerySkill: SkillHandler<SearchGalleryInput, SearchGalleryOutput> = async (
  input: SearchGalleryInput,
  context: SkillContext
) => {
  logger.info("[SEARCH GALLERY SKILL] searching", {
    query: input.query,
    discordUserId: input.discordUserId,
    discordChannelId: input.discordChannelId,
  });
  try {
    const searchResult: GallerySearchResult = await galleryService.searchGalleryCards(input.query, context.language);
    const sessionResults = searchResult.results.map((card) => ({
      id: card.id,
      title: card.title,
      description: card.description,
      imageUrl: card.imageUrl,
      price: card.price,
      tags: card.tags,
    }));

    try {
      const archivedCount = await gallerySearchSessionRepository.archiveActiveSessions({
        discordUserId: input.discordUserId,
        discordChannelId: input.discordChannelId,
      });
      logger.info("[SEARCH GALLERY SKILL] archived active sessions", {
        discordUserId: input.discordUserId,
        discordChannelId: input.discordChannelId,
        archivedCount,
      });

      await gallerySearchSessionRepository.create({
        discordUserId: input.discordUserId,
        discordChannelId: input.discordChannelId,
        query: searchResult.query,
        results: sessionResults.map((card) => ({
          ...card,
          language: searchResult.language,
          batchIndex: 1,
          originalQuery: searchResult.query,
        })),
        status: "active",
      });
    } catch (sessionError) {
      logger.warn("[SEARCH GALLERY SKILL] session create failed", {
        message: sessionError instanceof Error ? sessionError.message : String(sessionError),
      });
    }

    return {
      query: searchResult.query,
      language: searchResult.language,
      parsedQuery: searchResult.parsedQuery,
      results: searchResult.results,
      limit: searchResult.limit,
    };
  } catch (error) {
    logger.warn("[SEARCH GALLERY SKILL] search failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      query: input.query,
      language: context.language,
      parsedQuery: null,
      results: [],
      limit: 10,
    };
  }
};
