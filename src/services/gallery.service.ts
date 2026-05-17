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
import { recommendationFeedbackService } from "./recommendation-feedback.service";
import type { RecommendationDebugEntry } from "../types/gallery-recommendation.types";
import type { RecommendationScore } from "../types/gallery-recommendation.types";
import type {
  RecommendationCommerceIntelligence,
  RecommendationCommercePresentation,
  RecommendationCuratorNarration,
} from "../types/gallery-recommendation.types";
import type { RecommendationFeedbackDebugSummary } from "../types/recommendation-feedback.types";
import { cardPricingService, CardPricingInput } from "./card-pricing.service";
import { galleryRecommendationService } from "./gallery-recommendation.service";
import { recommendationAnalyticsService } from "./recommendation-analytics.service";
import {
  ParsedGalleryQuery,
  getLastQueryParserTelemetry,
  parseGalleryQuery,
  QueryParserTelemetry,
} from "./llm-query-parser.service";
import { isDatabaseReady } from "./prisma.service";

export const DEFAULT_GALLERY_RESULT_LIMIT = 10;
export const REFRESH_PLANNER_TIMEOUT_MS = 8000;
const RECOMMENDATION_CANDIDATE_LIMIT = 30;
const RECOMMENDATION_SEARCH_SLICE_LIMIT = 10;
const RECOMMENDATION_DEBUG_LIMIT = 10;

let lastRecommendationDebugSnapshot: RecommendationDebugSnapshot | null = null;

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
  commerceIntelligence?: RecommendationCommerceIntelligence;
  commercePresentation?: RecommendationCommercePresentation;
  curatorNarration?: RecommendationCuratorNarration;
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
  summaryText?: string;
  exactResultCount: number;
  recoveryTriggered: boolean;
  recoveryResultCount: number;
  curatorNarrationUsed: boolean;
  responseTextSource: "curator_summary" | "recovery_summary" | "legacy_success" | "legacy_empty";
};

export type RecommendationDebugCardSummary = {
  id: string;
  title: string;
  scoreTotal: number;
  scoreReasons: string[];
  recommendationScore?: RecommendationScore;
  commerceIntelligence?: RecommendationCommerceIntelligence;
  commercePresentation?: RecommendationCommercePresentation;
};

export type RecommendationDebugSnapshot = {
  rawQuery: string;
  parsedOldFields: {
    language: SupportedLanguage;
    keywords: string[];
    tags: string[];
    style: string;
    rarity: string;
    category: string;
    character: string;
    color: string;
    mood: string;
    scene: string;
    limit: number;
  };
  intelligenceQuery: ParsedGalleryQuery["intelligenceQuery"];
  candidateCount: number;
  usedFallback: boolean;
  rerankHappened: boolean;
  parserTelemetry?: QueryParserTelemetry;
  top10BeforeRerank: RecommendationDebugCardSummary[];
  top10AfterRerank: RecommendationDebugCardSummary[];
  scoreBreakdowns: RecommendationDebugCardSummary[];
};

