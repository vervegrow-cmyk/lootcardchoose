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
  parsedQuery: ParsedGalleryQuery | null;
  results: GalleryCardDto[];
  limit: number;
};

export const searchGallerySkill: SkillHandler<SearchGalleryInput, SearchGalleryOutput> = async (
  input: SearchGalleryInput,
  context: SkillContext
) => {
  logger.info("[SEARCH GALLERY SKILL] searching query=" + input.query);
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
      await gallerySearchSessionRepository.create({
        discordUserId: input.discordUserId,
        discordChannelId: input.discordChannelId,
        query: searchResult.query,
        results: sessionResults,
        status: "search",
      });
    } catch (sessionError) {
      logger.warn("[SEARCH GALLERY SKILL] session create failed", {
        message: sessionError instanceof Error ? sessionError.message : String(sessionError),
      });
    }

    return {
      query: searchResult.query,
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
      parsedQuery: null,
      results: [],
      limit: 10,
    };
  }
};
