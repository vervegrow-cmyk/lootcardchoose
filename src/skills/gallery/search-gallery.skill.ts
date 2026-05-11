import { SkillContext, SkillHandler } from "../../hermes/types";
import { galleryService, GalleryCardDto } from "../../services/gallery.service";
import { gallerySearchSessionRepository } from "../../repositories/gallery-search-session.repository";
import { logger } from "../../utils/logger";

export type SearchGalleryInput = {
  query: string;
  limit?: number;
  discordUserId: string;
  discordChannelId: string;
};

export type SearchGalleryOutput = {
  results: GalleryCardDto[];
};

export const searchGallerySkill: SkillHandler<SearchGalleryInput, SearchGalleryOutput> = async (
  input: SearchGalleryInput,
  context: SkillContext
) => {
  void context;
  const limit = input.limit ?? 10;

  logger.info("[SEARCH GALLERY SKILL] searching query=" + input.query);
  try {
    const results = await galleryService.searchGalleryCards(input.query, limit);
    const sessionResults = results.map((card) => ({
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
        query: input.query,
        results: sessionResults,
        status: "search",
      });
    } catch (sessionError) {
      logger.warn("[SEARCH GALLERY SKILL] session create failed", {
        message: sessionError instanceof Error ? sessionError.message : String(sessionError),
      });
    }
    return { results };
  } catch (error) {
    logger.warn("[SEARCH GALLERY SKILL] search failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { results: [] };
  }
};
