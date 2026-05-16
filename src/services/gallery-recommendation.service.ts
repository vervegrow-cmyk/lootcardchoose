import { Prisma } from "@prisma/client";
import type { GalleryCardRecord } from "../repositories/gallery.repository";
import type { GalleryMetadataIntelligence } from "../types/gallery-intelligence.types";
import type {
  RecommendationDebugEntry,
  RecommendationInput,
  RecommendationResult,
  RecommendationScoreBreakdown,
} from "../types/gallery-recommendation.types";

const EMPTY_BREAKDOWN = (): RecommendationScoreBreakdown => ({
  color: 0,
  rarity: 0,
  character: 0,
  visualStyle: 0,
  setting: 0,
  mood: 0,
  keyword: 0,
  safetyPenalty: 0,
  total: 0,
});

const normalizeText = (value: string | null | undefined): string => (value ?? "").trim().toLowerCase();

const uniqueNormalized = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

const isJsonObject = (value: Prisma.JsonValue | null): value is Prisma.JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readIntelligence = (metadata: Prisma.JsonValue | null): GalleryMetadataIntelligence | null => {
  if (!isJsonObject(metadata)) {
    return null;
  }

  const direct = metadata.intelligence;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as GalleryMetadataIntelligence;
  }

  const nestedMetadata = metadata.metadata;
  if (nestedMetadata && typeof nestedMetadata === "object" && !Array.isArray(nestedMetadata)) {
    const nestedIntelligence = (nestedMetadata as Record<string, unknown>).intelligence;
    if (nestedIntelligence && typeof nestedIntelligence === "object" && !Array.isArray(nestedIntelligence)) {
      return nestedIntelligence as GalleryMetadataIntelligence;
    }
  }

  return null;
};

const readSafetyFlags = (card: GalleryCardRecord): string[] =>
  uniqueNormalized(readIntelligence(card.metadata)?.commerceLayer.safetyFlags ?? []);

const buildCardTermSet = (card: GalleryCardRecord, intelligence: GalleryMetadataIntelligence | null): Set<string> => {
  const terms = uniqueNormalized([
    card.title,
    ...card.tags,
    card.style ?? "",
    card.rarity ?? "",
    card.category ?? "",
    card.character ?? "",
    card.color ?? "",
    ...(intelligence?.visualLayer.primaryColors ?? []),
    ...(intelligence?.visualLayer.styleTags ?? []),
    ...(intelligence?.emotionalLayer.moodTags ?? []),
    ...(intelligence?.emotionalLayer.toneTags ?? []),
    intelligence?.characterLayer.entityType ?? "",
    ...(intelligence?.characterLayer.archetypeTags ?? []),
    ...(intelligence?.worldbuildingLayer.settingTags ?? []),
    ...(intelligence?.worldbuildingLayer.genreTags ?? []),
    ...(intelligence?.commerceLayer.searchKeywords ?? []),
  ]);
  return new Set(terms);
};

const includesAny = (termSet: Set<string>, candidates: string[]): boolean =>
  uniqueNormalized(candidates).some((candidate) => termSet.has(candidate));

const matchKeywordsInTitleOrTags = (card: GalleryCardRecord, keywords: string[]): boolean => {
  const normalizedTitle = normalizeText(card.title);
  const normalizedTags = card.tags.map((tag) => normalizeText(tag));
  return uniqueNormalized(keywords).some((keyword) => {
    if (!keyword) {
      return false;
    }
    if (normalizedTitle.includes(keyword)) {
      return true;
    }
    return normalizedTags.some((tag) => tag.includes(keyword) || keyword.includes(tag));
  });
};

const hasMeaningfulIntelligenceQuery = (input: RecommendationInput): boolean => {
  const intelligenceQuery = input.intelligenceQuery ?? input.parsedQuery.intelligenceQuery;
  if (!intelligenceQuery) {
    return false;
  }

  return [
    intelligenceQuery.visualStyle,
    intelligenceQuery.moodTags,
    intelligenceQuery.toneTags,
    intelligenceQuery.characterTypes,
    intelligenceQuery.archetypeTags,
    intelligenceQuery.settingTags,
    intelligenceQuery.genreTags,
    intelligenceQuery.colorHints,
    intelligenceQuery.rarityHints,
    intelligenceQuery.commerceIntent,
  ].some((values) => values.length > 0);
};

