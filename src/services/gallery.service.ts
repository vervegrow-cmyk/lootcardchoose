import { GalleryCardRecord, galleryRepository } from "../repositories/gallery.repository";
import { logger } from "../utils/logger";

export type GalleryCardDto = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string;
  tags: string[];
  style: string | null;
  rarity: string | null;
  category: string | null;
  character: string | null;
  color: string | null;
  price: number;
};

const toDto = (card: GalleryCardRecord): GalleryCardDto => {
  return {
    id: card.id,
    title: card.title,
    description: card.description,
    imageUrl: card.imageUrl,
    tags: card.tags,
    style: card.style,
    rarity: card.rarity,
    category: card.category,
    character: card.character,
    color: card.color,
    price: Number(card.price),
  };
};

const stopWords = new Set(["给我", "张", "卡牌", "卡", "找图", "找卡", "要", "的"]);

const extractKeywords = (query: string): string[] => {
  const tokens = query.match(/[\u4e00-\u9fa5]+|[a-zA-Z0-9]+/g) ?? [];
  return tokens
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .filter((token) => !stopWords.has(token))
    .map((token) => token.toLowerCase());
};

export const galleryService = {
  async searchGalleryCards(query: string, limit = 10): Promise<GalleryCardDto[]> {
    logger.info("[GALLERY SERVICE] search query=" + query);
    const keywords = extractKeywords(query);

    const results = await galleryRepository.findManyByQuery({ keywords, limit });

    if (results.length === 0 && keywords.length > 1) {
      const fallback = await galleryRepository.findManyByQuery({
        keywords: [keywords[0]],
        limit,
      });
      return fallback.map(toDto);
    }

    return results.map(toDto);
  },
};
