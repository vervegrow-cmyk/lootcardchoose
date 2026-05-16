import { Prisma } from "@prisma/client";
import type { GalleryCardRecord } from "../repositories/gallery.repository";
import type {
  RecommendationCommerceIntelligence,
  RecommendationCommercePresentation,
  RecommendationDebugEntry,
  RecommendationInput,
  RecommendationResult,
  RecommendationScore,
  RecommendationScoreBreakdown,
} from "../types/gallery-recommendation.types";

type WeightProfile = {
  visualMatch: number;
  moodMatch: number;
  characterMatch: number;
  archetypeMatch: number;
  settingMatch: number;
  genreMatch: number;
  commerceMatch: number;
};

type SignalCollection = {
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

type NormalizedCardIntelligence = {
  metadataSignals: SignalCollection;
  fallbackSignals: SignalCollection;
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
  explicitRoleFamilies: string[];
  explicitThemeFamilies: string[];
  hasMeaningfulSignals: boolean;
};

type CardSignals = {
  visualStyle: string[];
  moodTags: string[];
  characterTypes: string[];
  archetypeTags: string[];
  settingTags: string[];
  genreTags: string[];
  commerceSignals: string[];
};

type ScoredCard = {
  card: GalleryCardRecord;
  index: number;
  debugEntry: RecommendationDebugEntry;
  subtotal: number;
  themeBucket: string;
};

const BASE_WEIGHT_PROFILE: WeightProfile = {
  visualMatch: 0.22,
  moodMatch: 0.22,
  characterMatch: 0.18,
  archetypeMatch: 0.14,
  settingMatch: 0.1,
  genreMatch: 0.08,
  commerceMatch: 0.06,
};

const ARCHETYPE_HEAVY_WEIGHT_PROFILE: WeightProfile = {
  visualMatch: 0.16,
  moodMatch: 0.18,
  characterMatch: 0.22,
  archetypeMatch: 0.24,
  settingMatch: 0.08,
  genreMatch: 0.06,
  commerceMatch: 0.06,
};

const THEME_HEAVY_WEIGHT_PROFILE: WeightProfile = {
  visualMatch: 0.26,
  moodMatch: 0.18,
  characterMatch: 0.16,
  archetypeMatch: 0.16,
  settingMatch: 0.08,
  genreMatch: 0.1,
  commerceMatch: 0.06,
};

const MIXED_WEIGHT_PROFILE: WeightProfile = {
  visualMatch: 0.2,
  moodMatch: 0.18,
  characterMatch: 0.2,
  archetypeMatch: 0.2,
  settingMatch: 0.08,
  genreMatch: 0.08,
  commerceMatch: 0.06,
};

const WEAK_TEXT_MATCH_FACTOR = 0.35;
const MAX_DIVERSITY_PENALTY = 4.5;
const DIVERSITY_PENALTY_STEP = 1.5;
const MECHA_MISMATCH_PENALTY = 8;
const QUEEN_MISMATCH_PENALTY = 6;
const PRIESTESS_MISMATCH_PENALTY = 6;
const WARRIOR_MISMATCH_PENALTY = 5;

const ROLE_FAMILY_TERMS = ["queen", "empress", "goddess", "priestess", "warrior", "paladin", "commander", "mecha girl"];
const THEME_FAMILY_TERMS = ["cyberpunk", "mecha", "gothic", "dark fantasy", "holy", "divine"];
const COLLECTOR_THEME_FAMILIES = ["black gold", "divine", "holy", "gothic", "dark fantasy", "cyberpunk", "mecha", "queen", "empress", "priestess"];

const roundScore = (value: number): number => Math.round(value * 100) / 100;

const assertWeightProfile = (name: string, profile: WeightProfile): WeightProfile => {
  const total = Object.values(profile).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 0.0001) {
    throw new Error(`Invalid recommendation weight profile ${name}: ${total}`);
  }
  return profile;
};

assertWeightProfile("base", BASE_WEIGHT_PROFILE);
assertWeightProfile("archetype-heavy", ARCHETYPE_HEAVY_WEIGHT_PROFILE);
assertWeightProfile("theme-heavy", THEME_HEAVY_WEIGHT_PROFILE);
assertWeightProfile("mixed", MIXED_WEIGHT_PROFILE);

