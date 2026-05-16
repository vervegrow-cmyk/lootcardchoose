import { Prisma } from "@prisma/client";
import type { GalleryCardRecord } from "../repositories/gallery.repository";
import type {
  RecommendationDebugEntry,
  RecommendationInput,
  RecommendationResult,
  RecommendationScore,
  RecommendationScoreBreakdown,
} from "../types/gallery-recommendation.types";

const WEIGHTS = {
  visualMatch: 0.22,
  moodMatch: 0.22,
  characterMatch: 0.18,
  archetypeMatch: 0.14,
  settingMatch: 0.1,
  genreMatch: 0.08,
  commerceMatch: 0.06,
} as const;

type NormalizedCardIntelligence = {
  visualStyle: string[];
  moodTags: string[];
  toneTags: string[];
  characterTypes: string[];
  archetypeTags: string[];
  settingTags: string[];
  genreTags: string[];
  colorHints: string[];
  rarityHints: string[];
  commerceKeywords: string[];
};

type QuerySignals = {
  visualStyle: string[];
  moodTags: string[];
  toneTags: string[];
  characterTypes: string[];
  archetypeTags: string[];
  settingTags: string[];
  genreTags: string[];
  colorHints: string[];
  commerceSignals: string[];
  hasMeaningfulSignals: boolean;
};

type ScoredCard = {
  card: GalleryCardRecord;
  index: number;
  debugEntry: RecommendationDebugEntry;
  subtotal: number;
  themeBucket: string;
};

const roundScore = (value: number): number => Math.round(value * 100) / 100;

const EMPTY_BREAKDOWN = (): RecommendationScoreBreakdown => ({
  visualMatch: 0,
  moodEmotionalMatch: 0,
  characterMatch: 0,
  worldbuildingMatch: 0,
  commerceMatch: 0,
  keywordFallback: 0,
  availableWeight: 0,
  matchedWeight: 0,
  total: 0,
});

const EMPTY_RECOMMENDATION_SCORE = (): RecommendationScore => ({
  visualMatch: 0,
  moodMatch: 0,
  characterMatch: 0,
  archetypeMatch: 0,
  settingMatch: 0,
  genreMatch: 0,
  commerceMatch: 0,
  diversityPenalty: 0,
  finalScore: 0,
  reasons: [],
});

const normalizeText = (value: string | null | undefined): string =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const uniqueNormalized = (values: Array<string | null | undefined>): string[] => {
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

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? uniqueNormalized(value.filter((item): item is string => typeof item === "string")) : [];

const readString = (value: unknown): string =>
  typeof value === "string" ? normalizeText(value) : "";

const extractIntelligenceSource = (metadata: Prisma.JsonValue | null): Prisma.JsonObject | null => {
  if (!isJsonObject(metadata)) {
    return null;
  }

  const direct = metadata.intelligence;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Prisma.JsonObject;
  }

  const nestedMetadata = metadata.metadata;
  if (nestedMetadata && typeof nestedMetadata === "object" && !Array.isArray(nestedMetadata)) {
    const nestedIntelligence = (nestedMetadata as Record<string, unknown>).intelligence;
    if (nestedIntelligence && typeof nestedIntelligence === "object" && !Array.isArray(nestedIntelligence)) {
      return nestedIntelligence as Prisma.JsonObject;
    }
  }

  return null;
};

const readObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const normalizeCardIntelligence = (metadata: Prisma.JsonValue | null): NormalizedCardIntelligence | null => {
  const source = extractIntelligenceSource(metadata);
  if (!source) {
    return null;
  }

  const visualLayer = readObject(source.visualLayer);
  const emotionalLayer = readObject(source.emotionalLayer);
  const characterLayer = readObject(source.characterLayer);
  const worldbuildingLayer = readObject(source.worldbuildingLayer);
  const commerceLayer = readObject(source.commerceLayer);

  const visualStyle = uniqueNormalized([
    ...readStringArray(source.visualStyle),
    ...readStringArray(visualLayer?.visualStyle),
    ...readStringArray(visualLayer?.styleTags),
    ...readStringArray(visualLayer?.artStyle),
  ]);
  const moodTags = uniqueNormalized([
    ...readStringArray(source.moodTags),
    ...readStringArray(emotionalLayer?.moodTags),
    ...readStringArray(emotionalLayer?.mood),
    ...readStringArray(emotionalLayer?.atmosphere),
  ]);
  const toneTags = uniqueNormalized([
    ...readStringArray(source.toneTags),
    ...readStringArray(emotionalLayer?.toneTags),
  ]);
  const characterTypes = uniqueNormalized([
    ...readStringArray(source.characterTypes),
    ...readStringArray(characterLayer?.characterTypes),
    ...readStringArray(characterLayer?.characterType),
    readString(characterLayer?.entityType),
    readString(characterLayer?.genderPresentation),
  ]);
  const archetypeTags = uniqueNormalized([
    ...readStringArray(source.archetypeTags),
    ...readStringArray(characterLayer?.archetypeTags),
    ...readStringArray(characterLayer?.roleArchetype),
  ]);
  const settingTags = uniqueNormalized([
    ...readStringArray(source.settingTags),
    ...readStringArray(worldbuildingLayer?.settingTags),
    ...readStringArray(worldbuildingLayer?.universe),
    ...readStringArray(worldbuildingLayer?.theme),
    ...readStringArray(worldbuildingLayer?.faction),
  ]);
  const genreTags = uniqueNormalized([
    ...readStringArray(source.genreTags),
    ...readStringArray(worldbuildingLayer?.genreTags),
    ...readStringArray(worldbuildingLayer?.theme),
  ]);
  const colorHints = uniqueNormalized([
    ...readStringArray(source.colorHints),
    ...readStringArray(visualLayer?.primaryColors),
    ...readStringArray(visualLayer?.colorPalette),
  ]);
  const rarityHints = uniqueNormalized([
    ...readStringArray(source.rarityHints),
    ...readStringArray(visualLayer?.raritySignals),
    readString(commerceLayer?.rarity),
  ]);
  const commerceKeywords = uniqueNormalized([
    ...readStringArray(source.commerceIntent),
    ...readStringArray(commerceLayer?.searchKeywords),
    ...readStringArray(commerceLayer?.collectorHooks),
    ...readStringArray(commerceLayer?.marketingAngles),
    ...readStringArray(commerceLayer?.audienceTags),
    readString(commerceLayer?.category),
    readString(commerceLayer?.pricingTier),
  ]);

  const result: NormalizedCardIntelligence = {
    visualStyle,
    moodTags,
    toneTags,
    characterTypes,
    archetypeTags,
    settingTags,
    genreTags,
    colorHints,
    rarityHints,
    commerceKeywords,
  };

  return Object.values(result).some((values) => values.length > 0) ? result : null;
};

const termMatches = (candidate: string, query: string): boolean =>
  candidate === query || candidate.includes(query) || query.includes(candidate);

const matchStrength = (queryTerms: string[], cardTerms: string[]): number => {
  if (queryTerms.length === 0 || cardTerms.length === 0) {
    return 0;
  }

  let matchedCount = 0;
  for (const queryTerm of queryTerms) {
    if (cardTerms.some((cardTerm) => termMatches(cardTerm, queryTerm))) {
      matchedCount += 1;
    }
  }

  return Math.min(1, matchedCount / queryTerms.length);
};

