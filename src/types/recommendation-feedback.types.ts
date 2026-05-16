import type { SupportedLanguage } from "../hermes/types";

export type RecommendationFeedbackEventType =
  | "search"
  | "selection"
  | "checkout_created"
  | "purchase_completed";

export type RecommendationFeedbackCardSummary = {
  id: string;
  title: string;
  scoreTotal: number;
  scoreReasons: string[];
};

export type RecommendationFeedbackParsedOldFields = {
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

export type RecommendationFeedbackIntelligenceQuery = {
  visualStyle: string[];
  moodTags: string[];
  toneTags: string[];
  characterTypes: string[];
  archetypeTags: string[];
  settingTags: string[];
  genreTags: string[];
  colorHints: string[];
  rarityHints: string[];
  commerceIntent: string[];
  safetyIntent: "safe" | "neutral" | "adult" | "unknown";
};

export type RecommendationFeedbackDebugSummary = {
  parsedOldFields: RecommendationFeedbackParsedOldFields;
  intelligenceQuery: RecommendationFeedbackIntelligenceQuery;
  candidateCount: number;
  usedFallback: boolean;
  rerankHappened?: boolean;
  parserOutcome?:
    | "llm_success"
    | "timeout_fallback"
    | "json_parse_fallback"
    | "missing_api_key_fallback"
    | "network_fallback"
    | "non_200_fallback"
    | "disabled"
    | "unknown";
  parserTimedOut?: boolean;
  parserUsedFallback?: boolean;
  parserFallbackReason?: string | null;
  top10BeforeRerank: RecommendationFeedbackCardSummary[];
  top10AfterRerank: RecommendationFeedbackCardSummary[];
};

export type RecommendationFeedbackEvent = {
  timestamp: string;
  eventType: RecommendationFeedbackEventType;
  sessionId: string | null;
  orderNumber: string | null;
  query: string | null;
  selectedCardId: string | null;
  checkoutCreated: boolean;
  purchased: boolean;
  orphan: boolean;
  parserOutcome?:
    | "llm_success"
    | "timeout_fallback"
    | "json_parse_fallback"
    | "missing_api_key_fallback"
    | "network_fallback"
    | "non_200_fallback"
    | "disabled"
    | "unknown";
  parserTimedOut?: boolean;
  parserUsedFallback?: boolean;
  parserFallbackReason?: string | null;
  rerankHappened?: boolean;
  recommendationDebugSummary: RecommendationFeedbackDebugSummary | null;
};

export type RecommendationFeedbackSearchInput = {
  sessionId: string | null;
  query: string;
};

export type RecommendationFeedbackSelectionInput = {
  sessionId: string | null;
  query: string | null;
  selectedCardId: string;
};

export type RecommendationFeedbackCheckoutInput = {
  sessionId: string | null;
  orderNumber: string;
  query: string | null;
  selectedCardId: string;
  discordUserId: string | null;
};

export type RecommendationFeedbackCapturedSnapshot = {
  query: string;
  summary: RecommendationFeedbackDebugSummary;
};

export type RecommendationFeedbackContext = {
  sessionId: string | null;
  query: string | null;
  selectedCardId: string | null;
  discordUserId: string | null;
  recommendationDebugSummary: RecommendationFeedbackDebugSummary | null;
};