const EMPTY_BREAKDOWN = (): RecommendationScoreBreakdown => ({
  visualMatch: 0,
  moodEmotionalMatch: 0,
  characterMatch: 0,
  worldbuildingMatch: 0,
  commerceMatch: 0,
  keywordFallback: 0,
  availableWeight: 100,
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

const EMPTY_SIGNAL_COLLECTION = (): SignalCollection => ({
  visualStyle: [],
  moodTags: [],
  toneTags: [],
  characterTypes: [],
  archetypeTags: [],
  settingTags: [],
  genreTags: [],
  colorHints: [],
  rarityHints: [],
  commerceKeywords: [],
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

const readObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

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

const expandCanonicalFamilies = (value: string): string[] => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }

  const expanded = [normalized];

  if (normalized.includes("black gold")) {
    expanded.push("black", "gold");
  }
  if (normalized.includes("white gold")) {
    expanded.push("white", "gold");
  }
  if (normalized.includes("cyberpunk")) {
    expanded.push("cyberpunk");
  }
  if (normalized.includes("mecha")) {
    expanded.push("mecha");
  }
  if (normalized.includes("mecha girl")) {
    expanded.push("mecha girl", "warrior");
  }
  if (normalized.includes("dark fantasy")) {
    expanded.push("dark fantasy", "fantasy", "dark");
  }
  if (normalized.includes("gothic")) {
    expanded.push("gothic");
  }
  if (normalized.includes("holy")) {
    expanded.push("holy", "divine");
  }
  if (normalized.includes("divine")) {
    expanded.push("divine", "holy");
  }
  if (normalized.includes("priestess")) {
    expanded.push("priestess", "holy female", "divine");
  }
  if (normalized.includes("queen")) {
    expanded.push("queen", "ruler", "boss like");
  }
  if (normalized.includes("empress")) {
    expanded.push("empress", "queen", "ruler", "boss like");
  }
  if (normalized.includes("goddess")) {
    expanded.push("goddess", "divine female", "holy female", "divine");
  }
  if (normalized.includes("warrior")) {
    expanded.push("warrior");
  }
  if (normalized.includes("paladin")) {
    expanded.push("paladin", "warrior", "holy warrior", "divine");
  }
  if (normalized.includes("commander")) {
    expanded.push("commander", "leader", "ruler", "warrior");
  }
  if (normalized.includes("leader")) {
    expanded.push("leader", "ruler");
  }
  if (normalized.includes("boss like") || normalized.includes("boss-like")) {
    expanded.push("boss like", "ruler");
  }
  if (normalized.includes("oppressive")) {
    expanded.push("oppressive", "boss like");
  }
  if (normalized.includes("ssr")) {
    expanded.push("ssr");
  }

  return uniqueNormalized(expanded);
};

const normalizeSignalArray = (values: Array<string | null | undefined>): string[] =>
  uniqueNormalized(values.flatMap((value) => expandCanonicalFamilies(value ?? "")));

const buildMetadataSignals = (metadata: Prisma.JsonValue | null): SignalCollection => {
  const source = extractIntelligenceSource(metadata);
  if (!source) {
    return EMPTY_SIGNAL_COLLECTION();
  }

  const visualLayer = readObject(source.visualLayer);
  const emotionalLayer = readObject(source.emotionalLayer);
  const characterLayer = readObject(source.characterLayer);
  const worldbuildingLayer = readObject(source.worldbuildingLayer);
  const commerceLayer = readObject(source.commerceLayer);

  return {
    visualStyle: normalizeSignalArray([
      ...readStringArray(source.visualStyle),
      ...readStringArray(visualLayer?.visualStyle),
      ...readStringArray(visualLayer?.styleTags),
      ...readStringArray(visualLayer?.artStyle),
    ]),
    moodTags: normalizeSignalArray([
      ...readStringArray(source.moodTags),
      ...readStringArray(emotionalLayer?.moodTags),
      ...readStringArray(emotionalLayer?.mood),
      ...readStringArray(emotionalLayer?.atmosphere),
    ]),
    toneTags: normalizeSignalArray([
      ...readStringArray(source.toneTags),
      ...readStringArray(emotionalLayer?.toneTags),
    ]),
    characterTypes: normalizeSignalArray([
      ...readStringArray(source.characterTypes),
      ...readStringArray(characterLayer?.characterTypes),
      ...readStringArray(characterLayer?.characterType),
      readString(characterLayer?.entityType),
      readString(characterLayer?.genderPresentation),
    ]),
    archetypeTags: normalizeSignalArray([
      ...readStringArray(source.archetypeTags),
      ...readStringArray(characterLayer?.archetypeTags),
      ...readStringArray(characterLayer?.roleArchetype),
    ]),
    settingTags: normalizeSignalArray([
      ...readStringArray(source.settingTags),
      ...readStringArray(worldbuildingLayer?.settingTags),
      ...readStringArray(worldbuildingLayer?.universe),
      ...readStringArray(worldbuildingLayer?.theme),
      ...readStringArray(worldbuildingLayer?.faction),
    ]),
    genreTags: normalizeSignalArray([
      ...readStringArray(source.genreTags),
      ...readStringArray(worldbuildingLayer?.genreTags),
      ...readStringArray(worldbuildingLayer?.theme),
    ]),
    colorHints: normalizeSignalArray([
      ...readStringArray(source.colorHints),
      ...readStringArray(visualLayer?.primaryColors),
      ...readStringArray(visualLayer?.colorPalette),
    ]),
    rarityHints: normalizeSignalArray([
      ...readStringArray(source.rarityHints),
      ...readStringArray(visualLayer?.raritySignals),
      readString(commerceLayer?.rarity),
    ]),
    commerceKeywords: normalizeSignalArray([
      ...readStringArray(source.commerceIntent),
      ...readStringArray(commerceLayer?.searchKeywords),
      ...readStringArray(commerceLayer?.collectorHooks),
      ...readStringArray(commerceLayer?.marketingAngles),
      ...readStringArray(commerceLayer?.audienceTags),
      readString(commerceLayer?.category),
      readString(commerceLayer?.pricingTier),
    ]),
  };
};

const buildFallbackSignals = (card: GalleryCardRecord): SignalCollection => ({
  visualStyle: normalizeSignalArray([card.style, card.color, ...card.tags, card.title]),
  moodTags: normalizeSignalArray([card.description, ...card.tags, card.title]),
  toneTags: normalizeSignalArray([card.description, ...card.tags, card.title]),
  characterTypes: normalizeSignalArray([card.character, card.title, ...card.tags, card.description]),
  archetypeTags: normalizeSignalArray([card.character, card.title, ...card.tags, card.description]),
  settingTags: normalizeSignalArray([card.category, card.description, ...card.tags]),
  genreTags: normalizeSignalArray([card.style, card.category, card.description, ...card.tags, card.title]),
  colorHints: normalizeSignalArray([card.color, ...card.tags, card.title]),
  rarityHints: normalizeSignalArray([card.rarity]),
  commerceKeywords: normalizeSignalArray([card.rarity, card.category, card.style, card.color, ...card.tags, card.title]),
});

const normalizeCardIntelligence = (card: GalleryCardRecord): NormalizedCardIntelligence => ({
  metadataSignals: buildMetadataSignals(card.metadata),
  fallbackSignals: buildFallbackSignals(card),
});

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

const mergeSignalStrength = (queryTerms: string[], metadataTerms: string[], fallbackTerms: string[]): { score: number; fallbackBoost: number } => {
  const metadataScore = matchStrength(queryTerms, metadataTerms);
  const fallbackScore = matchStrength(queryTerms, fallbackTerms);
  const weightedFallback = roundScore(fallbackScore * WEAK_TEXT_MATCH_FACTOR);
  return {
    score: Math.max(metadataScore, weightedFallback),
    fallbackBoost: metadataScore > 0 ? 0 : weightedFallback,
  };
};

const collectQuerySignals = (input: RecommendationInput): QuerySignals => {
  const intelligenceQuery = input.intelligenceQuery ?? input.parsedQuery.intelligenceQuery;
  const visualStyle = normalizeSignalArray([
    ...input.parsedQuery.visualStyle,
    ...(intelligenceQuery?.visualStyle ?? []),
    ...(intelligenceQuery?.visualIntent ?? []),
    ...input.parsedQuery.colorHints,
    ...(intelligenceQuery?.colorHints ?? []),
    input.parsedQuery.style,
    input.parsedQuery.color,
  ]);
  const moodTags = normalizeSignalArray([
    ...input.parsedQuery.moodTags,
    ...(intelligenceQuery?.moodTags ?? []),
    ...(intelligenceQuery?.emotionalIntent ?? []),
    input.parsedQuery.mood,
  ]);
  const toneTags = normalizeSignalArray([
    ...input.parsedQuery.toneTags,
    ...(intelligenceQuery?.toneTags ?? []),
  ]);
  const characterTypes = normalizeSignalArray([
    ...input.parsedQuery.characterTypes,
    ...(intelligenceQuery?.characterTypes ?? []),
    ...(intelligenceQuery?.characterIntent ?? []),
    input.parsedQuery.character,
  ]);
  const archetypeTags = normalizeSignalArray([
    ...input.parsedQuery.archetypeTags,
    ...(intelligenceQuery?.archetypeTags ?? []),
    ...(intelligenceQuery?.characterIntent ?? []),
    input.parsedQuery.character,
  ]);
  const settingTags = normalizeSignalArray([
    ...input.parsedQuery.settingTags,
    ...(intelligenceQuery?.settingTags ?? []),
    ...(intelligenceQuery?.worldbuildingIntent ?? []),
    input.parsedQuery.scene,
  ]);
  const genreTags = normalizeSignalArray([
    ...input.parsedQuery.genreTags,
    ...(intelligenceQuery?.genreTags ?? []),
    input.parsedQuery.style,
    input.parsedQuery.category,
  ]);
  const colorHints = normalizeSignalArray([
    ...input.parsedQuery.colorHints,
    ...(intelligenceQuery?.colorHints ?? []),
    input.parsedQuery.color,
  ]);
  const commerceSignals = normalizeSignalArray([
    ...(intelligenceQuery?.commerceIntent ?? []),
    ...(intelligenceQuery?.rarityHints ?? []),
    input.parsedQuery.rarity,
    input.parsedQuery.category,
    ...input.parsedQuery.keywords,
  ]);

  const combined = uniqueNormalized([...visualStyle, ...moodTags, ...toneTags, ...characterTypes, ...archetypeTags, ...genreTags]);
  const explicitRoleFamilies = ROLE_FAMILY_TERMS.filter((term) => combined.some((item) => termMatches(item, term)));
  const explicitThemeFamilies = THEME_FAMILY_TERMS.filter((term) => combined.some((item) => termMatches(item, term)));

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
    explicitRoleFamilies,
    explicitThemeFamilies,
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

const buildCardSignals = (card: GalleryCardRecord, intelligence: NormalizedCardIntelligence): CardSignals => ({
  visualStyle: uniqueNormalized([...intelligence.metadataSignals.visualStyle, ...intelligence.metadataSignals.colorHints, ...intelligence.fallbackSignals.visualStyle, ...intelligence.fallbackSignals.colorHints, card.style, card.color]),
  moodTags: uniqueNormalized([...intelligence.metadataSignals.moodTags, ...intelligence.metadataSignals.toneTags, ...intelligence.fallbackSignals.moodTags]),
  characterTypes: uniqueNormalized([...intelligence.metadataSignals.characterTypes, ...intelligence.fallbackSignals.characterTypes]),
  archetypeTags: uniqueNormalized([...intelligence.metadataSignals.archetypeTags, ...intelligence.fallbackSignals.archetypeTags]),
  settingTags: uniqueNormalized([...intelligence.metadataSignals.settingTags, ...intelligence.fallbackSignals.settingTags]),
  genreTags: uniqueNormalized([...intelligence.metadataSignals.genreTags, ...intelligence.fallbackSignals.genreTags]),
  commerceSignals: uniqueNormalized([
    ...intelligence.metadataSignals.commerceKeywords,
    ...intelligence.metadataSignals.rarityHints,
    ...intelligence.fallbackSignals.commerceKeywords,
    ...intelligence.fallbackSignals.rarityHints,
    card.rarity,
  ]),
});

const toPercent = (score: number, weight: number): number => roundScore(score * weight * 100);

const selectWeightProfile = (signals: QuerySignals): WeightProfile => {
  const hasExplicitRole = signals.explicitRoleFamilies.length > 0;
  const hasExplicitTheme = signals.explicitThemeFamilies.length > 0;

  if (hasExplicitRole && hasExplicitTheme) {
    return MIXED_WEIGHT_PROFILE;
  }
  if (hasExplicitRole) {
    return ARCHETYPE_HEAVY_WEIGHT_PROFILE;
  }
  if (hasExplicitTheme) {
    return THEME_HEAVY_WEIGHT_PROFILE;
  }
  return BASE_WEIGHT_PROFILE;
};

const buildThemeBucket = (cardSignals: CardSignals, recommendationScore: RecommendationScore): string => {
  const mainVisual = cardSignals.visualStyle[0] ?? "visual";
  const mainArchetype = cardSignals.archetypeTags[0] ?? cardSignals.characterTypes[0] ?? "character";
  const mainGenre = cardSignals.genreTags[0] ?? cardSignals.settingTags[0] ?? "genre";
  const dominant =
    recommendationScore.archetypeMatch >= recommendationScore.visualMatch && recommendationScore.archetypeMatch >= recommendationScore.genreMatch
      ? mainArchetype
      : recommendationScore.visualMatch >= recommendationScore.genreMatch
        ? mainVisual
        : mainGenre;

  return normalizeText(`${dominant}|${mainArchetype}|${mainGenre}`);
};

const resolveRarityWeight = (card: GalleryCardRecord, cardSignals: CardSignals): number => {
  const rarity = normalizeText(card.rarity);
  if (rarity === "ur" || cardSignals.commerceSignals.includes("ur")) return 100;
  if (rarity === "ssr" || cardSignals.commerceSignals.includes("ssr")) return 88;
  if (rarity === "sr" || cardSignals.commerceSignals.includes("sr")) return 72;
  if (rarity === "r" || cardSignals.commerceSignals.includes("r")) return 55;
  return 40;
};

const resolveLuxuryAura = (signals: QuerySignals, cardSignals: CardSignals): string => {
  const combined = uniqueNormalized([
    ...signals.visualStyle,
    ...signals.moodTags,
    ...signals.archetypeTags,
    ...cardSignals.visualStyle,
    ...cardSignals.moodTags,
    ...cardSignals.archetypeTags,
    ...cardSignals.genreTags,
  ]);

  if (combined.some((term) => termMatches(term, "divine") || termMatches(term, "holy") || termMatches(term, "priestess"))) {
    return "divine_luxury";
  }
  if (combined.some((term) => termMatches(term, "queen") || termMatches(term, "empress") || termMatches(term, "boss like") || termMatches(term, "black gold"))) {
    return "regal_luxury";
  }
  if (combined.some((term) => termMatches(term, "cyberpunk") || termMatches(term, "mecha"))) {
    return "neon_premium";
  }
  if (combined.some((term) => termMatches(term, "gothic") || termMatches(term, "dark fantasy"))) {
    return "shadow_collectible";
  }
  return "collector_classic";
};

const buildCommerceIntelligence = (
  card: GalleryCardRecord,
  signals: QuerySignals,
  cardSignals: CardSignals,
  recommendationScore: RecommendationScore
): RecommendationCommerceIntelligence => {
  const rarityWeight = resolveRarityWeight(card, cardSignals);
  const collectorThemeBonus = COLLECTOR_THEME_FAMILIES.filter((term) =>
    [...signals.visualStyle, ...signals.genreTags, ...signals.archetypeTags, ...cardSignals.visualStyle, ...cardSignals.archetypeTags].some((item) =>
      termMatches(item, term)
    )
  ).length * 4;
  const collectorScore = Math.min(
    100,
    roundScore(rarityWeight * 0.55 + recommendationScore.finalScore * 0.35 + collectorThemeBonus)
  );
  const mainstreamAppeal = Math.min(
    100,
    roundScore(
      35 +
        recommendationScore.visualMatch * 0.45 +
        recommendationScore.characterMatch * 0.35 +
        recommendationScore.genreMatch * 0.2
    )
  );
  const impulseBuyScore = Math.min(
    100,
    roundScore(
      20 +
        recommendationScore.visualMatch * 0.5 +
        recommendationScore.commerceMatch * 0.8 +
        rarityWeight * 0.2 +
        mainstreamAppeal * 0.15
    )
  );

  return {
    collectorScore,
    impulseBuyScore,
    luxuryAura: resolveLuxuryAura(signals, cardSignals),
    rarityWeight,
    mainstreamAppeal,
  };
};

const buildCommercePresentation = (
  card: GalleryCardRecord,
  signals: QuerySignals,
  cardSignals: CardSignals,
  commerceIntelligence: RecommendationCommerceIntelligence
): RecommendationCommercePresentation => {
  const visualAnchor = uniqueNormalized([...signals.visualStyle, ...signals.colorHints, ...cardSignals.visualStyle])[0] ?? "signature";
  const archetypeAnchor = uniqueNormalized([...signals.archetypeTags, ...signals.characterTypes, ...cardSignals.archetypeTags, ...cardSignals.characterTypes])[0] ?? "collector";
  const rarity = normalizeText(card.rarity).toUpperCase() || "Collector";
  const collectorPositioning =
    commerceIntelligence.collectorScore >= 85
      ? `Collector signal: ${visualAnchor} ${rarity} relic-style pick`
      : `Collector signal: ${archetypeAnchor} showcase collectible`;
  const rarityFraming =
    rarity === "UR"
      ? "Rarity framing: UR apex collectible"
      : rarity === "SSR"
        ? "Rarity framing: SSR collector-tier card"
        : rarity === "SR"
          ? "Rarity framing: SR signature edition card"
          : "Rarity framing: curated collectible card";

  const auraPresentation =
    commerceIntelligence.luxuryAura === "divine_luxury"
      ? "Luxury aura: divine relic presentation"
      : commerceIntelligence.luxuryAura === "regal_luxury"
        ? "Luxury aura: regal boss-like presentation"
        : commerceIntelligence.luxuryAura === "neon_premium"
          ? "Luxury aura: neon premium collector energy"
          : commerceIntelligence.luxuryAura === "shadow_collectible"
            ? "Luxury aura: dark gallery collector energy"
            : "Luxury aura: premium collectible presentation";

  return {
    collectorPositioning,
    rarityFraming,
    auraPresentation,
    commerceReasons: [collectorPositioning, rarityFraming, auraPresentation].slice(0, 3),
  };
};

const buildReasons = (
  signals: QuerySignals,
  cardSignals: CardSignals,
  recommendationScore: RecommendationScore,
  card: GalleryCardRecord,
  commercePresentation?: RecommendationCommercePresentation
): string[] => {
  const reasons: string[] = [];
  const visualTerms = uniqueNormalized([...signals.visualStyle, ...signals.colorHints]);
  const moodTerms = uniqueNormalized([...signals.moodTags, ...signals.toneTags]);
  const characterTerms = uniqueNormalized([...signals.characterTypes]);
  const archetypeTerms = uniqueNormalized([...signals.archetypeTags]);
  const genreTerms = uniqueNormalized([...signals.genreTags]);

  if (recommendationScore.archetypeMatch >= 10 && archetypeTerms.length > 0) {
    reasons.push(`Strong ${archetypeTerms[0]} archetype match`);
  }
  if (recommendationScore.characterMatch >= 9 && characterTerms.length > 0) {
    reasons.push(`Character aligns with ${characterTerms.slice(0, 2).join(" / ")}`);
  }
  if (recommendationScore.visualMatch >= 9 && visualTerms.length > 0) {
    reasons.push(`Matches ${visualTerms.slice(0, 2).join("_")} visual style`);
  }
  if (recommendationScore.moodMatch >= 8 && moodTerms.length > 0) {
    reasons.push(`Mood aligns with ${moodTerms.slice(0, 2).join(" / ")}`);
  }
  if (recommendationScore.genreMatch >= 6 && genreTerms.length > 0) {
    reasons.push(`Genre fits ${genreTerms.slice(0, 2).join(" / ")}`);
  }
  if (recommendationScore.commerceMatch >= 4) {
    if (normalizeText(card.rarity) === "ssr" || cardSignals.commerceSignals.includes("ssr")) {
      reasons.push("SSR rarity matched");
    } else {
      reasons.push("Commerce signals matched");
    }
  }
  if (commercePresentation) {
    reasons.push(...commercePresentation.commerceReasons);
  }

  return uniqueNormalized(reasons).map((reason) => reason.replace(/\s+/g, " ").trim()).slice(0, 4);
};

const calculateMismatchPenalty = (signals: QuerySignals, cardSignals: CardSignals): number => {
  let penalty = 0;

  if (signals.explicitRoleFamilies.includes("mecha girl") && !cardSignals.characterTypes.some((term) => termMatches(term, "mecha girl") || termMatches(term, "mecha"))) {
    penalty += MECHA_MISMATCH_PENALTY;
  }
  if (
    signals.explicitRoleFamilies.some((term) => term === "queen" || term === "empress") &&
    !cardSignals.archetypeTags.some((term) => termMatches(term, "queen") || termMatches(term, "empress") || termMatches(term, "ruler"))
  ) {
    penalty += QUEEN_MISMATCH_PENALTY;
  }
  if (
    signals.explicitRoleFamilies.includes("priestess") &&
    !uniqueNormalized([...cardSignals.characterTypes, ...cardSignals.archetypeTags, ...cardSignals.genreTags]).some(
      (term) => termMatches(term, "priestess") || termMatches(term, "holy female") || termMatches(term, "divine")
    )
  ) {
    penalty += PRIESTESS_MISMATCH_PENALTY;
  }
  if (
    signals.explicitRoleFamilies.some((term) => term === "warrior" || term === "paladin" || term === "commander") &&
    !uniqueNormalized([...cardSignals.characterTypes, ...cardSignals.archetypeTags]).some(
      (term) => termMatches(term, "warrior") || termMatches(term, "holy warrior") || termMatches(term, "leader")
    )
  ) {
    penalty += WARRIOR_MISMATCH_PENALTY;
  }

  return roundScore(penalty);
};

const scoreCard = (card: GalleryCardRecord, input: RecommendationInput, signals: QuerySignals, weightProfile: WeightProfile): ScoredCard => {
  const breakdown = EMPTY_BREAKDOWN();
  const recommendationScore = EMPTY_RECOMMENDATION_SCORE();
  const intelligence = normalizeCardIntelligence(card);
  const metadataSignals = intelligence.metadataSignals;
  const fallbackSignals = intelligence.fallbackSignals;
  const hasUsableIntelligence = Object.values(metadataSignals).some((values) => values.length > 0);

  const visual = mergeSignalStrength(
    uniqueNormalized([...signals.visualStyle, ...signals.colorHints]),
    uniqueNormalized([...metadataSignals.visualStyle, ...metadataSignals.colorHints]),
    uniqueNormalized([...fallbackSignals.visualStyle, ...fallbackSignals.colorHints])
  );
  const mood = mergeSignalStrength(
    uniqueNormalized([...signals.moodTags, ...signals.toneTags]),
    uniqueNormalized([...metadataSignals.moodTags, ...metadataSignals.toneTags]),
    uniqueNormalized([...fallbackSignals.moodTags, ...fallbackSignals.toneTags])
  );
  const character = mergeSignalStrength(signals.characterTypes, metadataSignals.characterTypes, fallbackSignals.characterTypes);
  const archetype = mergeSignalStrength(signals.archetypeTags, metadataSignals.archetypeTags, fallbackSignals.archetypeTags);
  const setting = mergeSignalStrength(signals.settingTags, metadataSignals.settingTags, fallbackSignals.settingTags);
  const genre = mergeSignalStrength(signals.genreTags, metadataSignals.genreTags, fallbackSignals.genreTags);
  const commerce = mergeSignalStrength(
    signals.commerceSignals,
    uniqueNormalized([...metadataSignals.commerceKeywords, ...metadataSignals.rarityHints]),
    uniqueNormalized([...fallbackSignals.commerceKeywords, ...fallbackSignals.rarityHints])
  );

  recommendationScore.visualMatch = toPercent(visual.score, weightProfile.visualMatch);
  recommendationScore.moodMatch = toPercent(mood.score, weightProfile.moodMatch);
  recommendationScore.characterMatch = toPercent(character.score, weightProfile.characterMatch);
  recommendationScore.archetypeMatch = toPercent(archetype.score, weightProfile.archetypeMatch);
  recommendationScore.settingMatch = toPercent(setting.score, weightProfile.settingMatch);
  recommendationScore.genreMatch = toPercent(genre.score, weightProfile.genreMatch);
  recommendationScore.commerceMatch = toPercent(commerce.score, weightProfile.commerceMatch);

  const subtotal = roundScore(
    recommendationScore.visualMatch +
      recommendationScore.moodMatch +
      recommendationScore.characterMatch +
      recommendationScore.archetypeMatch +
      recommendationScore.settingMatch +
      recommendationScore.genreMatch +
      recommendationScore.commerceMatch
  );

  const cardSignals = buildCardSignals(card, intelligence);
  const mismatchPenalty = calculateMismatchPenalty(signals, cardSignals);
  const commerceIntelligence = buildCommerceIntelligence(card, signals, cardSignals, {
    ...recommendationScore,
    finalScore: subtotal,
  });
  const commercePresentation = buildCommercePresentation(card, signals, cardSignals, commerceIntelligence);
  recommendationScore.finalScore = roundScore(Math.max(0, subtotal - mismatchPenalty));
  recommendationScore.reasons = buildReasons(signals, cardSignals, recommendationScore, card, commercePresentation);

  breakdown.visualMatch = recommendationScore.visualMatch;
  breakdown.moodEmotionalMatch = recommendationScore.moodMatch;
  breakdown.characterMatch = roundScore(recommendationScore.characterMatch + recommendationScore.archetypeMatch);
  breakdown.worldbuildingMatch = roundScore(recommendationScore.settingMatch + recommendationScore.genreMatch);
  breakdown.commerceMatch = recommendationScore.commerceMatch;
  breakdown.keywordFallback = roundScore(
    (visual.fallbackBoost + mood.fallbackBoost + character.fallbackBoost + archetype.fallbackBoost + setting.fallbackBoost + genre.fallbackBoost + commerce.fallbackBoost) *
      100
  );
  breakdown.matchedWeight = recommendationScore.finalScore;
  breakdown.total = recommendationScore.finalScore;

  return {
    card,
    index: -1,
    subtotal,
    themeBucket: buildThemeBucket(cardSignals, recommendationScore),
    debugEntry: {
      cardId: card.id,
      title: card.title,
      hasUsableIntelligence,
      breakdown,
      recommendationScore,
      commerceIntelligence,
      commercePresentation,
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

    const diversityPenalty = roundScore(Math.min(seenCount * DIVERSITY_PENALTY_STEP, MAX_DIVERSITY_PENALTY));
    entry.debugEntry.recommendationScore.diversityPenalty = diversityPenalty;
    entry.debugEntry.recommendationScore.finalScore = roundScore(
      Math.max(0, entry.debugEntry.recommendationScore.finalScore - diversityPenalty)
    );
    entry.debugEntry.breakdown.matchedWeight = entry.debugEntry.recommendationScore.finalScore;
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
      const weightProfile = selectWeightProfile(signals);
      const scored = input.candidates.map((card, index) => ({
        ...scoreCard(card, input, signals, weightProfile),
        index,
      }));

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
