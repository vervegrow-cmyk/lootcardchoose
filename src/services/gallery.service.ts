import { Prisma } from "@prisma/client";
import { RefreshMode, SupportedLanguage } from "../hermes/types";
import { loadEnv } from "../config/env";
import { GallerySearchSessionRecord } from "../repositories/gallery-search-session.repository";
import { GalleryCardRecord, galleryRepository } from "../repositories/gallery.repository";
import {
  canonicalizeGalleryTerm,
  detectPreferredLanguage,
  expandGalleryKeywords,
  inferRefreshModeFromMessage,
  normalizeGalleryKeywordsToEnglish,
  normalizeGalleryLimit,
} from "../utils/gallery-language";
import { t } from "../utils/i18n";
import { logger } from "../utils/logger";
import { cardPricingService, CardPricingInput } from "./card-pricing.service";
import { ParsedGalleryQuery, parseGalleryQuery } from "./llm-query-parser.service";
import { isDatabaseReady } from "./prisma.service";

export const DEFAULT_GALLERY_RESULT_LIMIT = 10;
export const REFRESH_PLANNER_TIMEOUT_MS = 8000;

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

export type GalleryCardPricingInputDto = {
  galleryPrice: number | string | null;
  metadataPrice: number | string | null;
  title: string;
  description: string | null;
  tags: string[];
  style: string | null;
  rarity: string | null;
  category: string | null;
  character: string | null;
  color: string | null;
  marketingTitle: string | null;
};

export type GallerySearchResult = {
  query: string;
  language: SupportedLanguage;
  parsedQuery: ParsedGalleryQuery | null;
  structuredKeywords: string[];
  results: GalleryCardDto[];
  limit: number;
};

export type GalleryRefreshResult = {
  cards: GalleryCardDto[];
  language: SupportedLanguage;
  refreshMode: RefreshMode;
  reason: string;
  shortQuestion?: string;
  limit: number;
  excludedCardIds: string[];
  parsedQuery: ParsedGalleryQuery | null;
  keep: string[];
  avoid: string[];
  broaden: string[];
  searchKeywords: string[];
  poolExhausted: boolean;
};

export type RefreshPlannerCardSummary = {
  id: string;
  title: string;
  tags: string[];
  style: string;
  color: string;
  rarity: string;
};

export type RefreshPlannerSessionMetadata = {
  previousSessionId: string;
  displaySessionId: string;
  anchorSessionId: string;
  previousQuery: string;
  originalQuery: string;
  previousBatchSize: number;
  previousBatchCardIds: string[];
  recentActiveSessionCount: number;
  totalExcludedCardCount: number;
  latestBatchIndex: number;
  recentRefreshModes: string[];
  hasSelectedCard: boolean;
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

type RefreshPlannerPromptPayload = {
  language: SupportedLanguage;
  userFeedback: string;
  previousQuery: ParsedGalleryQuery;
  previousCards: RefreshPlannerCardSummary[];
  sessionMetadata: RefreshPlannerSessionMetadata;
};

export type RefreshGalleryCardsInput = {
  discordUserId: string;
  currentMessage: string;
  previousSession: GallerySearchSessionRecord;
  displaySession?: GallerySearchSessionRecord;
  excludeIds: string[];
  limit?: number;
  sessionMetadata?: RefreshPlannerSessionMetadata;
};

type RefreshSearchHints = {
  preferredKeywords?: string[];
  broadenKeywords?: string[];
  avoidKeywords?: string[];
};

const STRUCTURED_FIELDS: Array<
  keyof Pick<ParsedGalleryQuery, "rarity" | "color" | "character" | "category" | "style" | "mood" | "scene">
> = ["rarity", "color", "character", "category", "style", "mood", "scene"];

const META_ONLY_REFRESH_KEYWORDS = new Set([
  "previous cards",
  "same composition",
  "previous s",
  "sa composition",
  "other options",
  "another batch",
  "different style",
  "more options",
]);

const SHORT_KEYWORD_ALLOWLIST = new Set(["ani", "sr", "ur", "ssr", "r", "n"]);

const buildCardPricingInput = (card: GalleryCardRecord): CardPricingInput => ({
  galleryPrice: Number(card.price),
  metadataPrice: readMetadataPrice(card.metadata),
  title: card.title,
  description: card.description,
  tags: card.tags,
  style: card.style,
  rarity: card.rarity,
  category: card.category,
  character: card.character,
  color: card.color,
  marketingTitle: readMetadataString(card.metadata, "marketingTitle"),
});

const toDto = (card: GalleryCardRecord): GalleryCardDto => {
  const pricing = cardPricingService.calculate(buildCardPricingInput(card));

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
    price: pricing.finalPrice,
    score: card.score,
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

const normalizeKeyword = (value: string): string => value.trim().toLowerCase();

const dedupeKeywordList = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    const normalized = normalizeKeyword(trimmed);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(trimmed);
  }

  return result;
};

