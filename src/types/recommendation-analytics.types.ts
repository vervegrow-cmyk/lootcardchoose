import type { RecommendationFeedbackEvent } from "./recommendation-feedback.types";

export type RecommendationAnalyticsDimensionKey =
  | "rarity"
  | "style"
  | "character"
  | "color"
  | "title"
  | "priceTier";

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

export type RecommendationAnalyticsParsedLine =
  | {
      ok: true;
      event: RecommendationFeedbackEvent;
    }
  | {
      ok: false;
      line: string;
    };
