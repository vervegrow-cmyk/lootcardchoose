import type { GalleryCardRecord } from "../repositories/gallery.repository";
import type { IntelligenceGalleryQuery, ParsedGalleryQuery } from "../services/llm-query-parser.service";

export type RecommendationScore = {
  visualMatch: number;
  moodMatch: number;
  characterMatch: number;
  archetypeMatch: number;
  settingMatch: number;
  genreMatch: number;
  commerceMatch: number;
  diversityPenalty: number;
  finalScore: number;
  reasons: string[];
};

export type RecommendationCommerceIntelligence = {
  collectorScore: number;
  impulseBuyScore: number;
  luxuryAura: string;
  rarityWeight: number;
  mainstreamAppeal: number;
};

export type RecommendationCommercePresentation = {
  collectorPositioning: string;
  rarityFraming: string;
  auraPresentation: string;
  commerceReasons: string[];
};

export type RecommendationCuratorNarration = {
  vibeNarration?: string;
  atmosphereNarration?: string;
  collectorFantasy?: string;
  rarityStory?: string;
  worldbuildingFlavor?: string;
  embedLines: string[];
};

export type RecommendationScoreBreakdown = {
  visualMatch: number;
  moodEmotionalMatch: number;
  characterMatch: number;
  worldbuildingMatch: number;
  commerceMatch: number;
  keywordFallback: number;
  availableWeight: number;
  matchedWeight: number;
  total: number;
};

export type RecommendationDebugEntry = {
  cardId: string;
  title: string;
  hasUsableIntelligence: boolean;
  breakdown: RecommendationScoreBreakdown;
  recommendationScore: RecommendationScore;
  commerceIntelligence?: RecommendationCommerceIntelligence;
  commercePresentation?: RecommendationCommercePresentation;
  curatorNarration?: RecommendationCuratorNarration;
};

export type RecommendationInput = {
  parsedQuery: ParsedGalleryQuery;
  intelligenceQuery?: IntelligenceGalleryQuery;
  candidates: GalleryCardRecord[];
};

export type RecommendationResult = {
  cards: GalleryCardRecord[];
  usedFallback: boolean;
  rerankHappened: boolean;
  scoreBreakdowns: RecommendationDebugEntry[];
};