const isRepositoryKeywordCandidate = (value: string): boolean => {
  const normalized = normalizeKeyword(value);
  if (!normalized) {
    return false;
  }

  if (META_ONLY_REFRESH_KEYWORDS.has(normalized)) {
    return false;
  }

  if (normalized.startsWith("previous ") || normalized.startsWith("same ")) {
    return false;
  }

  const compact = normalized.replace(/\s+/g, " ").trim();
  if (compact.length <= 3 && !SHORT_KEYWORD_ALLOWLIST.has(compact)) {
    return false;
  }

  return true;
};

const sanitizePlannerKeywordList = (values: string[]): string[] =>
  dedupeKeywordList(
    normalizeGalleryKeywordsToEnglish(values)
      .map((value) => value.trim())
      .filter(isRepositoryKeywordCandidate)
  );

const isJsonObject = (value: Prisma.JsonValue): value is Prisma.JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readMetadataString = (metadata: Prisma.JsonValue | null, key: string): string | null => {
  if (!metadata || !isJsonObject(metadata)) {
    return null;
  }

  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const readMetadataPrice = (metadata: Prisma.JsonValue | null): string | number | null => {
  if (!metadata || !isJsonObject(metadata)) {
    return null;
  }

  const value = metadata.price;
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }

  return null;
};

const readSessionCardSummaries = (results: Prisma.JsonValue): RefreshPlannerCardSummary[] => {
  if (!Array.isArray(results)) {
    return [];
  }

  return results
    .filter(isJsonObject)
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      title: typeof item.title === "string" ? item.title : "",
      tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [],
      style: typeof item.style === "string" ? item.style : "",
      color: typeof item.color === "string" ? item.color : "",
      rarity: typeof item.rarity === "string" ? item.rarity : "",
    }))
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

const buildRefreshPrompt = (payload: RefreshPlannerPromptPayload): DeepSeekMessage[] => [
  {
    role: "system",
    content:
      "You are a refresh planner for LootCardChoose gallery search. Return JSON only with this shape: " +
      "{\"language\":\"zh|en\",\"refreshMode\":\"next_batch|refine|broaden|need_clarification\"," +
      "\"keep\":string[],\"avoid\":string[],\"broaden\":string[],\"searchKeywords\":string[]," +
      "\"reason\":string,\"shouldAskClarifyingQuestion\":boolean,\"shortQuestion\":string}. " +
      "Keep search keywords short and English-first. " +
      "Reflect lightly on why the previous batch may not fit. " +
      "Preserve core preference keywords from the previous query unless the user clearly asks for a different style. " +
      "Add concise avoid terms like previous cards or same composition when helpful. " +
      "Use next_batch when the user simply wants more similar options. " +
      "Use refine when the user dislikes the current cards. " +
      "Use broaden when the user wants another style or related options. " +
      "Only use need_clarification if the request is truly ambiguous. " +
      "Example JSON: " +
      "{\"language\":\"en\",\"refreshMode\":\"refine\",\"keep\":[\"female character\",\"SSR\",\"anime\"]," +
      "\"avoid\":[\"previous cards\",\"same composition\"],\"broaden\":[\"premium\",\"fantasy\",\"elegant\"]," +
      "\"searchKeywords\":[\"female character\",\"SSR\",\"anime\",\"premium\",\"fantasy\"]," +
      "\"reason\":\"The user dislikes the current batch and wants a closer stylistic match.\"," +
      "\"shouldAskClarifyingQuestion\":false,\"shortQuestion\":\"\"}. " +
      "The arrays keep, avoid, broaden, and searchKeywords are used directly for repository filtering and ranking, " +
      "so only output short concrete keyword phrases, never full sentences. " +
      "Use previousCards and sessionMetadata to avoid repeating recently shown cards or the same stale style. " +
      "Prefer visual descriptors, character traits, rarity, tone, and style cues over generic words. " +
      "Only output phrases that could realistically appear in title, tags, style, category, character, color, or description. " +
      "Never output broken fragments such as previous s, sa composition, cha, or other truncated tokens. " +
      "Treat previous cards and same composition as semantic hints, not as literal retrieval phrases. " +
      "If the user only wants another batch, keep the core preference stable and avoid over-broadening. " +
      "If the close-match pool appears exhausted, set refreshMode to need_clarification and ask for one new style, color, or theme cue. " +
      "If you ask a clarifying question, set refreshMode to need_clarification and keep the question short. " +
      "Do not write explanations outside JSON.",
  },
  {
    role: "user",
    content: JSON.stringify(payload),
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
      keep: sanitizePlannerKeywordList(safeArray(parsed.keep)),
      avoid: sanitizePlannerKeywordList(safeArray(parsed.avoid)),
      broaden: sanitizePlannerKeywordList(safeArray(parsed.broaden)),
      searchKeywords: sanitizePlannerKeywordList(safeArray(parsed.searchKeywords)),
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
  excludeIds: string[],
  hints?: RefreshSearchHints
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
  preferredKeywords: hints?.preferredKeywords ?? [],
  broadenKeywords: hints?.broadenKeywords ?? [],
  avoidKeywords: hints?.avoidKeywords ?? [],
});

