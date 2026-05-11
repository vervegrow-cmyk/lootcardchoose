import { SkillContext, SkillHandler } from "../../hermes/types";
import { galleryService, GalleryCardDto } from "../../services/gallery.service";
import { logger } from "../../utils/logger";

export type SearchGalleryInput = {
  query: string;
  limit?: number;
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
    return { results };
  } catch (error) {
    logger.warn("[SEARCH GALLERY SKILL] search failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { results: [] };
  }
};