const scoreCard = (card: GalleryCardRecord, input: RecommendationInput): RecommendationDebugEntry => {
  const breakdown = EMPTY_BREAKDOWN();
  const intelligence = readIntelligence(card.metadata);
  const termSet = buildCardTermSet(card, intelligence);
  const intelligenceQuery = input.intelligenceQuery ?? input.parsedQuery.intelligenceQuery;

  if (!intelligenceQuery) {
    return {
      cardId: card.id,
      title: card.title,
      breakdown,
    };
  }

  if (includesAny(termSet, intelligenceQuery.colorHints) || includesAny(termSet, [input.parsedQuery.color])) {
    breakdown.color = 15;
  }

  if (
    includesAny(termSet, intelligenceQuery.rarityHints) ||
    (input.parsedQuery.rarity && normalizeText(card.rarity) === normalizeText(input.parsedQuery.rarity))
  ) {
    breakdown.rarity = 10;
  }

  if (
    includesAny(termSet, intelligenceQuery.characterTypes) ||
    includesAny(termSet, intelligenceQuery.archetypeTags) ||
    includesAny(termSet, [input.parsedQuery.character])
  ) {
    breakdown.character = 20;
  }

  if (
    includesAny(termSet, intelligenceQuery.visualStyle) ||
    includesAny(termSet, intelligenceQuery.genreTags) ||
    includesAny(termSet, [input.parsedQuery.style])
  ) {
    breakdown.visualStyle = 15;
  }

  if (includesAny(termSet, intelligenceQuery.settingTags) || includesAny(termSet, [input.parsedQuery.scene])) {
    breakdown.setting = 10;
  }

  if (includesAny(termSet, intelligenceQuery.moodTags) || includesAny(termSet, intelligenceQuery.toneTags) || includesAny(termSet, [input.parsedQuery.mood])) {
    breakdown.mood = 15;
  }

  if (matchKeywordsInTitleOrTags(card, input.parsedQuery.keywords)) {
    breakdown.keyword = 10;
  }

  const safetyIntent = intelligenceQuery.safetyIntent ?? "unknown";
  const safetyFlags = readSafetyFlags(card);
  if (safetyIntent === "safe" && safetyFlags.length > 0) {
    breakdown.safetyPenalty = -30;
  }

  breakdown.total =
    breakdown.color +
    breakdown.rarity +
    breakdown.character +
    breakdown.visualStyle +
    breakdown.setting +
    breakdown.mood +
    breakdown.keyword +
    breakdown.safetyPenalty;

  return {
    cardId: card.id,
    title: card.title,
    breakdown,
  };
};

export const galleryRecommendationService = {
  rerank(input: RecommendationInput): RecommendationResult {
    if (!hasMeaningfulIntelligenceQuery(input) || input.candidates.length <= 1) {
      return {
        cards: input.candidates,
        usedFallback: true,
        scoreBreakdowns: input.candidates.map((card) => ({
          cardId: card.id,
          title: card.title,
          breakdown: EMPTY_BREAKDOWN(),
        })),
      };
    }

    try {
      const debugEntries = input.candidates.map((card) => scoreCard(card, input));
      const scoreMap = new Map(debugEntries.map((entry) => [entry.cardId, entry.breakdown.total]));
      const hasAnyScore = debugEntries.some((entry) => entry.breakdown.total !== 0);

      if (!hasAnyScore) {
        return {
          cards: input.candidates,
          usedFallback: true,
          scoreBreakdowns: debugEntries,
        };
      }

      const reranked = input.candidates
        .map((card, index) => ({
          card,
          index,
          score: scoreMap.get(card.id) ?? 0,
        }))
        .sort((left, right) => {
          if (right.score !== left.score) {
            return right.score - left.score;
          }
          return left.index - right.index;
        })
        .map((entry) => entry.card);

      return {
        cards: reranked,
        usedFallback: false,
        scoreBreakdowns: debugEntries,
      };
    } catch {
      return {
        cards: input.candidates,
        usedFallback: true,
        scoreBreakdowns: input.candidates.map((card) => ({
          cardId: card.id,
          title: card.title,
          breakdown: EMPTY_BREAKDOWN(),
        })),
      };
    }
  },
};
