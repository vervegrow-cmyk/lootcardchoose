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
  topQueries: RecommendationFeedbackAnalyticsTopQuery[];
  topSelectedCards: RecommendationFeedbackAnalyticsTopCard[];
  topPurchasedCards: RecommendationFeedbackAnalyticsTopCard[];
};

export type RecommendationFeedbackAnalyticsCliOptions = {
  json: boolean;
  limit: number;
};

export type RecommendationFeedbackAnalyticsSource = {
  file: string | null;
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
