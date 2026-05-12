import { Prisma } from "@prisma/client";
import { SupportedLanguage } from "../hermes/types";
import { GallerySearchSessionRecord } from "../repositories/gallery-search-session.repository";
import { GalleryCardRecord, galleryRepository } from "../repositories/gallery.repository";
import { loadEnv } from "../config/env";
import {
  canonicalizeGalleryTerm,
  detectPreferredLanguage,
  expandGalleryKeywords,
  inferRefreshModeFromMessage,
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

export type RefreshMode = "next_batch" | "refine" | "broaden" | "random_fallback" | "need_clarification";

export type GalleryRefreshResult = {
  cards: GalleryCardDto[];
  language: SupportedLanguage;
  refreshMode: RefreshMode;
  reason: string;
  shortQuestion?: string;
  limit: number;
  excludedCardIds: string[];
  parsedQuery: ParsedGalleryQuery | null;
};

type RefreshDecision = {
  language: SupportedLanguage;
  refreshMode: RefreshMode;
  keep: string[];
  avoid: string[];
  broaden: string[];
  searchKeywords: string[];
  reason: string;
  shouldAskClarifyingQuestion: boolean;
  shortQuestion: string;
};

type DeepSeekMessage = {
  role: "system" | "user";
  content: string;
};

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>;
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

const safeArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const isJsonObject = (value: Prisma.JsonValue): value is Prisma.JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readSessionCards = (results: Prisma.JsonValue): Array<{ id: string }> => {
  if (!Array.isArray(results)) {
    return [];
  }

  return results
    .filter(isJsonObject)
    .map((item) => ({ id: typeof item.id === "string" ? item.id : "" }))
    .filter((item) => Boolean(item.id));
};

const extractSessionLanguage = (session: GallerySearchSessionRecord): SupportedLanguage => {
  if (Array.isArray(session.results) && session.results.length > 0 && isJsonObject(session.results[0])) {
    const language = session.results[0].language;
    if (language === "zh" || language === "en") {
      return language;
    }
  }

  return detectPreferredLanguage(session.query);
};

const buildFallbackRefreshDecision = (
  currentMessage: string,
  previousQuery: ParsedGalleryQuery,
  language: SupportedLanguage
): RefreshDecision => {
  const baseMode = inferRefreshModeFromMessage(currentMessage);
  const keep = buildStructuredGalleryKeywords(previousQuery);
  const broaden =
    baseMode === "broaden"
      ? normalizeGalleryKeywordsToEnglish(["anime", "premium", "fantasy"])
      : baseMode === "refine"
        ? normalizeGalleryKeywordsToEnglish(["anime", "premium"])
        : [];

  return {
    language,
    refreshMode: baseMode,
    keep,
    avoid: ["previous cards"],
    broaden,
    searchKeywords: expandGalleryKeywords([...keep, ...broaden]),
    reason:
      baseMode === "refine"
        ? language === "zh"
          ? "用户不满意当前结果，需要换一批更贴近偏好的卡牌。"
          : "The user is not satisfied with the current batch and wants a closer match."
        : baseMode === "broaden"
          ? language === "zh"
            ? "用户希望换一种风格，需要展示相关但略微放宽条件的卡牌。"
            : "The user wants a different style, so the search should broaden into related options."
          : language === "zh"
            ? "用户希望在同一需求下换一批新的卡牌。"
            : "The user wants another batch under the same preference.",
    shouldAskClarifyingQuestion: false,
    shortQuestion: "",
  };
};

const buildRefreshPrompt = (
  currentMessage: string,
  previousQuery: ParsedGalleryQuery,
  language: SupportedLanguage
): DeepSeekMessage[] => [
  {
    role: "system",
    content:
      "You are a refresh planner for LootCardChoose gallery search. Return JSON only with this shape: " +
      "{\"language\":\"zh|en\",\"refreshMode\":\"next_batch|refine|broaden|need_clarification\"," +
      "\"keep\":string[],\"avoid\":string[],\"broaden\":string[],\"searchKeywords\":string[]," +
      "\"reason\":string,\"shouldAskClarifyingQuestion\":boolean,\"shortQuestion\":string}. " +
      "Keep search keywords short and English-first. " +
      "Use next_batch when the user simply wants more similar options. " +
      "Use refine when the user dislikes the current cards. " +
      "Use broaden when the user wants another style or related options. " +
      "Only use need_clarification if the request is truly ambiguous. " +
      "Do not write explanations outside JSON.",
  },
  {
    role: "user",
    content: JSON.stringify({
      language,
      previousQuery,
      currentMessage,
    }),
  },
];

const parseRefreshDecision = (
  raw: string,
  fallback: RefreshDecision,
  language: SupportedLanguage
): RefreshDecision | null => {
  try {
    const trimmed = raw.trim();
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    const jsonPayload =
      firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : trimmed;
    const parsed = JSON.parse(jsonPayload) as Partial<RefreshDecision>;
    const refreshMode =
      parsed.refreshMode === "next_batch" ||
      parsed.refreshMode === "refine" ||
      parsed.refreshMode === "broaden" ||
      parsed.refreshMode === "need_clarification"
        ? parsed.refreshMode
        : fallback.refreshMode;

    return {
      language: parsed.language === "zh" || parsed.language === "en" ? parsed.language : language,
      refreshMode,
      keep: normalizeGalleryKeywordsToEnglish(safeArray(parsed.keep)),
      avoid: normalizeGalleryKeywordsToEnglish(safeArray(parsed.avoid)),
      broaden: normalizeGalleryKeywordsToEnglish(safeArray(parsed.broaden)),
      searchKeywords: normalizeGalleryKeywordsToEnglish(safeArray(parsed.searchKeywords)),
      reason: typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : fallback.reason,
      shouldAskClarifyingQuestion: Boolean(parsed.shouldAskClarifyingQuestion),
      shortQuestion: typeof parsed.shortQuestion === "string" ? parsed.shortQuestion.trim() : "",
    };
  } catch {
    return null;
  }
};

const buildStrictSearchInput = (
  parsedQuery: ParsedGalleryQuery,
  keywords: string[],
  limit: number,
  excludeIds: string[]
) => ({
  keywords,
  tags: parsedQuery.tags,
  style: parsedQuery.style,
  rarity: parsedQuery.rarity,
  category: parsedQuery.category,
  character: parsedQuery.character,
  color: parsedQuery.color,
  mood: parsedQuery.mood,
  scene: parsedQuery.scene,
  limit,
  excludeIds,
});

const buildBroadenedSearchInput = (
  parsedQuery: ParsedGalleryQuery,
  keywords: string[],
  limit: number,
  excludeIds: string[]
) => ({
  keywords,
  tags: [],
  style: "",
  rarity: parsedQuery.rarity,
  category: parsedQuery.category,
  character: parsedQuery.character,
  color: "",
  mood: "",
  scene: "",
  limit,
  excludeIds,
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

  async refreshGalleryCards(input: {
    discordUserId: string;
    currentMessage: string;
    previousSession: GallerySearchSessionRecord;
    excludeIds: string[];
    limit?: number;
  }): Promise<GalleryRefreshResult> {
    logger.info("[GALLERY SERVICE] refresh query=" + input.previousSession.query);
    if (!isDatabaseReady()) {
      throw new Error("DATABASE_NOT_READY");
    }

    const language = extractSessionLanguage(input.previousSession);
    const previousParsed =
      (await parseGalleryQuery(input.previousSession.query, language)) ??
      buildFallbackParsedQuery(input.previousSession.query, language);
    const limit = normalizeGalleryLimit(input.limit ?? previousParsed.limit, DEFAULT_GALLERY_RESULT_LIMIT);

    const fallbackDecision = buildFallbackRefreshDecision(input.currentMessage, previousParsed, language);
    const env = loadEnv();
    let decision = fallbackDecision;

    if (env.enableNaturalLanguageSearch && env.deepseekApiKey) {
      try {
        const response = await fetch(`${env.deepseekBaseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.deepseekApiKey}`,
          },
          body: JSON.stringify({
            model: env.deepseekModel,
            temperature: 0,
            messages: buildRefreshPrompt(input.currentMessage, previousParsed, language),
          }),
        });

        if (response.ok) {
          const payload = (await response.json()) as DeepSeekResponse;
          const content = payload.choices?.[0]?.message?.content?.trim() ?? "";
          const parsedDecision = parseRefreshDecision(content, fallbackDecision, language);
          if (parsedDecision) {
            decision = {
              ...parsedDecision,
              keep: parsedDecision.keep.length > 0 ? parsedDecision.keep : fallbackDecision.keep,
              searchKeywords:
                parsedDecision.searchKeywords.length > 0
                  ? parsedDecision.searchKeywords
                  : fallbackDecision.searchKeywords,
            };
          }
        }
      } catch (error) {
        logger.warn("[GALLERY SERVICE] refresh decision fallback", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (decision.shouldAskClarifyingQuestion || decision.refreshMode === "need_clarification") {
      return {
        cards: [],
        language: decision.language,
        refreshMode: "need_clarification",
        reason: decision.reason,
        shortQuestion:
          decision.shortQuestion ||
          (decision.language === "zh"
            ? "你想换成哪种风格：可爱、暗黑、幻想，还是高级感？"
            : "What style would you like next — cute, dark, fantasy, or premium?"),
        limit,
        excludedCardIds: input.excludeIds,
        parsedQuery: previousParsed,
      };
    }

    const strictKeywords =
      decision.keep.length > 0 ? expandGalleryKeywords(decision.keep) : buildStructuredGalleryKeywords(previousParsed);
    const refinedKeywords =
      decision.searchKeywords.length > 0 ? expandGalleryKeywords(decision.searchKeywords) : strictKeywords;
    const broadenKeywords = decision.broaden.length > 0 ? expandGalleryKeywords(decision.broaden) : [];

    const strictResults = await galleryRepository.search(
      buildStrictSearchInput(previousParsed, strictKeywords, limit, input.excludeIds)
    );

    let chosenMode: Exclude<RefreshMode, "need_clarification"> = decision.refreshMode;
    let finalCards = strictResults;

    if (finalCards.length < limit && refinedKeywords.length > 0) {
      const refinedResults = await galleryRepository.search(
        buildStrictSearchInput(previousParsed, refinedKeywords, limit, input.excludeIds)
      );
      finalCards = dedupeCards([...finalCards, ...refinedResults]);
      if (chosenMode === "next_batch" && refinedResults.length > strictResults.length) {
        chosenMode = "refine";
      }
    }

    if (finalCards.length < limit && broadenKeywords.length > 0) {
      const broadenedResults = await galleryRepository.search(
        buildBroadenedSearchInput(previousParsed, [...strictKeywords, ...broadenKeywords], limit, input.excludeIds)
      );
      finalCards = dedupeCards([...finalCards, ...broadenedResults]);
      chosenMode = "broaden";
    }

    if (finalCards.length === 0) {
      const fallbackPool = await galleryRepository.findActiveExcluding({
        excludeIds: input.excludeIds,
        limit: Math.max(limit * 3, limit),
      });
      finalCards = dedupeCards(fallbackPool)
        .sort(() => Math.random() - 0.5)
        .slice(0, limit);
      if (finalCards.length > 0) {
        chosenMode = "random_fallback";
      }
    }

    return {
      cards: finalCards.slice(0, limit).map(toDto),
      language: decision.language,
      refreshMode: chosenMode,
      reason: decision.reason,
      limit,
      excludedCardIds: input.excludeIds,
      parsedQuery: previousParsed,
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