const collectQuerySignals = (input: RecommendationInput): QuerySignals => {
  const intelligenceQuery = input.intelligenceQuery ?? input.parsedQuery.intelligenceQuery;
  const visualStyle = uniqueNormalized([
    ...input.parsedQuery.visualStyle,
    ...(intelligenceQuery?.visualStyle ?? []),
    ...(intelligenceQuery?.visualIntent ?? []),
    ...input.parsedQuery.colorHints,
    ...(intelligenceQuery?.colorHints ?? []),
    input.parsedQuery.style,
    input.parsedQuery.color,
  ]);
  const moodTags = uniqueNormalized([
    ...input.parsedQuery.moodTags,
    ...(intelligenceQuery?.moodTags ?? []),
    ...(intelligenceQuery?.emotionalIntent ?? []),
    input.parsedQuery.mood,
  ]);
  const toneTags = uniqueNormalized([
    ...input.parsedQuery.toneTags,
    ...(intelligenceQuery?.toneTags ?? []),
  ]);
  const characterTypes = uniqueNormalized([
    ...input.parsedQuery.characterTypes,
    ...(intelligenceQuery?.characterTypes ?? []),
    ...(intelligenceQuery?.characterIntent ?? []),
    input.parsedQuery.character,
  ]);
  const archetypeTags = uniqueNormalized([
    ...input.parsedQuery.archetypeTags,
    ...(intelligenceQuery?.archetypeTags ?? []),
    input.parsedQuery.character,
  ]);
  const settingTags = uniqueNormalized([
    ...input.parsedQuery.settingTags,
    ...(intelligenceQuery?.settingTags ?? []),
    ...(intelligenceQuery?.worldbuildingIntent ?? []),
    input.parsedQuery.scene,
  ]);
  const genreTags = uniqueNormalized([
    ...input.parsedQuery.genreTags,
    ...(intelligenceQuery?.genreTags ?? []),
    input.parsedQuery.style,
    input.parsedQuery.category,
  ]);
  const colorHints = uniqueNormalized([
    ...input.parsedQuery.colorHints,
    ...(intelligenceQuery?.colorHints ?? []),
    input.parsedQuery.color,
  ]);
  const commerceSignals = uniqueNormalized([
    ...(intelligenceQuery?.commerceIntent ?? []),
    ...(intelligenceQuery?.rarityHints ?? []),
    input.parsedQuery.rarity,
    input.parsedQuery.category,
    ...input.parsedQuery.keywords,
  ]);

  return {
    visualStyle,
    moodTags,
    toneTags,
    characterTypes,
    archetypeTags,
    settingTags,
    genreTags,
    colorHints,
    commerceSignals,
    hasMeaningfulSignals:
      visualStyle.length > 0 ||
      moodTags.length > 0 ||
      toneTags.length > 0 ||
      characterTypes.length > 0 ||
      archetypeTags.length > 0 ||
      settingTags.length > 0 ||
      genreTags.length > 0 ||
      colorHints.length > 0 ||
      commerceSignals.length > 0,
  };
};

const buildCardSignals = (card: GalleryCardRecord, intelligence: NormalizedCardIntelligence | null) => ({
  visualStyle: uniqueNormalized([
    card.style,
    card.color,
    ...card.tags,
    ...(intelligence?.visualStyle ?? []),
    ...(intelligence?.colorHints ?? []),
  ]),
  moodTags: uniqueNormalized([
    card.description,
    ...card.tags,
    ...(intelligence?.moodTags ?? []),
    ...(intelligence?.toneTags ?? []),
  ]),
  characterTypes: uniqueNormalized([
    card.character,
    card.title,
    ...card.tags,
    ...(intelligence?.characterTypes ?? []),
  ]),
  archetypeTags: uniqueNormalized([
    card.character,
    card.title,
    ...card.tags,
    ...(intelligence?.archetypeTags ?? []),
  ]),
  settingTags: uniqueNormalized([
    card.category,
    card.description,
    ...card.tags,
    ...(intelligence?.settingTags ?? []),
  ]),
  genreTags: uniqueNormalized([
    card.style,
    card.category,
    card.description,
    ...card.tags,
    ...(intelligence?.genreTags ?? []),
  ]),
  commerceSignals: uniqueNormalized([
    card.rarity,
    card.category,
    card.style,
    card.color,
    ...card.tags,
    ...(intelligence?.commerceKeywords ?? []),
    ...(intelligence?.rarityHints ?? []),
  ]),
});

const toPercent = (score: number, weight: number): number => roundScore(score * weight * 100);

const buildThemeBucket = (
  cardSignals: ReturnType<typeof buildCardSignals>,
  recommendationScore: RecommendationScore
): string => {
  const mainVisual = cardSignals.visualStyle[0] ?? "visual";
  const mainArchetype = cardSignals.archetypeTags[0] ?? cardSignals.characterTypes[0] ?? "character";
  const mainGenre = cardSignals.genreTags[0] ?? cardSignals.settingTags[0] ?? "genre";
  const dominant =
    recommendationScore.visualMatch >= recommendationScore.characterMatch && recommendationScore.visualMatch >= recommendationScore.genreMatch
      ? mainVisual
      : recommendationScore.characterMatch >= recommendationScore.genreMatch
        ? mainArchetype
        : mainGenre;

  return normalizeText(`${dominant}|${mainArchetype}|${mainGenre}`);
};

