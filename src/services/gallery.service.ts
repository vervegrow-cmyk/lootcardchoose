import { SupportedLanguage } from "../hermes/types";
import { GalleryCardRecord, galleryRepository } from "../repositories/gallery.repository";
import { logger } from "../utils/logger";
import { ParsedGalleryQuery, parseGalleryQuery } from "./llm-query-parser.service";
import { isDatabaseReady } from "./prisma.service";

export const DEFAULT_GALLERY_RESULT_LIMIT = 10;

const normalizeSearchLimit = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_GALLERY_RESULT_LIMIT;
  }

  if (value < 1) {
    return DEFAULT_GALLERY_RESULT_LIMIT;
  }

  return Math.min(Math.floor(value), DEFAULT_GALLERY_RESULT_LIMIT);
};

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
  parsedQuery: ParsedGalleryQuery | null;
  structuredKeywords: string[];
  results: GalleryCardDto[];
  limit: number;
};

const KEYWORD_EXPANSIONS: Record<string, string[]> = {
  "\u9ed1\u91d1": ["black gold"],
  "black gold": ["\u9ed1\u91d1"],
  SSR: ["ssr"],
  ssr: ["SSR"],
  "\u5973\u89d2\u8272": ["female", "girl", "anime girl", "female character", "anime"],
  female: ["\u5973\u89d2\u8272"],
  girl: ["\u5973\u89d2\u8272"],
  "anime girl": ["\u5973\u89d2\u8272"],
  "female character": ["\u5973\u89d2\u8272"],
  "\u5361\u724c": ["card", "trading card"],
  card: ["\u5361\u724c"],
  "trading card": ["\u5361\u724c"],
  "\u52a8\u6f2b": ["anime"],
  anime: ["\u52a8\u6f2b"],
  "\u673a\u7532": ["mecha"],
  mecha: ["\u673a\u7532"],
  "\u6697\u9ed1": ["dark"],
  dark: ["\u6697\u9ed1"],
  "\u9f99": ["dragon"],
  dragon: ["\u9f99"],
  "\u8d5b\u535a\u670b\u514b": ["cyberpunk"],
  cyberpunk: ["\u8d5b\u535a\u670b\u514b"],
  "\u53ef\u7231": ["cute"],
  cute: ["\u53ef\u7231"],
  "\u9ad8\u7ea7\u611f": ["premium", "luxury"],
  premium: ["\u9ad8\u7ea7\u611f"],
  luxury: ["\u9ad8\u7ea7\u611f"],
  "\u6218\u6597": ["battle"],
  battle: ["\u6218\u6597"],
  "\u9b54\u6cd5": ["magic"],
  magic: ["\u9b54\u6cd5"],
  "\u672a\u6765\u611f": ["futuristic"],
  futuristic: ["\u672a\u6765\u611f"],
  "\u91d1\u8272": ["gold"],
  gold: ["\u91d1\u8272"],
  "\u9ed1\u8272": ["black"],
  black: ["\u9ed1\u8272"],
  "\u7f8e\u5973": ["\u5973\u89d2\u8272", "female", "girl", "anime girl", "female character", "beauty"],
  beauty: ["\u7f8e\u5973"],
};

const MEASURE_WORDS = new Set(["\u5f20", "\u4e2a", "\u5957", "\u6b3e", "\u79cd"]);
const STOP_WORDS = new Set([
  "\u7ed9\u6211",
  "\u6211\u8981",
  "\u5e2e\u6211",
  "\u627e",
  "\u641c\u7d22",
  "\u56fe\u5e93",
  "\u56fe\u7247",
  "\u5361\u724c",
  "\u6837\u5f0f",
  "\u6765\u70b9",
  "\u6765\u4e9b",
  "\u4e00\u4e0b",
  "show",
  "me",
  "please",
  "find",
  "search",
  "gallery",
  "image",
  "images",
  "card",
  "cards",
  "trading card",
]);

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

const normalizeForLookup = (value: string): string => value.trim().toLowerCase();

const uniqueKeywords = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeForLookup(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(value.trim());
  }

  return result;
};

