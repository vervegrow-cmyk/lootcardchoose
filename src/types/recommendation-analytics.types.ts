import type { RecommendationFeedbackEvent } from "./recommendation-feedback.types";

export type RecommendationAnalyticsDimensionKey =
  | "rarity"
  | "style"
  | "character"
  | "color"
  | "title"
  | "priceTier"
  | "visualStyle"
  | "moodTags"
  | "toneTags"
  | "characterTypes"
  | "archetypeTags"
  | "settingTags"
  | "genreTags"
  | "colorHints";

export type RecommendationAnalyticsSource = {
  file: string;
  timezone: string;
  requestedDate: string | null;
  dateKey: string;
  selectedBy: "explicit" | "default";
  content: string;
};

export type RecommendationAnalyticsDimensionBucket = {
  bucket: string;
  impressions: number;
  selections: number;
  checkoutCreated: number;
  purchases: number;
  selectionRate: number;
  checkoutRate: number;
  purchaseRate: number;
};

export type RecommendationAnalyticsCardPerformance = {
  cardId: string;
  title: string;
  impressions: number;
  selections: number;
  checkoutCreated: number;
  purchases: number;
  selectionRate: number;
  checkoutRate: number;
  purchaseRate: number;
};

export type RecommendationAnalyticsMetadataPerformance = Record<
  RecommendationAnalyticsDimensionKey,
  RecommendationAnalyticsDimensionBucket[]
>;

export type RecommendationAnalyticsTopPurchasedMetadata = Record<
  RecommendationAnalyticsDimensionKey,
  RecommendationAnalyticsDimensionBucket[]
>;

export type RecommendationAnalyticsCheckoutDropoffItem = {
  bucket: string;
  title: string;
  checkoutCreated: number;
  purchases: number;
  dropoffCount: number;
  dropoffRate: number;
};

export type RecommendationAnalyticsSummary = {
  dateKey: string;
  timezone: string;
  sourceFile: string;
  sourceWindowStart: string | null;
  sourceWindowEnd: string | null;
  searchCount: number;
  impressions: number;
  selections: number;
  checkoutCreated: number;
  purchases: number;
  selectionRate: number;
  checkoutRate: number;
  purchaseRate: number;
  parsedLineCount: number;
  invalidLineCount: number;
};

export type RecommendationAnalyticsRateMetric = {
  numerator: number;
  denominator: number;
  rate: number | null;
  insufficientData: boolean;
};

export type RecommendationAnalyticsSelectionMetrics = {
  totalSelections: number;
  rankedSelections: number;
  top1SelectionRate: RecommendationAnalyticsRateMetric;
  top3SelectionRate: RecommendationAnalyticsRateMetric;
  top5SelectionRate: RecommendationAnalyticsRateMetric;
};

export type RecommendationAnalyticsConversionMetrics = {
  searchCount: number;
  selectionCount: number;
  checkoutCreatedCount: number;
  paidCount: number;
  searchToSelect: RecommendationAnalyticsRateMetric;
  selectToCheckout: RecommendationAnalyticsRateMetric;
  checkoutToPaid: RecommendationAnalyticsRateMetric;
};

export type RecommendationAnalyticsWeakMatchItem = {
  bucketType: "query" | "archetype";
  bucket: string;
  searchCount: number;
  selectionCount: number;
  checkoutCount: number;
  paidCount: number;
  top1MissCount: number;
  top3MissCount: number;
  observation: string;
};

export type RecommendationAnalyticsFieldCoverage = {
  field: string;
  totalActiveCards: number;
  cardsWithAnyIntelligence: number;
  cardsWithField: number;
  coverageRate: number | null;
  insufficientData: boolean;
};

export type RecommendationAnalyticsSparseFamily = {
  family: string;
  cardsMatched: number;
  totalActiveCards: number;
  coverageRate: number | null;
  insufficientData: boolean;
};

export type RecommendationAnalyticsMetadataCoverage = {
  totalActiveCards: number;
  cardsWithAnyIntelligence: number;
  fieldCoverage: RecommendationAnalyticsFieldCoverage[];
  sparseFamilies: RecommendationAnalyticsSparseFamily[];
};

export type RecommendationAnalyticsOutcomeCount = {
  outcome: string;
  count: number;
};

export type RecommendationAnalyticsParserStability = {
  searchEvents: number;
  telemetryKnownEvents: number;
  unknownTelemetryEvents: number;
  timeoutRatio: RecommendationAnalyticsRateMetric;
  fallbackRatio: RecommendationAnalyticsRateMetric;
  rerankEffectivenessRatio: RecommendationAnalyticsRateMetric;
  outcomeBreakdown: RecommendationAnalyticsOutcomeCount[];
  fallbackReasonBreakdown: RecommendationAnalyticsOutcomeCount[];
};

export type RecommendationAnalyticsReport = {
  summary: RecommendationAnalyticsSummary;
  funnel: {
    impressions: number;
    selections: number;
    checkoutCreated: number;
    purchases: number;
    selectionRate: number;
    checkoutRate: number;
    purchaseRate: number;
  };
  metadataPerformance: RecommendationAnalyticsMetadataPerformance;
  topConvertingStyles: RecommendationAnalyticsDimensionBucket[];
  topPurchasedMetadata: RecommendationAnalyticsTopPurchasedMetadata;
  checkoutDropoff: RecommendationAnalyticsCheckoutDropoffItem[];
  lowPerformingRecommendations: RecommendationAnalyticsCardPerformance[];
  selectionAnalytics: RecommendationAnalyticsSelectionMetrics;
  conversionAnalytics: RecommendationAnalyticsConversionMetrics;
  weakMatchAnalytics: {
    queries: RecommendationAnalyticsWeakMatchItem[];
    archetypes: RecommendationAnalyticsWeakMatchItem[];
  };
  metadataCoverageAnalytics: RecommendationAnalyticsMetadataCoverage;
  parserStabilityAnalytics: RecommendationAnalyticsParserStability;
  generation: {
    generatedAt: string;
    minimumLowPerformanceImpressions: number;
  };
};

export type RecommendationAnalyticsCliOptions = {
  json: boolean;
  file: string | null;
  date: string | null;
  outputPath: string | null;
};

export type RecommendationCommerceOptimizationInsights = {
  dateKey: string | null;
  sparseFamilies: string[];
  weakMatchFamilies: string[];
  lowConversionThemes: string[];
};

export type RecommendationAnalyticsParsedLine =
  | {
      ok: true;
      event: RecommendationFeedbackEvent;
    }
  | {
      ok: false;
      line: string;
    };
