import { GalleryCardRecord, galleryRepository } from "../repositories/gallery.repository";
import { logger } from "../utils/logger";
import { isDatabaseReady } from "./prisma.service";
import { parseGalleryQuery } from "./llm-query-parser.service";

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

const dedupeCards = (cards: GalleryCardRecord[]): GalleryCardRecord[] => {
  const seen = new Set<string>();
  const result: GalleryCardRecord[] = [];
  for (const card of cards) {
    if (seen.has(card.id)) {
      continue;
    }
    seen.add(card.id);
    result.push(card);
  }
  return result;
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
    if (!isDatabaseReady()) {
      throw new Error("DATABASE_NOT_READY");
    }
    const keywords = extractKeywords(query);
    const parsed = await parseGalleryQuery(query);
    if (parsed) {
      const parsedResults = await galleryRepository.findManyByParsedQuery({
        ...parsed,
        keywords: parsed.keywords.length > 0 ? parsed.keywords : keywords,
        limit,
      });
      logger.info("[GALLERY SERVICE] parsed search result count=" + parsedResults.length);
      if (parsedResults.length >= limit) {
        return dedupeCards(parsedResults).slice(0, limit).map(toDto);
      }
      if (parsedResults.length > 0) {
        const remaining = limit - parsedResults.length;
        const fallback = await galleryRepository.findManyByQuery({ keywords, limit: remaining });
        return dedupeCards([...parsedResults, ...fallback]).slice(0, limit).map(toDto);
      }
    }

    const results = await galleryRepository.findManyByQuery({ keywords, limit });

    if (results.length === 0 && keywords.length > 1) {
      const fallback = await galleryRepository.findManyByQuery({
        keywords: [keywords[0]],
        limit,
      });
      return dedupeCards(fallback).slice(0, limit).map(toDto);
    }

    return dedupeCards(results).slice(0, limit).map(toDto);
  },
  async getGalleryCardById(cardId: string): Promise<GalleryCardDto | null> {
    if (!isDatabaseReady()) {
      throw new Error("DATABASE_NOT_READY");
    }
    const card = await galleryRepository.findById(cardId);
    return card ? toDto(card) : null;
  },
};