const buildReasons = (
  signals: QuerySignals,
  cardSignals: ReturnType<typeof buildCardSignals>,
  recommendationScore: RecommendationScore,
  card: GalleryCardRecord
): string[] => {
  const reasons: string[] = [];
  const visualTerms = uniqueNormalized([...signals.visualStyle, ...signals.colorHints]);
  const moodTerms = uniqueNormalized([...signals.moodTags, ...signals.toneTags]);
  const characterTerms = uniqueNormalized([...signals.characterTypes]);
  const archetypeTerms = uniqueNormalized([...signals.archetypeTags]);
  const genreTerms = uniqueNormalized([...signals.genreTags]);
  const settingTerms = uniqueNormalized([...signals.settingTags]);

  if (recommendationScore.visualMatch >= 8 && visualTerms.length > 0) {
    reasons.push(`Matches ${visualTerms.slice(0, 2).join("_")} visual style`);
  }
  if (recommendationScore.archetypeMatch >= 8 && archetypeTerms.length > 0) {
    reasons.push(`Strong ${archetypeTerms[0]} archetype match`);
  }
  if (recommendationScore.characterMatch >= 8 && characterTerms.length > 0) {
    reasons.push(`Character aligns with ${characterTerms.slice(0, 2).join(" / ")}`);
  }
  if (recommendationScore.moodMatch >= 8 && moodTerms.length > 0) {
    reasons.push(`Mood aligns with ${moodTerms.slice(0, 2).join(" / ")}`);
  }
  if (recommendationScore.settingMatch >= 6 && settingTerms.length > 0) {
    reasons.push(`Setting fits ${settingTerms.slice(0, 2).join(" / ")}`);
  }
  if (recommendationScore.genreMatch >= 5 && genreTerms.length > 0) {
    reasons.push(`Genre fits ${genreTerms.slice(0, 2).join(" / ")}`);
  }
  if (recommendationScore.commerceMatch >= 4) {
    if (normalizeText(card.rarity) === "ssr" || cardSignals.commerceSignals.includes("ssr")) {
      reasons.push("SSR rarity matched");
    } else {
      reasons.push("Commerce signals matched");
    }
  }

  const deduped = uniqueNormalized(reasons).map((reason) => reason.replace(/\s+/g, " ").trim());
  return deduped.slice(0, 4);
};

const scoreCard = (card: GalleryCardRecord, input: RecommendationInput): ScoredCard => {
  const breakdown = EMPTY_BREAKDOWN();
  const recommendationScore = EMPTY_RECOMMENDATION_SCORE();
  const intelligence = normalizeCardIntelligence(card.metadata);
  const signals = collectQuerySignals(input);

  if (!signals.hasMeaningfulSignals || !intelligence) {
    return {
      card,
      index: -1,
      themeBucket: "",
      subtotal: 0,
      debugEntry: {
        cardId: card.id,
        title: card.title,
        hasUsableIntelligence: false,
        breakdown,
        recommendationScore,
      },
    };
  }

  const cardSignals = buildCardSignals(card, intelligence);
  recommendationScore.visualMatch = toPercent(
    Math.max(matchStrength(signals.visualStyle, cardSignals.visualStyle), matchStrength(signals.colorHints, cardSignals.visualStyle)),
    WEIGHTS.visualMatch
  );
  recommendationScore.moodMatch = toPercent(
    Math.max(matchStrength(signals.moodTags, cardSignals.moodTags), matchStrength(signals.toneTags, cardSignals.moodTags)),
    WEIGHTS.moodMatch
  );
  recommendationScore.characterMatch = toPercent(matchStrength(signals.characterTypes, cardSignals.characterTypes), WEIGHTS.characterMatch);
  recommendationScore.archetypeMatch = toPercent(matchStrength(signals.archetypeTags, cardSignals.archetypeTags), WEIGHTS.archetypeMatch);
  recommendationScore.settingMatch = toPercent(matchStrength(signals.settingTags, cardSignals.settingTags), WEIGHTS.settingMatch);
  recommendationScore.genreMatch = toPercent(matchStrength(signals.genreTags, cardSignals.genreTags), WEIGHTS.genreMatch);
  recommendationScore.commerceMatch = toPercent(matchStrength(signals.commerceSignals, cardSignals.commerceSignals), WEIGHTS.commerceMatch);

  const subtotal = roundScore(
    recommendationScore.visualMatch +
      recommendationScore.moodMatch +
      recommendationScore.characterMatch +
      recommendationScore.archetypeMatch +
      recommendationScore.settingMatch +
      recommendationScore.genreMatch +
      recommendationScore.commerceMatch
  );

  recommendationScore.finalScore = subtotal;
  recommendationScore.reasons = buildReasons(signals, cardSignals, recommendationScore, card);

  breakdown.visualMatch = recommendationScore.visualMatch;
  breakdown.moodEmotionalMatch = recommendationScore.moodMatch;
  breakdown.characterMatch = roundScore(recommendationScore.characterMatch + recommendationScore.archetypeMatch);
  breakdown.worldbuildingMatch = roundScore(recommendationScore.settingMatch + recommendationScore.genreMatch);
  breakdown.commerceMatch = recommendationScore.commerceMatch;
  breakdown.keywordFallback = 0;
  breakdown.availableWeight = 100;
  breakdown.matchedWeight = subtotal;
  breakdown.total = subtotal;

  return {
    card,
    index: -1,
    subtotal,
    themeBucket: buildThemeBucket(cardSignals, recommendationScore),
    debugEntry: {
      cardId: card.id,
      title: card.title,
      hasUsableIntelligence: true,
      breakdown,
      recommendationScore,
    },
  };
};