const stripMeaninglessText = (value: string): string => {
  let cleaned = value.trim();

  cleaned = cleaned.replace(/[，。、“”"'`‘’！？!?,.:;()[\]{}<>/\\|@#$%^&*_+=~-]+/g, " ");
  cleaned = cleaned.replace(/\d+\s*(张|个|套|款|种)/g, " ");

  for (const stopWord of STOP_WORDS) {
    cleaned = cleaned.replace(new RegExp(stopWord, "gi"), " ");
  }

  return cleaned.replace(/\s+/g, " ").trim();
};

const extractKeywordCandidates = (input: string): string[] => {
  const cleaned = stripMeaninglessText(input);
  if (!cleaned) {
    return [];
  }

  const matches = cleaned.match(/[\u4e00-\u9fff]+|[a-zA-Z]+(?:\s+[a-zA-Z]+)*|[0-9]+/g) ?? [];
  const result: string[] = [];

  for (const rawMatch of matches) {
    let token = rawMatch.trim();
    if (!token || /^\d+$/.test(token)) {
      continue;
    }

    while (token.length > 1 && MEASURE_WORDS.has(token.charAt(0))) {
      token = token.slice(1).trim();
    }

    while (token.length > 1 && MEASURE_WORDS.has(token.charAt(token.length - 1))) {
      token = token.slice(0, -1).trim();
    }

    if (!token) {
      continue;
    }

    const normalized = normalizeForLookup(token);
    if (!normalized || STOP_WORDS.has(normalized) || STOP_WORDS.has(token)) {
      continue;
    }

    result.push(token);
  }

  return uniqueKeywords(result);
};

const expandKeywords = (tokens: string[]): string[] => {
  const expanded: string[] = [];

  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) {
      continue;
    }

    expanded.push(trimmed);

    const directMatches = KEYWORD_EXPANSIONS[trimmed] ?? KEYWORD_EXPANSIONS[trimmed.toLowerCase()] ?? [];
    for (const match of directMatches) {
      expanded.push(match);
    }
  }

  return uniqueKeywords(expanded);
};

export const normalizeGalleryKeywords = (values: string[]): string[] => {
  const candidates = values.flatMap((value) => extractKeywordCandidates(value));
  return expandKeywords(candidates);
};

const buildFallbackParsedQuery = (query: string, language: SupportedLanguage): ParsedGalleryQuery => ({
  language,
  keywords: normalizeGalleryKeywords([query]),
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
  const rawStructuredValues = [
    ...parsedQuery.keywords,
    ...parsedQuery.tags,
    ...STRUCTURED_FIELDS.map((field) => parsedQuery[field]),
  ];

  return normalizeGalleryKeywords(rawStructuredValues);
};

export const galleryService = {
  async searchGalleryCards(query: string, language: SupportedLanguage = "zh"): Promise<GallerySearchResult> {
    logger.info("[GALLERY SERVICE] search query=" + query);
    if (!isDatabaseReady()) {
      throw new Error("DATABASE_NOT_READY");
    }

    const parsed = await parseGalleryQuery(query, language);
    const limit = normalizeSearchLimit(parsed?.limit);
    const parsedQuery = parsed
      ? {
          ...parsed,
          limit,
        }
      : buildFallbackParsedQuery(query, language);

    logger.info("[GALLERY SERVICE] parsed search input=" + JSON.stringify(parsedQuery));

    const structuredKeywords = buildStructuredGalleryKeywords(parsedQuery);
    logger.info("[GALLERY SERVICE] structured keywords=" + JSON.stringify(structuredKeywords));

    const shouldUseStructuredSearch = structuredKeywords.length > 0;
    const fallbackKeywords = shouldUseStructuredSearch ? [] : normalizeGalleryKeywords([query]);
    const finalKeywords = shouldUseStructuredSearch ? structuredKeywords : fallbackKeywords;
    const finalTags = shouldUseStructuredSearch ? normalizeGalleryKeywords(parsedQuery.tags) : [];

    const resultsSource = await galleryRepository.search({
      keywords: finalKeywords,
      tags: finalTags,
      style: shouldUseStructuredSearch ? parsedQuery.style : "",
      rarity: shouldUseStructuredSearch ? parsedQuery.rarity : "",
      category: shouldUseStructuredSearch ? parsedQuery.category : "",
      character: shouldUseStructuredSearch ? parsedQuery.character : "",
      color: shouldUseStructuredSearch ? parsedQuery.color : "",
      mood: shouldUseStructuredSearch ? parsedQuery.mood : "",
      scene: shouldUseStructuredSearch ? parsedQuery.scene : "",
      limit,
    });

    const results = dedupeCards(resultsSource).slice(0, limit).map(toDto);
    logger.info("[GALLERY SERVICE] final result count=" + results.length);

    return {
      query,
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