type RecommendationDebugLogPayload = {
  rawQuery: string;
  parsedOldFields: RecommendationDebugSnapshot["parsedOldFields"];
  intelligenceQuery: Partial<ParsedGalleryQuery["intelligenceQuery"]> | undefined;
  candidateCount: number;
  usedFallback: boolean;
  rerankHappened: boolean;
  parserTelemetry?: QueryParserTelemetry;
  top10BeforeRerank: RecommendationDebugCardSummary[];
  top10AfterRerank: RecommendationDebugCardSummary[];
  scoreBreakdowns: RecommendationDebugCardSummary[];
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
  summaryText?: string;
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

const buildCommerceTags = (
  entry: RecommendationDebugEntry | undefined,
  analyticsHints: Awaited<ReturnType<typeof recommendationAnalyticsService.getCommerceOptimizationInsights>>
): string[] => {
  if (!entry?.commercePresentation) {
    return [];
  }

  const lines = [
    entry.commercePresentation.collectorPositioning,
    entry.commercePresentation.rarityFraming,
    entry.commercePresentation.auraPresentation,
  ];

  if (
    analyticsHints.sparseFamilies.some((family) =>
      ["cyberpunk", "mecha", "boss like", "priestess", "holy", "divine"].includes(family)
    )
  ) {
    const emphasized = analyticsHints.sparseFamilies
      .filter((family) => ["cyberpunk", "mecha", "boss like", "priestess", "holy", "divine"].includes(family))
      .slice(0, 2)
      .join(" / ");
    lines.push(`Analytics signal: ${emphasized} collectible themes need stronger commerce framing`);
  }

  return lines.map((line) => `commerce:${line}`);
};

const decorateDtoWithCommerce = (
  card: GalleryCardRecord,
  entry: RecommendationDebugEntry | undefined,
  analyticsHints: Awaited<ReturnType<typeof recommendationAnalyticsService.getCommerceOptimizationInsights>>
): GalleryCardDto => {
  const dto = toDto(card);
  const commerceTags = buildCommerceTags(entry, analyticsHints);

  return {
    ...dto,
    tags: [...dto.tags, ...commerceTags],
    commerceIntelligence: entry?.commerceIntelligence,
    commercePresentation: entry?.commercePresentation,
  };
};

const decorateDtoWithNarration = (
  card: GalleryCardRecord,
  dto: GalleryCardDto,
  parsedQuery: ParsedGalleryQuery,
  entry?: RecommendationDebugEntry
): GalleryCardDto => ({
  ...dto,
  curatorNarration:
    entry?.curatorNarration ??
    galleryRecommendationService.buildCuratorNarrationForCard({
      card,
      parsedQuery,
      intelligenceQuery: parsedQuery.intelligenceQuery,
    }),
});

const buildSummaryFromCardNarration = (cards: GalleryCardDto[]): string | null => {
  const narrationLines = cards[0]?.curatorNarration?.embedLines?.map((line) => line.trim()).filter(Boolean) ?? [];
  if (narrationLines.length === 0) {
    return null;
  }

  return narrationLines.slice(0, 2).join(" ");
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

const compactScoreReasons = (entry: RecommendationDebugEntry): string[] => {
  if (entry.recommendationScore.reasons.length > 0) {
    return [...entry.recommendationScore.reasons];
  }

  const { breakdown } = entry;
  const reasons: string[] = [];
  if (breakdown.visualMatch) reasons.push(`visual:+${breakdown.visualMatch}`);
  if (breakdown.moodEmotionalMatch) reasons.push(`mood:+${breakdown.moodEmotionalMatch}`);
  if (breakdown.characterMatch) reasons.push(`character:+${breakdown.characterMatch}`);
  if (breakdown.worldbuildingMatch) reasons.push(`world:+${breakdown.worldbuildingMatch}`);
  if (breakdown.commerceMatch) reasons.push(`commerce:+${breakdown.commerceMatch}`);
  return reasons;
};

const buildRecommendationDebugCardSummary = (
  card: Pick<GalleryCardRecord, "id" | "title">,
  scoreBreakdown?: RecommendationDebugEntry
): RecommendationDebugCardSummary => ({
  id: card.id,
  title: card.title,
  scoreTotal: scoreBreakdown?.breakdown.total ?? 0,
  scoreReasons: scoreBreakdown ? compactScoreReasons(scoreBreakdown) : ["legacy-order"],
  recommendationScore: scoreBreakdown?.recommendationScore,
  commerceIntelligence: scoreBreakdown?.commerceIntelligence,
  commercePresentation: scoreBreakdown?.commercePresentation,
});

const buildRecommendationDebugSnapshot = (input: {
  rawQuery: string;
  parsedQuery: ParsedGalleryQuery;
  candidateCards: GalleryCardRecord[];
  resultsSource: GalleryCardRecord[];
  rerankedCards: GalleryCardRecord[];
  scoreBreakdowns: RecommendationDebugEntry[];
  usedFallback: boolean;
  rerankHappened: boolean;
  parserTelemetry?: QueryParserTelemetry;
}): RecommendationDebugSnapshot => {
  const scoreByCardId = new Map(input.scoreBreakdowns.map((entry) => [entry.cardId, entry]));

  return {
    rawQuery: input.rawQuery,
    parsedOldFields: {
      language: input.parsedQuery.language,
      keywords: input.parsedQuery.keywords,
      tags: input.parsedQuery.tags,
      style: input.parsedQuery.style,
      rarity: input.parsedQuery.rarity,
      category: input.parsedQuery.category,
      character: input.parsedQuery.character,
      color: input.parsedQuery.color,
      mood: input.parsedQuery.mood,
      scene: input.parsedQuery.scene,
      limit: input.parsedQuery.limit,
    },
    intelligenceQuery: input.parsedQuery.intelligenceQuery,
    candidateCount: input.candidateCards.length,
    usedFallback: input.usedFallback,
    rerankHappened: input.rerankHappened,
    parserTelemetry: input.parserTelemetry,
    top10BeforeRerank: input.resultsSource.slice(0, RECOMMENDATION_DEBUG_LIMIT).map((card) =>
      buildRecommendationDebugCardSummary(card, scoreByCardId.get(card.id))
    ),
    top10AfterRerank: input.rerankedCards.slice(0, RECOMMENDATION_DEBUG_LIMIT).map((card) =>
      buildRecommendationDebugCardSummary(card, scoreByCardId.get(card.id))
    ),
    scoreBreakdowns: input.rerankedCards.slice(0, RECOMMENDATION_DEBUG_LIMIT).map((card) =>
      buildRecommendationDebugCardSummary(card, scoreByCardId.get(card.id))
    ),
  };
};

const buildRecommendationLogPayload = (
  snapshot: RecommendationDebugSnapshot
): RecommendationDebugLogPayload => {
  const intelligenceQuery = snapshot.intelligenceQuery;

  const compactIntelligenceQuery = intelligenceQuery
    ? {
        ...(intelligenceQuery.visualStyle.length > 0 ? { visualStyle: intelligenceQuery.visualStyle } : {}),
        ...(intelligenceQuery.moodTags.length > 0 ? { moodTags: intelligenceQuery.moodTags } : {}),
        ...(intelligenceQuery.toneTags.length > 0 ? { toneTags: intelligenceQuery.toneTags } : {}),
        ...(intelligenceQuery.characterTypes.length > 0 ? { characterTypes: intelligenceQuery.characterTypes } : {}),
        ...(intelligenceQuery.archetypeTags.length > 0 ? { archetypeTags: intelligenceQuery.archetypeTags } : {}),
        ...(intelligenceQuery.settingTags.length > 0 ? { settingTags: intelligenceQuery.settingTags } : {}),
        ...(intelligenceQuery.genreTags.length > 0 ? { genreTags: intelligenceQuery.genreTags } : {}),
        ...(intelligenceQuery.colorHints.length > 0 ? { colorHints: intelligenceQuery.colorHints } : {}),
        ...(intelligenceQuery.rarityHints.length > 0 ? { rarityHints: intelligenceQuery.rarityHints } : {}),
        ...(intelligenceQuery.commerceIntent.length > 0 ? { commerceIntent: intelligenceQuery.commerceIntent } : {}),
        safetyIntent: intelligenceQuery.safetyIntent,
      }
    : undefined;

  return {
    rawQuery: snapshot.rawQuery,
    parsedOldFields: snapshot.parsedOldFields,
    intelligenceQuery: compactIntelligenceQuery,
    candidateCount: snapshot.candidateCount,
    usedFallback: snapshot.usedFallback,
    rerankHappened: snapshot.rerankHappened,
    ...(snapshot.parserTelemetry ? { parserTelemetry: snapshot.parserTelemetry } : {}),
    top10BeforeRerank: snapshot.top10BeforeRerank.slice(0, RECOMMENDATION_DEBUG_LIMIT),
    top10AfterRerank: snapshot.top10AfterRerank.slice(0, RECOMMENDATION_DEBUG_LIMIT),
    scoreBreakdowns: snapshot.scoreBreakdowns.slice(0, RECOMMENDATION_DEBUG_LIMIT),
  };
};

export const getLastRecommendationDebugSnapshot = (): RecommendationDebugSnapshot | null =>
  lastRecommendationDebugSnapshot;

export const getLastRecommendationFeedbackSummary = (): RecommendationFeedbackDebugSummary | null => {
  if (!lastRecommendationDebugSnapshot) {
    return null;
  }

  const intelligenceQuery = lastRecommendationDebugSnapshot.intelligenceQuery ?? {
    visualStyle: [],
    moodTags: [],
    toneTags: [],
    characterTypes: [],
    archetypeTags: [],
    settingTags: [],
    genreTags: [],
    colorHints: [],
    rarityHints: [],
    commerceIntent: [],
    visualIntent: [],
    emotionalIntent: [],
    characterIntent: [],
    worldbuildingIntent: [],
    confidence: 0,
    language: "unknown" as const,
    reason: "",
    safetyIntent: "unknown" as const,
  };

  return {
    parsedOldFields: {
      ...lastRecommendationDebugSnapshot.parsedOldFields,
      keywords: [...lastRecommendationDebugSnapshot.parsedOldFields.keywords],
      tags: [...lastRecommendationDebugSnapshot.parsedOldFields.tags],
    },
    intelligenceQuery: {
      ...intelligenceQuery,
      visualStyle: [...intelligenceQuery.visualStyle],
      moodTags: [...intelligenceQuery.moodTags],
      toneTags: [...intelligenceQuery.toneTags],
      characterTypes: [...intelligenceQuery.characterTypes],
      archetypeTags: [...intelligenceQuery.archetypeTags],
      settingTags: [...intelligenceQuery.settingTags],
      genreTags: [...intelligenceQuery.genreTags],
      colorHints: [...intelligenceQuery.colorHints],
      rarityHints: [...intelligenceQuery.rarityHints],
      commerceIntent: [...intelligenceQuery.commerceIntent],
    },
    candidateCount: lastRecommendationDebugSnapshot.candidateCount,
    usedFallback: lastRecommendationDebugSnapshot.usedFallback,
    rerankHappened: lastRecommendationDebugSnapshot.rerankHappened,
    ...(lastRecommendationDebugSnapshot.parserTelemetry
      ? {
          parserOutcome: lastRecommendationDebugSnapshot.parserTelemetry.parserOutcome,
          parserTimedOut: lastRecommendationDebugSnapshot.parserTelemetry.parserTimedOut,
          parserUsedFallback: lastRecommendationDebugSnapshot.parserTelemetry.parserUsedFallback,
          parserFallbackReason: lastRecommendationDebugSnapshot.parserTelemetry.parserFallbackReason,
        }
      : {}),
    top10BeforeRerank: lastRecommendationDebugSnapshot.top10BeforeRerank.map((item) => ({
      id: item.id,
      title: item.title,
      scoreTotal: item.scoreTotal,
      scoreReasons: [...item.scoreReasons],
      commerceIntelligence: item.commerceIntelligence ? { ...item.commerceIntelligence } : undefined,
      commercePresentation: item.commercePresentation
        ? {
            ...item.commercePresentation,
            commerceReasons: [...item.commercePresentation.commerceReasons],
          }
        : undefined,
      recommendationScore: item.recommendationScore ? { ...item.recommendationScore, reasons: [...item.recommendationScore.reasons] } : undefined,
    })),
    top10AfterRerank: lastRecommendationDebugSnapshot.top10AfterRerank.map((item) => ({
      id: item.id,
      title: item.title,
      scoreTotal: item.scoreTotal,
      scoreReasons: [...item.scoreReasons],
      commerceIntelligence: item.commerceIntelligence ? { ...item.commerceIntelligence } : undefined,
      commercePresentation: item.commercePresentation
        ? {
            ...item.commercePresentation,
            commerceReasons: [...item.commercePresentation.commerceReasons],
          }
        : undefined,
      recommendationScore: item.recommendationScore ? { ...item.recommendationScore, reasons: [...item.recommendationScore.reasons] } : undefined,
    })),
  };
};

const buildFallbackParsedQuery = (query: string, language: SupportedLanguage): ParsedGalleryQuery => ({
  language,
  keywords: normalizeGalleryKeywordsToEnglish([query]),
  tags: [],
  visualStyle: [],
  moodTags: [],
  toneTags: [],
  characterTypes: [],
  archetypeTags: [],
  settingTags: [],
  genreTags: [],
  colorHints: [],
  style: "",
  rarity: "",
  category: "",
  character: "",
  color: "",
  mood: "",
  scene: "",
  limit: DEFAULT_GALLERY_RESULT_LIMIT,
  intelligenceQuery: undefined,
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

const buildRecommendationKeywordHeavyInput = (
  parsedQuery: ParsedGalleryQuery,
  keywords: string[],
  tags: string[]
) => ({
  keywords,
  tags,
  style: "",
  rarity: parsedQuery.rarity,
  category: "",
  character: "",
  color: "",
  mood: "",
  scene: "",
  limit: RECOMMENDATION_SEARCH_SLICE_LIMIT,
});

const buildRecommendationStructuredHeavyInput = (
  parsedQuery: ParsedGalleryQuery,
  keywords: string[]
) => ({
  keywords: keywords.slice(0, Math.min(5, keywords.length)),
  tags: [],
  style: parsedQuery.style,
  rarity: parsedQuery.rarity,
  category: parsedQuery.category,
  character: parsedQuery.character,
  color: parsedQuery.color,
  mood: "",
  scene: parsedQuery.scene,
  limit: RECOMMENDATION_SEARCH_SLICE_LIMIT,
});

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
    const parserTelemetry = getLastQueryParserTelemetry();
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

    let candidateCards = resultsSource;

    try {
      const [keywordHeavyResults, structuredHeavyResults] = await Promise.all([
        galleryRepository.search(buildRecommendationKeywordHeavyInput(parsedQuery, finalKeywords, finalTags)),
        galleryRepository.search(buildRecommendationStructuredHeavyInput(parsedQuery, finalKeywords)),
      ]);

      candidateCards = dedupeCards([...resultsSource, ...keywordHeavyResults, ...structuredHeavyResults]).slice(
        0,
        RECOMMENDATION_CANDIDATE_LIMIT
      );
    } catch (error) {
      candidateCards = resultsSource;
      logger.warn("[GALLERY SERVICE] recommendation candidate fallback", {
        query,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const recommendationResult = galleryRecommendationService.rerank({
      parsedQuery,
      intelligenceQuery: parsedQuery.intelligenceQuery,
      candidates: candidateCards,
    });
    const rerankedCards = recommendationResult.cards;

    lastRecommendationDebugSnapshot = buildRecommendationDebugSnapshot({
      rawQuery: query,
      parsedQuery,
      candidateCards,
      resultsSource,
      rerankedCards,
      scoreBreakdowns: recommendationResult.scoreBreakdowns,
      usedFallback: recommendationResult.usedFallback,
      rerankHappened: recommendationResult.rerankHappened,
      parserTelemetry,
    });

    recommendationFeedbackService.captureLatestSearchSnapshot({
      query,
      summary: getLastRecommendationFeedbackSummary()!,
    });

    logger.debug("[GALLERY SERVICE] recommendation debug", buildRecommendationLogPayload(lastRecommendationDebugSnapshot));

    const scoreByCardId = new Map(recommendationResult.scoreBreakdowns.map((entry) => [entry.cardId, entry]));
    const analyticsHints = await recommendationAnalyticsService.getCommerceOptimizationInsights().catch(() => ({
      dateKey: null,
      sparseFamilies: [],
      weakMatchFamilies: [],
      lowConversionThemes: [],
    }));
    const rankedCards = dedupeCards(rerankedCards).slice(0, limit);
    const results = rankedCards
      .map((card) => decorateDtoWithCommerce(card, scoreByCardId.get(card.id), analyticsHints))
      .map((dto, index) => decorateDtoWithNarration(rankedCards[index], dto, parsedQuery, scoreByCardId.get(rankedCards[index].id)));
    const summaryText =
      galleryRecommendationService.buildCuratorSummary({
        cards: rankedCards,
        parsedQuery,
        intelligenceQuery: parsedQuery.intelligenceQuery,
        language: parsedQuery.language,
      }) ?? buildSummaryFromCardNarration(results);
    const exactResultCount = resultsSource.length;
    const recoveryTriggered = exactResultCount === 0 && rankedCards.length > 0;
    const recoveryResultCount = recoveryTriggered ? rankedCards.length : 0;
    const curatorNarrationUsed = Boolean(summaryText?.trim());
    const responseTextSource: GallerySearchResult["responseTextSource"] = recoveryTriggered
      ? curatorNarrationUsed
        ? "recovery_summary"
        : "legacy_success"
      : curatorNarrationUsed
        ? "curator_summary"
        : results.length > 0
          ? "legacy_success"
          : "legacy_empty";

    logger.info("[GALLERY SERVICE] final result count", {
      count: results.length,
      query,
      exactResultCount,
      recoveryTriggered,
      recoveryResultCount,
      curatorNarrationUsed,
      responseTextSource,
    });

    return {
      query,
      language: parsedQuery.language,
      parsedQuery,
      structuredKeywords,
      results,
      limit,
      summaryText: summaryText ?? undefined,
      exactResultCount,
      recoveryTriggered,
      recoveryResultCount,
      curatorNarrationUsed,
      responseTextSource,
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

    const limitedCards = finalCards.slice(0, limit);
    const narratedCards = limitedCards.map((card) =>
      decorateDtoWithNarration(card, toDto(card), previousParsed)
    );
    const summaryText = galleryRecommendationService.buildCuratorSummary({
      cards: limitedCards,
      parsedQuery: previousParsed,
      intelligenceQuery: previousParsed.intelligenceQuery,
      language: decision.language,
    });

    return {
      cards: narratedCards,
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
      summaryText: summaryText ?? undefined,
    };
  },

  async getGalleryCardById(cardId: string): Promise<GalleryCardDto | null> {
    if (!isDatabaseReady()) {
      throw new Error("DATABASE_NOT_READY");
    }
    const card = await galleryRepository.findById(cardId);
    return card
      ? decorateDtoWithNarration(
          card,
          toDto(card),
          buildFallbackParsedQuery(card.title, detectPreferredLanguage(card.title))
        )
      : null;
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
