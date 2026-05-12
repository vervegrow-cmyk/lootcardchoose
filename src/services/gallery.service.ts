import { SupportedLanguage } from "../hermes/types";
import { GalleryCardRecord, galleryRepository } from "../repositories/gallery.repository";
import {
  canonicalizeGalleryTerm,
  detectPreferredLanguage,
  expandGalleryKeywords,
  normalizeGalleryKeywordsToEnglish,
  normalizeGalleryLimit,
} from "../utils/gallery-language";
import { logger } from "../utils/logger";
import { ParsedGalleryQuery, parseGalleryQuery } from "./llm-query-parser.service";
import { isDatabaseReady } from "./prisma.service";

export const DEFAULT_GALLERY_RESULT_LIMIT = 10;

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
  score?: number;
};

export type GallerySearchResult = {
  query: string;
  language: SupportedLanguage;
  parsedQuery: ParsedGalleryQuery | null;
  structuredKeywords: string[];
  results: GalleryCardDto[];
  limit: number;
};

const STRUCTURED_FIELDS: Array<keyof Pick<
  ParsedGalleryQuery,
  "rarity" | "color" | "character" | "category" | "style" | "mood" | "scene"
>> = ["rarity", "color", "character", "category", "style", "mood", "scene"];

const toDto = (card: GalleryCardRecord): GalleryCardDto => ({
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
  score: card.score,
});

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

const buildFallbackParsedQuery = (query: string, language: SupportedLanguage): ParsedGalleryQuery => ({
  language,
  keywords: normalizeGalleryKeywordsToEnglish([query]),
  tags: [],
  style: "",
  rarity: "",
  category: "",
  character: "",
  color: "",
  mood: "",
  scene: "",
  limit: DEFAULT_GALLERY_RESULT_LIMIT,
});

export const buildStructuredGalleryKeywords = (parsedQuery: ParsedGalleryQuery): string[] => {
  const rawValues = [
    ...parsedQuery.keywords,
    ...parsedQuery.tags,
    ...STRUCTURED_FIELDS.map((field) => parsedQuery[field]),
  ].filter(Boolean);

  return expandGalleryKeywords(rawValues.map((value) => canonicalizeGalleryTerm(value)));
};

export const galleryService = {
  async searchGalleryCards(query: string, language: SupportedLanguage = "en"): Promise<GallerySearchResult> {
    logger.info("[GALLERY SERVICE] search query=" + query);
    if (!isDatabaseReady()) {
      throw new Error("DATABASE_NOT_READY");
    }

    const preferredLanguage = language ?? detectPreferredLanguage(query);
    const parsed = await parseGalleryQuery(query, preferredLanguage);
    const limit = normalizeGalleryLimit(parsed?.limit, DEFAULT_GALLERY_RESULT_LIMIT);
    const parsedQuery = parsed
      ? {
          ...parsed,
          limit,
        }
      : buildFallbackParsedQuery(query, preferredLanguage);

    logger.info("[GALLERY SERVICE] parsed search input=" + JSON.stringify(parsedQuery));

    const structuredKeywords = buildStructuredGalleryKeywords(parsedQuery);
    logger.info("[GALLERY SERVICE] structured keywords=" + JSON.stringify(structuredKeywords));

    const fallbackKeywords = structuredKeywords.length > 0 ? [] : normalizeGalleryKeywordsToEnglish([query]);
    const finalKeywords = structuredKeywords.length > 0 ? structuredKeywords : fallbackKeywords;
    const finalTags = structuredKeywords.length > 0 ? normalizeGalleryKeywordsToEnglish(parsedQuery.tags) : [];

    const resultsSource = await galleryRepository.search({
      keywords: finalKeywords,
      tags: finalTags,
      style: parsedQuery.style,
      rarity: parsedQuery.rarity,
      category: parsedQuery.category,
      character: parsedQuery.character,
      color: parsedQuery.color,
      mood: parsedQuery.mood,
      scene: parsedQuery.scene,
      limit,
    });

    const results = dedupeCards(resultsSource).slice(0, limit).map(toDto);
    logger.info("[GALLERY SERVICE] final result count=" + results.length);

    return {
      query,
      language: parsedQuery.language,
      parsedQuery,
      structuredKeywords,
      results,
      limit,
    };
  },
  async getGalleryCardById(cardId: string): Promise<GalleryCardDto | null> {
    if (!isDatabaseReady()) {
      throw new Error("DATABASE_NOT_READY");
    }
    const card = await galleryRepository.findById(cardId);
    return card ? toDto(card) : null;
  },
};