const buildBroadenedSearchInput = (
  parsedQuery: ParsedGalleryQuery,
  keywords: string[],
  limit: number,
  excludeIds: string[],
  hints?: RefreshSearchHints
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
  preferredKeywords: hints?.preferredKeywords ?? [],
  broadenKeywords: hints?.broadenKeywords ?? [],
  avoidKeywords: hints?.avoidKeywords ?? [],
});

export const buildStructuredGalleryKeywords = (parsedQuery: ParsedGalleryQuery): string[] => {
  const rawValues = [
    ...parsedQuery.keywords,
    ...parsedQuery.tags,
    ...STRUCTURED_FIELDS.map((field) => parsedQuery[field]),
  ].filter(Boolean);

  return expandGalleryKeywords(rawValues.map((value) => canonicalizeGalleryTerm(value)));
};

const buildAppliedRefreshKeywords = (
  decision: RefreshDecision,
  previousParsed: ParsedGalleryQuery
): Pick<GalleryRefreshResult, "keep" | "avoid" | "broaden" | "searchKeywords"> => {
  const keep =
    decision.keep.length > 0
      ? sanitizePlannerKeywordList(decision.keep)
      : buildStructuredGalleryKeywords(previousParsed);
  const broaden = decision.broaden.length > 0 ? sanitizePlannerKeywordList(decision.broaden) : [];
  const searchKeywords =
    decision.searchKeywords.length > 0 ? sanitizePlannerKeywordList(decision.searchKeywords) : keep;
  const positiveKeywordSet = new Set([...keep, ...broaden, ...searchKeywords].map(normalizeKeyword));
  const avoid = sanitizePlannerKeywordList(decision.avoid).filter(
    (keyword) => !positiveKeywordSet.has(normalizeKeyword(keyword))
  );

  return {
    keep,
    avoid,
    broaden,
    searchKeywords,
  };
};

const buildDefaultSessionMetadata = (
  previousSession: GallerySearchSessionRecord,
  previousCards: RefreshPlannerCardSummary[],
  excludeIds: string[]
): RefreshPlannerSessionMetadata => ({
  previousSessionId: previousSession.id,
  displaySessionId: previousSession.id,
  anchorSessionId: previousSession.id,
  previousQuery: previousSession.query,
  originalQuery: previousSession.query,
  previousBatchSize: previousCards.length,
  previousBatchCardIds: previousCards.map((card) => card.id),
  recentActiveSessionCount: 1,
  totalExcludedCardCount: excludeIds.length,
  latestBatchIndex: 1,
  recentRefreshModes: [],
  hasSelectedCard: Boolean(previousSession.selectedGalleryCardId),
});

const buildPoolExhaustedQuestion = (language: SupportedLanguage): string => t(language, "gallery.refresh.poolExhausted");

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));

const REFRESH_PLANNER_TIMEOUT_ERROR = "GALLERY_REFRESH_PLANNER_TIMEOUT";

