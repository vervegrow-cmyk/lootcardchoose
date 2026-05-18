import type { RecommendationFeedbackEvent } from "./recommendation-feedback.types";

export type RecommendationFeedbackAnalyticsTopQuery = {
  query: string;
  count: number;
};

export type RecommendationFeedbackAnalyticsTopCard = {
  cardId: string;
  title: string | null;
  count: number;
};

export type RecommendationFeedbackAnalyticsSummary = {
  file: string | null;
  totalLines: number;
  parsedLines: number;
  invalidLines: number;
  searchCount: number;
  selectionCount: number;
  checkoutCount: number;
  purchaseCount: number;
  searchToSelectionRate: number;
  selectionToCheckoutRate: number;
  checkoutToPurchaseRate: number;
  usedFallbackRate: number;
  orphanPurchaseCount: number;
  sessionsWithRerank: number;
  sessionsWithNoRankingChange: number;
};

export type RecommendationFeedbackAnalyticsReport = {
  file: string | null;
  totalLines: number;
  parsedLines: number;
  invalidLines: number;
  source: {
    file: string | null;
    selectedBy: "explicit" | "default" | "newest_report";
    usedFallbackFile: boolean;
  };
  summary: RecommendationFeedbackAnalyticsSummary;
  conversion: {
    searchToSelectionRate: number;
    selectionToCheckoutRate: number;
    checkoutToPurchaseRate: number;
  };
  rerankHealth: {
    usedFallbackRate: number;
    orphanPurchaseCount: number;
    sessionsWithRerank: number;
    sessionsWithNoRankingChange: number;
  };
  interpretation: {
    status: "healthy" | "observe";
    findings: string[];
  };
  recommendationV2Gate: {
    status: "not_needed" | "re_evaluate";
    reasons: string[];
  };
  topQueries: RecommendationFeedbackAnalyticsTopQuery[];
  topSelectedCards: RecommendationFeedbackAnalyticsTopCard[];
  topPurchasedCards: RecommendationFeedbackAnalyticsTopCard[];
};

export type RecommendationFeedbackAnalyticsCliOptions = {
  json: boolean;
  limit: number;
  file: string | null;
  outputPath: string | null;
};

export type RecommendationFeedbackAnalyticsSource = {
  file: string | null;
  selectedBy: "explicit" | "default" | "newest_report";
  usedFallbackFile: boolean;
  missing: boolean;
  content: string;
};

export type RecommendationFeedbackAnalyticsParsedLine =
  | {
      ok: true;
      event: RecommendationFeedbackEvent;
    }
  | {
      ok: false;
      line: string;
    };