const applyDiversityPenalty = (scoredCards: ScoredCard[]): ScoredCard[] => {
  const bucketCounts = new Map<string, number>();

  return scoredCards.map((entry) => {
    if (!entry.themeBucket) {
      return entry;
    }

    const seenCount = bucketCounts.get(entry.themeBucket) ?? 0;
    bucketCounts.set(entry.themeBucket, seenCount + 1);

    const diversityPenalty = roundScore(Math.min(seenCount * 1.5, 4.5));
    entry.debugEntry.recommendationScore.diversityPenalty = diversityPenalty;
    entry.debugEntry.recommendationScore.finalScore = roundScore(
      Math.max(0, entry.debugEntry.recommendationScore.finalScore - diversityPenalty)
    );
    entry.debugEntry.breakdown.total = entry.debugEntry.recommendationScore.finalScore;
    return entry;
  });
};

const hasRankingMovement = (original: GalleryCardRecord[], reranked: GalleryCardRecord[]): boolean =>
  original.some((card, index) => reranked[index]?.id !== card.id);

export const galleryRecommendationService = {
  rerank(input: RecommendationInput): RecommendationResult {
    const baseDebugEntries = input.candidates.map((card) => ({
      cardId: card.id,
      title: card.title,
      hasUsableIntelligence: false,
      breakdown: EMPTY_BREAKDOWN(),
      recommendationScore: EMPTY_RECOMMENDATION_SCORE(),
    }));

    const signals = collectQuerySignals(input);
    if (!signals.hasMeaningfulSignals || input.candidates.length <= 1) {
      return {
        cards: input.candidates,
        usedFallback: true,
        rerankHappened: false,
        scoreBreakdowns: baseDebugEntries,
      };
    }

    try {
      const scored = input.candidates.map((card, index) => {
        const scoredEntry = scoreCard(card, input);
        return {
          ...scoredEntry,
          index,
        };
      });

      const scoredWithIntelligence = scored.filter((entry) => entry.debugEntry.hasUsableIntelligence);
      if (scoredWithIntelligence.length === 0) {
        return {
          cards: input.candidates,
          usedFallback: true,
          rerankHappened: false,
          scoreBreakdowns: scored.map((entry) => entry.debugEntry),
        };
      }

      const sortedBySubtotal = [...scored].sort((left, right) => {
        if (right.subtotal !== left.subtotal) {
          return right.subtotal - left.subtotal;
        }
        return left.index - right.index;
      });

      const penalized = applyDiversityPenalty(sortedBySubtotal).sort((left, right) => {
        const rightScore = right.debugEntry.recommendationScore.finalScore;
        const leftScore = left.debugEntry.recommendationScore.finalScore;
        if (rightScore !== leftScore) {
          return rightScore - leftScore;
        }
        if (right.subtotal !== left.subtotal) {
          return right.subtotal - left.subtotal;
        }
        return left.index - right.index;
      });

      const rerankedCards = penalized.map((entry) => entry.card);
      const rerankHappened = hasRankingMovement(input.candidates, rerankedCards);
      const hasMeaningfulScore = penalized.some((entry) => entry.debugEntry.recommendationScore.finalScore > 0);

      if (!hasMeaningfulScore || !rerankHappened) {
        return {
          cards: input.candidates,
          usedFallback: true,
          rerankHappened: false,
          scoreBreakdowns: scored.map((entry) => entry.debugEntry),
        };
      }

      return {
        cards: rerankedCards,
        usedFallback: false,
        rerankHappened: true,
        scoreBreakdowns: penalized.map((entry) => entry.debugEntry),
      };
    } catch {
      return {
        cards: input.candidates,
        usedFallback: true,
        rerankHappened: false,
        scoreBreakdowns: baseDebugEntries,
      };
    }
  },
};