export const galleryService = {
  async searchGalleryCards(query: string, language: SupportedLanguage = "en"): Promise<GallerySearchResult> {
    logger.info("[GALLERY SERVICE] search", { query, language });
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

    logger.info("[GALLERY SERVICE] parsed search input", parsedQuery);

    const structuredKeywords = buildStructuredGalleryKeywords(parsedQuery);
    logger.info("[GALLERY SERVICE] structured keywords", { structuredKeywords });

    const fallbackKeywords = structuredKeywords.length > 0 ? [] : normalizeGalleryKeywordsToEnglish([query]);
    if (structuredKeywords.length === 0) {
      logger.info("[GALLERY SERVICE] raw query fallback", {
        query,
        fallbackKeywords,
        reason: "structured_keywords_empty",
      });
    }
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
    logger.info("[GALLERY SERVICE] final result count", { count: results.length, query });

    return {
      query,
      language: parsedQuery.language,
      parsedQuery,
      structuredKeywords,
      results,
      limit,
    };
  },

  async refreshGalleryCards(input: RefreshGalleryCardsInput): Promise<GalleryRefreshResult> {
    logger.info("[GALLERY SERVICE] refresh", {
      query: input.previousSession.query,
      displaySessionId: input.displaySession?.id ?? input.previousSession.id,
      anchorSessionId: input.previousSession.id,
    });
    if (!isDatabaseReady()) {
      throw new Error("DATABASE_NOT_READY");
    }

    const language = extractSessionLanguage(input.previousSession);
    const previousParsed =
      (await parseGalleryQuery(input.previousSession.query, language)) ??
      buildFallbackParsedQuery(input.previousSession.query, language);
    const limit = normalizeGalleryLimit(input.limit ?? previousParsed.limit, DEFAULT_GALLERY_RESULT_LIMIT);

    const fallbackDecision = buildFallbackRefreshDecision(input.currentMessage, previousParsed, language);
    const previousCards = readSessionCardSummaries(input.previousSession.results);
    const sessionMetadata =
      input.sessionMetadata ?? buildDefaultSessionMetadata(input.previousSession, previousCards, input.excludeIds);
    const promptPayload: RefreshPlannerPromptPayload = {
      language,
      userFeedback: input.currentMessage,
      previousQuery: previousParsed,
      previousCards: previousCards.slice(0, 6),
      sessionMetadata,
    };
    logger.info("[GALLERY SERVICE] refresh prompt context", promptPayload);

    const env = loadEnv();
    let decision = fallbackDecision;

    if (env.enableNaturalLanguageSearch && env.deepseekApiKey) {
      const controller = new AbortController();
      let timeoutHandle: NodeJS.Timeout | undefined;

      try {
        const response = await Promise.race<
          | {
              ok: true;
              payload: DeepSeekResponse;
            }
          | {
              ok: false;
              status: number;
            }
        >([
          (async () => {
            const httpResponse = await fetch(`${env.deepseekBaseUrl}/chat/completions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${env.deepseekApiKey}`,
              },
              body: JSON.stringify({
                model: env.deepseekModel,
                temperature: 0,
                messages: buildRefreshPrompt(promptPayload),
              }),
              signal: controller.signal,
            });

            if (!httpResponse.ok) {
              return {
                ok: false as const,
                status: httpResponse.status,
              };
            }

            return {
              ok: true as const,
              payload: (await httpResponse.json()) as DeepSeekResponse,
            };
          })(),
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              controller.abort();
              reject(new Error(REFRESH_PLANNER_TIMEOUT_ERROR));
            }, REFRESH_PLANNER_TIMEOUT_MS);
          }),
        ]);

        if (response.ok) {
          const content = response.payload.choices?.[0]?.message?.content?.trim() ?? "";
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
        } else {
          logger.warn("[GALLERY SERVICE] refresh planner fallback", {
            query: input.previousSession.query,
            reason: "non_200",
            status: response.status,
          });
        }
      } catch (error) {
        if ((error instanceof Error && error.message === REFRESH_PLANNER_TIMEOUT_ERROR) || isAbortError(error)) {
          logger.warn("[GALLERY SERVICE] refresh planner timeout", {
            query: input.previousSession.query,
            timeoutMs: REFRESH_PLANNER_TIMEOUT_MS,
          });
        } else {
          logger.warn("[GALLERY SERVICE] refresh planner fallback", {
            query: input.previousSession.query,
            reason: "network_error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }
    }

    logger.info("[GALLERY SERVICE] refresh planner decision", decision);
    const appliedKeywords = buildAppliedRefreshKeywords(decision, previousParsed);
    logger.info("[GALLERY SERVICE] refresh applied keywords", appliedKeywords);

    if (decision.shouldAskClarifyingQuestion || decision.refreshMode === "need_clarification") {
      return {
        cards: [],
        language: decision.language,
        refreshMode: "need_clarification",
        reason: decision.reason,
        shortQuestion: decision.shortQuestion || t(decision.language, "gallery.refresh.needClarification"),
        limit,
        excludedCardIds: input.excludeIds,
        parsedQuery: previousParsed,
        keep: appliedKeywords.keep,
        avoid: appliedKeywords.avoid,
        broaden: appliedKeywords.broaden,
        searchKeywords: appliedKeywords.searchKeywords,
        poolExhausted: false,
      };
    }

    const strictResults = await galleryRepository.search(
      buildStrictSearchInput(previousParsed, appliedKeywords.keep, limit, input.excludeIds, {
        preferredKeywords: appliedKeywords.keep,
        avoidKeywords: appliedKeywords.avoid,
      })
    );

    let chosenMode: Exclude<RefreshMode, "need_clarification"> = decision.refreshMode;
    let finalCards = strictResults;

    if (finalCards.length < limit && appliedKeywords.searchKeywords.length > 0) {
      const refinedResults = await galleryRepository.search(
        buildStrictSearchInput(previousParsed, appliedKeywords.searchKeywords, limit, input.excludeIds, {
          preferredKeywords: dedupeKeywordList([...appliedKeywords.keep, ...appliedKeywords.searchKeywords]),
          avoidKeywords: appliedKeywords.avoid,
        })
      );
      finalCards = dedupeCards([...finalCards, ...refinedResults]);
      if (chosenMode === "next_batch" && refinedResults.length > strictResults.length) {
        chosenMode = "refine";
      }
    }

    if (finalCards.length < limit && appliedKeywords.broaden.length > 0) {
      const broadenedResults = await galleryRepository.search(
        buildBroadenedSearchInput(
          previousParsed,
          dedupeKeywordList([...appliedKeywords.keep, ...appliedKeywords.broaden]),
          limit,
          input.excludeIds,
          {
            preferredKeywords: appliedKeywords.keep,
            broadenKeywords: appliedKeywords.broaden,
            avoidKeywords: appliedKeywords.avoid,
          }
        )
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

    if (finalCards.length === 0) {
      const reason =
        decision.language === "zh"
          ? "当前搜索方向的近似卡牌已经基本展示完了。"
          : "The close-match pool is exhausted for this search.";

      return {
        cards: [],
        language: decision.language,
        refreshMode: "need_clarification",
        reason,
        shortQuestion: buildPoolExhaustedQuestion(decision.language),
        limit,
        excludedCardIds: input.excludeIds,
        parsedQuery: previousParsed,
        keep: appliedKeywords.keep,
        avoid: appliedKeywords.avoid,
        broaden: appliedKeywords.broaden,
        searchKeywords: appliedKeywords.searchKeywords,
        poolExhausted: true,
      };
    }

    return {
      cards: finalCards.slice(0, limit).map(toDto),
      language: decision.language,
      refreshMode: chosenMode,
      reason: decision.reason,
      limit,
      excludedCardIds: input.excludeIds,
      parsedQuery: previousParsed,
      keep: appliedKeywords.keep,
      avoid: appliedKeywords.avoid,
      broaden: appliedKeywords.broaden,
      searchKeywords: appliedKeywords.searchKeywords,
      poolExhausted: chosenMode === "random_fallback" && finalCards.length < 3,
    };
  },

  async getGalleryCardById(cardId: string): Promise<GalleryCardDto | null> {
    if (!isDatabaseReady()) {
      throw new Error("DATABASE_NOT_READY");
    }
    const card = await galleryRepository.findById(cardId);
    return card ? toDto(card) : null;
  },

  async getGalleryCardPricingInput(cardId: string): Promise<GalleryCardPricingInputDto | null> {
    if (!isDatabaseReady()) {
      throw new Error("DATABASE_NOT_READY");
    }

    const card = await galleryRepository.findById(cardId);
    if (!card) {
      return null;
    }

    const pricingInput = buildCardPricingInput(card);
    return {
      galleryPrice: pricingInput.galleryPrice ?? null,
      metadataPrice: pricingInput.metadataPrice ?? null,
      title: pricingInput.title ?? card.title,
      description: pricingInput.description ?? card.description,
      tags: pricingInput.tags ?? card.tags,
      style: pricingInput.style ?? card.style,
      rarity: pricingInput.rarity ?? card.rarity,
      category: pricingInput.category ?? card.category,
      character: pricingInput.character ?? card.character,
      color: pricingInput.color ?? card.color,
      marketingTitle: pricingInput.marketingTitle ?? null,
    };
  },
};
