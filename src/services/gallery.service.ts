import { SupportedLanguage } from "../hermes/types";
import { GalleryCardRecord, galleryRepository } from "../repositories/gallery.repository";
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
};

export type GallerySearchResult = {
  query: string;
  parsedQuery: ParsedGalleryQuery | null;
  results: GalleryCardDto[];
  limit: number;
};

const TAG_SYNONYMS: Record<string, string[]> = {
  "黑金": ["black gold"],
  "black gold": ["黑金"],
  "女角色": ["female character", "girl", "female"],
  "female character": ["女角色"],
  "卡牌": ["card", "trading card"],
  "card": ["卡牌"],
  "赛博朋克": ["cyberpunk"],
  "cyberpunk": ["赛博朋克"],
  "机甲": ["mecha"],
  "mecha": ["机甲"],
};

const stopWords = new Set([
  "给我",
  "我要",
  "张",
  "卡牌",
  "卡",
  "找图",
  "找卡",
  "搜索",
  "图库",
  "要",
  "的",
  "show",
  "me",
  "please",
  "cards",
  "card",
]);

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

const extractKeywords = (query: string): string[] => {
  const tokens = query.match(/[\u4e00-\u9fff]+|[a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+)*/g) ?? [];
  return tokens
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0)
    .filter((token) => !stopWords.has(token));
};

const expandSynonyms = (tokens: string[]): string[] => {
  const expanded = new Set<string>();
  for (const token of tokens) {
    const normalized = token.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    expanded.add(normalized);
    const synonyms = TAG_SYNONYMS[normalized] ?? [];
    for (const synonym of synonyms) {
      expanded.add(synonym.toLowerCase());
    }
  }
  return [...expanded];
};

const mergeTokens = (...groups: string[][]): string[] => {
  const merged = new Set<string>();
  for (const group of groups) {
    for (const token of group) {
      const normalized = token.trim().toLowerCase();
      if (normalized) {
        merged.add(normalized);
      }
    }
  }
  return [...merged];
};

const buildFallbackParsedQuery = (query: string, language: SupportedLanguage): ParsedGalleryQuery => ({
  language,
  keywords: extractKeywords(query),
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

export const galleryService = {
  async searchGalleryCards(query: string, language: SupportedLanguage = "zh"): Promise<GallerySearchResult> {
    logger.info("[GALLERY SERVICE] search query=" + query);
    if (!isDatabaseReady()) {
      throw new Error("DATABASE_NOT_READY");
    }

    const limit = DEFAULT_GALLERY_RESULT_LIMIT;
    const baseKeywords = extractKeywords(query);
    const expandedKeywords = expandSynonyms(baseKeywords);
    const parsed = await parseGalleryQuery(query, language);
    const parsedQuery = parsed
      ? {
          ...parsed,
          limit,
        }
      : buildFallbackParsedQuery(query, language);

    const parsedKeywords = expandSynonyms(parsedQuery.keywords.map((keyword) => keyword.toLowerCase()));
    const parsedTags = expandSynonyms(parsedQuery.tags.map((tag) => tag.toLowerCase()));
    const keywords = mergeTokens(expandedKeywords, parsedKeywords);
    const tags = mergeTokens(parsedTags, keywords);

    const parsedResults = await galleryRepository.findManyByParsedQuery({
      keywords,
      tags,
      style: parsedQuery.style,
      rarity: parsedQuery.rarity,
      category: parsedQuery.category,
      character: parsedQuery.character,
      color: parsedQuery.color,
      mood: parsedQuery.mood,
      scene: parsedQuery.scene,
      limit,
    });

    logger.info("[GALLERY SERVICE] parsed search result count=" + parsedResults.length);

    if (parsedResults.length >= limit) {
      return {
        query,
        parsedQuery,
        results: dedupeCards(parsedResults).slice(0, limit).map(toDto),
        limit,
      };
    }

    if (parsedResults.length > 0) {
      const remaining = limit - parsedResults.length;
      const fallback = await galleryRepository.findManyByQuery({ keywords, limit: remaining });
      return {
        query,
        parsedQuery,
        results: dedupeCards([...parsedResults, ...fallback]).slice(0, limit).map(toDto),
        limit,
      };
    }

    const results = await galleryRepository.findManyByQuery({ keywords: expandedKeywords, limit });

    if (results.length === 0 && expandedKeywords.length > 1) {
      const fallback = await galleryRepository.findManyByQuery({
        keywords: [expandedKeywords[0]],
        limit,
      });
      return {
        query,
        parsedQuery,
        results: dedupeCards(fallback).slice(0, limit).map(toDto),
        limit,
      };
    }

    return {
      query,
      parsedQuery,
      results: dedupeCards(results).slice(0, limit).map(toDto),
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
