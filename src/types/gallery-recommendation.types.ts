import type { GalleryCardRecord } from "../repositories/gallery.repository";
import type { IntelligenceGalleryQuery, ParsedGalleryQuery } from "../services/llm-query-parser.service";

export type RecommendationScoreBreakdown = {
  color: number;
  rarity: number;
  character: number;
  visualStyle: number;
  setting: number;
  mood: number;
  keyword: number;
  safetyPenalty: number;
  total: number;
};

export type RecommendationDebugEntry = {
  cardId: string;
  title: string;
  breakdown: RecommendationScoreBreakdown;
};

export type RecommendationInput = {
  parsedQuery: ParsedGalleryQuery;
  intelligenceQuery?: IntelligenceGalleryQuery;
  candidates: GalleryCardRecord[];
};

export type RecommendationResult = {
  cards: GalleryCardRecord[];
  usedFallback: boolean;
  scoreBreakdowns: RecommendationDebugEntry[];
};
