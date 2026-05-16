import path from "node:path";
import { Prisma } from "@prisma/client";
import type {
  RecommendationAnalyticsCardPerformance,
  RecommendationAnalyticsCheckoutDropoffItem,
  RecommendationAnalyticsConversionMetrics,
  RecommendationAnalyticsDimensionBucket,
  RecommendationAnalyticsDimensionKey,
  RecommendationAnalyticsFieldCoverage,
  RecommendationAnalyticsMetadataCoverage,
  RecommendationAnalyticsMetadataPerformance,
  RecommendationAnalyticsParserStability,
  RecommendationAnalyticsRateMetric,
  RecommendationAnalyticsReport,
  RecommendationAnalyticsSelectionMetrics,
  RecommendationAnalyticsSource,
  RecommendationAnalyticsSparseFamily,
  RecommendationAnalyticsTopPurchasedMetadata,
  RecommendationAnalyticsWeakMatchItem,
} from "../types/recommendation-analytics.types";
import type { RecommendationFeedbackEvent } from "../types/recommendation-feedback.types";
import {
  RecommendationAnalyticsGalleryRecord,
  RecommendationAnalyticsOrderRecord,
  recommendationAnalyticsRepository,
} from "../repositories/recommendation-analytics.repository";

const DEFAULT_TIMEZONE = "Asia/Shanghai";
const DEFAULT_LOW_PERFORMANCE_IMPRESSIONS = 10;
const DEFAULT_TOP_LIMIT = 10;
const DEFAULT_FEEDBACK_FILE = path.join(process.cwd(), "reports", "recommendation-feedback.jsonl");
const DIMENSION_KEYS: RecommendationAnalyticsDimensionKey[] = [
  "rarity",
  "style",
  "character",
  "color",
  "title",
  "priceTier",
  "visualStyle",
  "moodTags",
  "toneTags",
  "characterTypes",
  "archetypeTags",
  "settingTags",
  "genreTags",
  "colorHints",
];
const FIELD_COVERAGE_KEYS = [
  "visualStyle",
  "moodTags",
  "toneTags",
  "characterTypes",
  "archetypeTags",
  "settingTags",
  "genreTags",
  "colorHints",
] as const;
const SPARSE_FAMILIES = ["cyberpunk", "mecha", "holy", "divine", "boss_like", "queen", "empress", "goddess", "warrior", "priestess"];
const ARCHETYPE_FAMILIES = ["queen", "empress", "goddess", "priestess", "warrior", "paladin", "commander", "mecha girl"];

type AnalyticsCounter = {
  impressions: number;
  selections: number;
  checkoutCreated: number;
  purchases: number;
};

type DimensionCounterMap = Map<string, AnalyticsCounter>;

type MetadataSignalShape = {
  visualStyle: string[];
  moodTags: string[];
  toneTags: string[];
  characterTypes: string[];
  archetypeTags: string[];
  settingTags: string[];
  genreTags: string[];
  colorHints: string[];
};

type QueryWeakMatchCounter = {
  searchCount: number;
  selectionCount: number;
  checkoutCount: number;
  paidCount: number;
  top1MissCount: number;
  top3MissCount: number;
  rerankSearchCount: number;
};

type ReportBuildInput = {
  source: RecommendationAnalyticsSource;
  parsedEvents: RecommendationFeedbackEvent[];
  totalLines: number;
  invalidLineCount: number;
};

const safeRate = (numerator: number, denominator: number): number => {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
};

const buildRateMetric = (numerator: number, denominator: number): RecommendationAnalyticsRateMetric => ({
  numerator,
  denominator,
  rate: denominator > 0 ? numerator / denominator : null,
  insufficientData: denominator <= 0,
});

const toDateKey = (date: Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

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

const normalizeBucket = (value: string | null | undefined): string => {
  const normalized = value?.trim();
  return normalized || "unknown";
};

const resolvePriceTier = (value: number | null): string => {
  if (value == null) return "unknown";
  if (value < 10) return "<10";
  if (value < 20) return "10-19.99";
  if (value < 30) return "20-29.99";
  return "30+";
};

const incrementCounter = (counter: AnalyticsCounter, field: keyof AnalyticsCounter): void => {
  counter[field] += 1;
};

const getCounter = (map: DimensionCounterMap, bucket: string): AnalyticsCounter => {
  const existing = map.get(bucket);
  if (existing) {
    return existing;
  }
  const created: AnalyticsCounter = {
    impressions: 0,
    selections: 0,
    checkoutCreated: 0,
    purchases: 0,
  };
  map.set(bucket, created);
  return created;
};

const isJsonObject = (value: Prisma.JsonValue | null): value is Prisma.JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

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

const extractMetadataSignals = (metadata: Prisma.JsonValue | null): MetadataSignalShape => {
  const source = extractIntelligenceSource(metadata);
  if (!source) {
    return {
      visualStyle: [],
      moodTags: [],
      toneTags: [],
      characterTypes: [],
      archetypeTags: [],
      settingTags: [],
      genreTags: [],
      colorHints: [],
    };
  }

  const visualLayer = readObject(source.visualLayer);
  const emotionalLayer = readObject(source.emotionalLayer);
  const characterLayer = readObject(source.characterLayer);
  const worldbuildingLayer = readObject(source.worldbuildingLayer);

  return {
    visualStyle: uniqueNormalized([
      ...readStringArray(source.visualStyle),
      ...readStringArray(visualLayer?.visualStyle),
      ...readStringArray(visualLayer?.styleTags),
      ...readStringArray(visualLayer?.artStyle),
    ]),
    moodTags: uniqueNormalized([
      ...readStringArray(source.moodTags),
      ...readStringArray(emotionalLayer?.moodTags),
      ...readStringArray(emotionalLayer?.mood),
      ...readStringArray(emotionalLayer?.atmosphere),
    ]),
    toneTags: uniqueNormalized([
      ...readStringArray(source.toneTags),
      ...readStringArray(emotionalLayer?.toneTags),
    ]),
    characterTypes: uniqueNormalized([
      ...readStringArray(source.characterTypes),
      ...readStringArray(characterLayer?.characterTypes),
      ...readStringArray(characterLayer?.characterType),
      readString(characterLayer?.entityType),
      readString(characterLayer?.genderPresentation),
    ]),
    archetypeTags: uniqueNormalized([
      ...readStringArray(source.archetypeTags),
      ...readStringArray(characterLayer?.archetypeTags),
      ...readStringArray(characterLayer?.roleArchetype),
    ]),
    settingTags: uniqueNormalized([
      ...readStringArray(source.settingTags),
      ...readStringArray(worldbuildingLayer?.settingTags),
      ...readStringArray(worldbuildingLayer?.universe),
      ...readStringArray(worldbuildingLayer?.theme),
      ...readStringArray(worldbuildingLayer?.faction),
    ]),
    genreTags: uniqueNormalized([
      ...readStringArray(source.genreTags),
      ...readStringArray(worldbuildingLayer?.genreTags),
      ...readStringArray(worldbuildingLayer?.theme),
    ]),
    colorHints: uniqueNormalized([
      ...readStringArray(source.colorHints),
      ...readStringArray(visualLayer?.primaryColors),
      ...readStringArray(visualLayer?.colorPalette),
    ]),
  };
};

const flattenMetadataSignals = (signals: MetadataSignalShape): string[] =>
  uniqueNormalized([
    ...signals.visualStyle,
    ...signals.moodTags,
    ...signals.toneTags,
    ...signals.characterTypes,
    ...signals.archetypeTags,
    ...signals.settingTags,
    ...signals.genreTags,
    ...signals.colorHints,
  ]);

const sortDimensionBuckets = (buckets: RecommendationAnalyticsDimensionBucket[]): RecommendationAnalyticsDimensionBucket[] =>
  [...buckets].sort((left, right) => {
    if (right.purchases !== left.purchases) return right.purchases - left.purchases;
    if (right.checkoutCreated !== left.checkoutCreated) return right.checkoutCreated - left.checkoutCreated;
    if (right.selections !== left.selections) return right.selections - left.selections;
    if (right.impressions !== left.impressions) return right.impressions - left.impressions;
    return left.bucket.localeCompare(right.bucket);
  });

const toDimensionBuckets = (map: DimensionCounterMap): RecommendationAnalyticsDimensionBucket[] =>
  sortDimensionBuckets(
    Array.from(map.entries()).map(([bucket, counts]) => ({
      bucket,
      impressions: counts.impressions,
      selections: counts.selections,
      checkoutCreated: counts.checkoutCreated,
      purchases: counts.purchases,
      selectionRate: safeRate(counts.selections, counts.impressions),
      checkoutRate: safeRate(counts.checkoutCreated, counts.selections),
      purchaseRate: safeRate(counts.purchases, counts.checkoutCreated),
    }))
  );

const buildDimensionMaps = (): Record<RecommendationAnalyticsDimensionKey, DimensionCounterMap> => ({
  rarity: new Map<string, AnalyticsCounter>(),
  style: new Map<string, AnalyticsCounter>(),
  character: new Map<string, AnalyticsCounter>(),
  color: new Map<string, AnalyticsCounter>(),
  title: new Map<string, AnalyticsCounter>(),
  priceTier: new Map<string, AnalyticsCounter>(),
  visualStyle: new Map<string, AnalyticsCounter>(),
  moodTags: new Map<string, AnalyticsCounter>(),
  toneTags: new Map<string, AnalyticsCounter>(),
  characterTypes: new Map<string, AnalyticsCounter>(),
  archetypeTags: new Map<string, AnalyticsCounter>(),
  settingTags: new Map<string, AnalyticsCounter>(),
  genreTags: new Map<string, AnalyticsCounter>(),
  colorHints: new Map<string, AnalyticsCounter>(),
});

const collectExposureCardIds = (events: RecommendationFeedbackEvent[]): string[] => {
  const cardIds = new Set<string>();
  for (const event of events) {
    if (event.eventType !== "search") continue;
    for (const item of event.recommendationDebugSummary?.top10AfterRerank ?? []) {
      if (item.id) cardIds.add(item.id);
    }
    for (const item of event.recommendationDebugSummary?.top10BeforeRerank ?? []) {
      if (item.id) cardIds.add(item.id);
    }
  }
  return [...cardIds];
};

const collectSelectedCardIds = (events: RecommendationFeedbackEvent[]): string[] => {
  const cardIds = new Set<string>();
  for (const event of events) {
    if (event.selectedCardId) {
      cardIds.add(event.selectedCardId);
    }
  }
  return [...cardIds];
};

const collectOrderNumbers = (events: RecommendationFeedbackEvent[]): string[] => {
  const orderNumbers = new Set<string>();
  for (const event of events) {
    if (event.orderNumber) {
      orderNumbers.add(event.orderNumber);
    }
  }
  return [...orderNumbers];
};

const resolveCard = (
  event: RecommendationFeedbackEvent,
  ordersByNumber: Map<string, RecommendationAnalyticsOrderRecord>,
  cardsById: Map<string, RecommendationAnalyticsGalleryRecord>
): RecommendationAnalyticsGalleryRecord | null => {
  if (event.selectedCardId && cardsById.has(event.selectedCardId)) {
    return cardsById.get(event.selectedCardId) ?? null;
  }

  if (event.orderNumber) {
    const order = ordersByNumber.get(event.orderNumber);
    if (order && cardsById.has(order.galleryCardId)) {
      return cardsById.get(order.galleryCardId) ?? null;
    }
  }

  return null;
};

const resolvePriceForStage = (
  event: RecommendationFeedbackEvent,
  card: RecommendationAnalyticsGalleryRecord | null,
  ordersByNumber: Map<string, RecommendationAnalyticsOrderRecord>
): number | null => {
  if ((event.eventType === "checkout_created" || event.eventType === "purchase_completed") && event.orderNumber) {
    const order = ordersByNumber.get(event.orderNumber);
    if (order) {
      const numeric = Number(order.amount);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }
  }
  return card ? card.price : null;
};

const incrementBucketList = (map: DimensionCounterMap, values: string[], field: keyof AnalyticsCounter): void => {
  if (values.length === 0) {
    incrementCounter(getCounter(map, "unknown"), field);
    return;
  }
  for (const value of values) {
    incrementCounter(getCounter(map, value), field);
  }
};

const incrementDimensions = (
  dimensionMaps: Record<RecommendationAnalyticsDimensionKey, DimensionCounterMap>,
  card: RecommendationAnalyticsGalleryRecord | null,
  price: number | null,
  field: keyof AnalyticsCounter
): void => {
  const metadataSignals = extractMetadataSignals(card?.metadata ?? null);
  incrementCounter(getCounter(dimensionMaps.rarity, normalizeBucket(card?.rarity)), field);
  incrementCounter(getCounter(dimensionMaps.style, normalizeBucket(card?.style)), field);
  incrementCounter(getCounter(dimensionMaps.character, normalizeBucket(card?.character)), field);
  incrementCounter(getCounter(dimensionMaps.color, normalizeBucket(card?.color)), field);
  incrementCounter(getCounter(dimensionMaps.title, normalizeBucket(card?.title)), field);
  incrementCounter(getCounter(dimensionMaps.priceTier, resolvePriceTier(price)), field);
  incrementBucketList(dimensionMaps.visualStyle, metadataSignals.visualStyle, field);
  incrementBucketList(dimensionMaps.moodTags, metadataSignals.moodTags, field);
  incrementBucketList(dimensionMaps.toneTags, metadataSignals.toneTags, field);
  incrementBucketList(dimensionMaps.characterTypes, metadataSignals.characterTypes, field);
  incrementBucketList(dimensionMaps.archetypeTags, metadataSignals.archetypeTags, field);
  incrementBucketList(dimensionMaps.settingTags, metadataSignals.settingTags, field);
  incrementBucketList(dimensionMaps.genreTags, metadataSignals.genreTags, field);
  incrementBucketList(dimensionMaps.colorHints, metadataSignals.colorHints, field);
};

const buildTopPurchasedMetadata = (
  metadataPerformance: RecommendationAnalyticsMetadataPerformance
): RecommendationAnalyticsTopPurchasedMetadata => {
  const result = {} as RecommendationAnalyticsTopPurchasedMetadata;
  for (const key of DIMENSION_KEYS) {
    result[key] = metadataPerformance[key].filter((item) => item.purchases > 0).slice(0, 5);
  }
  return result;
};

const buildTopConvertingStyles = (styleBuckets: RecommendationAnalyticsDimensionBucket[]): RecommendationAnalyticsDimensionBucket[] =>
  [...styleBuckets]
    .filter((item) => item.impressions >= DEFAULT_LOW_PERFORMANCE_IMPRESSIONS && item.checkoutCreated > 0)
    .sort((left, right) => {
      if (right.purchaseRate !== left.purchaseRate) return right.purchaseRate - left.purchaseRate;
      if (right.purchases !== left.purchases) return right.purchases - left.purchases;
      return right.impressions - left.impressions;
    })
    .slice(0, 5);

const buildCheckoutDropoff = (titleBuckets: RecommendationAnalyticsDimensionBucket[]): RecommendationAnalyticsCheckoutDropoffItem[] =>
  [...titleBuckets]
    .filter((item) => item.checkoutCreated > item.purchases)
    .map((item) => ({
      bucket: item.bucket,
      title: item.bucket,
      checkoutCreated: item.checkoutCreated,
      purchases: item.purchases,
      dropoffCount: item.checkoutCreated - item.purchases,
      dropoffRate: safeRate(item.checkoutCreated - item.purchases, item.checkoutCreated),
    }))
    .sort((left, right) => {
      if (right.dropoffCount !== left.dropoffCount) return right.dropoffCount - left.dropoffCount;
      return right.dropoffRate - left.dropoffRate;
    })
    .slice(0, DEFAULT_TOP_LIMIT);

const buildLowPerformingRecommendations = (titleBuckets: RecommendationAnalyticsDimensionBucket[]): RecommendationAnalyticsCardPerformance[] =>
  [...titleBuckets]
    .filter((item) => item.impressions >= DEFAULT_LOW_PERFORMANCE_IMPRESSIONS)
    .map((item) => ({
      cardId: item.bucket,
      title: item.bucket,
      impressions: item.impressions,
      selections: item.selections,
      checkoutCreated: item.checkoutCreated,
      purchases: item.purchases,
      selectionRate: item.selectionRate,
      checkoutRate: item.checkoutRate,
      purchaseRate: item.purchaseRate,
    }))
    .sort((left, right) => {
      if (left.purchaseRate !== right.purchaseRate) return left.purchaseRate - right.purchaseRate;
      if (left.selectionRate !== right.selectionRate) return left.selectionRate - right.selectionRate;
      return right.impressions - left.impressions;
    })
    .slice(0, DEFAULT_TOP_LIMIT);

const resolveSelectionRank = (event: RecommendationFeedbackEvent): number | null => {
  const selectedCardId = event.selectedCardId;
  const summary = event.recommendationDebugSummary;
  if (!selectedCardId || !summary) {
    return null;
  }

  const afterRank = summary.top10AfterRerank.findIndex((item) => item.id === selectedCardId);
  if (afterRank >= 0) {
    return afterRank + 1;
  }

  const beforeRank = summary.top10BeforeRerank.findIndex((item) => item.id === selectedCardId);
  if (beforeRank >= 0) {
    return beforeRank + 1;
  }

  return null;
};

const detectArchetypeFamilies = (event: RecommendationFeedbackEvent): string[] => {
  const intelligence = event.recommendationDebugSummary?.intelligenceQuery;
  if (!intelligence) {
    return [];
  }
  const tokens = uniqueNormalized([
    ...intelligence.characterTypes,
    ...intelligence.archetypeTags,
    ...intelligence.visualStyle,
    ...intelligence.genreTags,
  ]);
  return ARCHETYPE_FAMILIES.filter((family) => tokens.some((token) => token === family || token.includes(family) || family.includes(token)));
};

const buildObservation = (counter: QueryWeakMatchCounter, bucketLabel: string): string => {
  if (counter.searchCount > 0 && counter.selectionCount === 0) {
    return `${bucketLabel} receives searches but no selections`;
  }
  if (counter.selectionCount > 0 && counter.top1MissCount >= counter.selectionCount) {
    return `${bucketLabel} selections frequently miss top1`;
  }
  if (counter.checkoutCount === 0 && counter.selectionCount > 0) {
    return `${bucketLabel} selections are not progressing to checkout`;
  }
  if (counter.paidCount === 0 && counter.checkoutCount > 0) {
    return `${bucketLabel} checkouts are not converting to paid`;
  }
  return `${bucketLabel} shows weak downstream conversion`;
};

const toWeakMatchItems = (
  map: Map<string, QueryWeakMatchCounter>,
  bucketType: "query" | "archetype"
): RecommendationAnalyticsWeakMatchItem[] =>
  [...map.entries()]
    .map(([bucket, counter]) => ({
      bucketType,
      bucket,
      searchCount: counter.searchCount,
      selectionCount: counter.selectionCount,
      checkoutCount: counter.checkoutCount,
      paidCount: counter.paidCount,
      top1MissCount: counter.top1MissCount,
      top3MissCount: counter.top3MissCount,
      observation: buildObservation(counter, bucket),
    }))
    .filter((item) => item.searchCount > 0)
    .sort((left, right) => {
      if (right.searchCount !== left.searchCount) return right.searchCount - left.searchCount;
      if (left.paidCount !== right.paidCount) return left.paidCount - right.paidCount;
      return right.top1MissCount - left.top1MissCount;
    })
    .slice(0, DEFAULT_TOP_LIMIT);

const buildSelectionAnalytics = (events: RecommendationFeedbackEvent[]): RecommendationAnalyticsSelectionMetrics => {
  let totalSelections = 0;
  let rankedSelections = 0;
  let top1Selections = 0;
  let top3Selections = 0;
  let top5Selections = 0;

  for (const event of events) {
    if (event.eventType !== "selection") continue;
    totalSelections += 1;
    const rank = resolveSelectionRank(event);
    if (rank == null) continue;
    rankedSelections += 1;
    if (rank <= 1) top1Selections += 1;
    if (rank <= 3) top3Selections += 1;
    if (rank <= 5) top5Selections += 1;
  }

  return {
    totalSelections,
    rankedSelections,
    top1SelectionRate: buildRateMetric(top1Selections, rankedSelections),
    top3SelectionRate: buildRateMetric(top3Selections, rankedSelections),
    top5SelectionRate: buildRateMetric(top5Selections, rankedSelections),
  };
};

const buildConversionAnalytics = (
  searchCount: number,
  selectionCount: number,
  checkoutCreatedCount: number,
  paidCount: number
): RecommendationAnalyticsConversionMetrics => ({
  searchCount,
  selectionCount,
  checkoutCreatedCount,
  paidCount,
  searchToSelect: buildRateMetric(selectionCount, searchCount),
  selectToCheckout: buildRateMetric(checkoutCreatedCount, selectionCount),
  checkoutToPaid: buildRateMetric(paidCount, checkoutCreatedCount),
});

const buildWeakMatchAnalytics = (events: RecommendationFeedbackEvent[]) => {
  const queryMap = new Map<string, QueryWeakMatchCounter>();
  const archetypeMap = new Map<string, QueryWeakMatchCounter>();
  const touch = (map: Map<string, QueryWeakMatchCounter>, key: string): QueryWeakMatchCounter => {
    const existing = map.get(key);
    if (existing) return existing;
    const created: QueryWeakMatchCounter = {
      searchCount: 0,
      selectionCount: 0,
      checkoutCount: 0,
      paidCount: 0,
      top1MissCount: 0,
      top3MissCount: 0,
      rerankSearchCount: 0,
    };
    map.set(key, created);
    return created;
  };

  for (const event of events) {
    const queryKey = normalizeText(event.query);
    const archetypes = detectArchetypeFamilies(event);
    const rank = resolveSelectionRank(event);

    if (event.eventType === "search" && queryKey) {
      const counter = touch(queryMap, queryKey);
      counter.searchCount += 1;
      if (event.rerankHappened ?? event.recommendationDebugSummary?.rerankHappened) {
        counter.rerankSearchCount += 1;
      }
      for (const archetype of archetypes) {
        touch(archetypeMap, archetype).searchCount += 1;
      }
    }

    if (event.eventType === "selection") {
      if (queryKey) {
        const counter = touch(queryMap, queryKey);
        counter.selectionCount += 1;
        if (rank != null && rank > 1) counter.top1MissCount += 1;
        if (rank != null && rank > 3) counter.top3MissCount += 1;
      }
      for (const archetype of archetypes) {
        const counter = touch(archetypeMap, archetype);
        counter.selectionCount += 1;
        if (rank != null && rank > 1) counter.top1MissCount += 1;
        if (rank != null && rank > 3) counter.top3MissCount += 1;
      }
    }

    if (event.eventType === "checkout_created") {
      if (queryKey) touch(queryMap, queryKey).checkoutCount += 1;
      for (const archetype of archetypes) {
        touch(archetypeMap, archetype).checkoutCount += 1;
      }
    }

    if (event.eventType === "purchase_completed") {
      if (queryKey) touch(queryMap, queryKey).paidCount += 1;
      for (const archetype of archetypes) {
        touch(archetypeMap, archetype).paidCount += 1;
      }
    }
  }

  return {
    queries: toWeakMatchItems(queryMap, "query"),
    archetypes: toWeakMatchItems(archetypeMap, "archetype"),
  };
};

const buildMetadataCoverageAnalytics = (cards: RecommendationAnalyticsGalleryRecord[]): RecommendationAnalyticsMetadataCoverage => {
  const totalActiveCards = cards.length;
  let cardsWithAnyIntelligence = 0;
  const fieldCounts = new Map<string, number>();
  const sparseFamilyCounts = new Map<string, number>();

  for (const family of SPARSE_FAMILIES) {
    sparseFamilyCounts.set(family, 0);
  }

  for (const card of cards) {
    const signals = extractMetadataSignals(card.metadata);
    const allSignals = flattenMetadataSignals(signals);
    if (allSignals.length > 0) {
      cardsWithAnyIntelligence += 1;
    }

    for (const field of FIELD_COVERAGE_KEYS) {
      if (signals[field].length > 0) {
        fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
      }
    }

    for (const family of SPARSE_FAMILIES) {
      if (allSignals.some((signal) => signal === family || signal.includes(family) || family.includes(signal))) {
        sparseFamilyCounts.set(family, (sparseFamilyCounts.get(family) ?? 0) + 1);
      }
    }
  }

  const fieldCoverage: RecommendationAnalyticsFieldCoverage[] = FIELD_COVERAGE_KEYS.map((field) => {
    const cardsWithField = fieldCounts.get(field) ?? 0;
    return {
      field,
      totalActiveCards,
      cardsWithAnyIntelligence,
      cardsWithField,
      coverageRate: totalActiveCards > 0 ? cardsWithField / totalActiveCards : null,
      insufficientData: totalActiveCards <= 0,
    };
  });

  const sparseFamilies: RecommendationAnalyticsSparseFamily[] = SPARSE_FAMILIES.map((family) => {
    const cardsMatched = sparseFamilyCounts.get(family) ?? 0;
    return {
      family,
      cardsMatched,
      totalActiveCards,
      coverageRate: totalActiveCards > 0 ? cardsMatched / totalActiveCards : null,
      insufficientData: totalActiveCards <= 0,
    };
  }).sort((left, right) => {
    if ((left.coverageRate ?? 0) !== (right.coverageRate ?? 0)) {
      return (left.coverageRate ?? 0) - (right.coverageRate ?? 0);
    }
    return left.family.localeCompare(right.family);
  });

  return {
    totalActiveCards,
    cardsWithAnyIntelligence,
    fieldCoverage,
    sparseFamilies,
  };
};

const buildParserStabilityAnalytics = (events: RecommendationFeedbackEvent[]): RecommendationAnalyticsParserStability => {
  const searchEvents = events.filter((event) => event.eventType === "search");
  const telemetryKnownEvents = searchEvents.filter((event) => event.parserOutcome || event.parserTimedOut !== undefined || event.parserUsedFallback !== undefined).length;
  const unknownTelemetryEvents = searchEvents.length - telemetryKnownEvents;
  const outcomeMap = new Map<string, number>();
  const fallbackReasonMap = new Map<string, number>();
  let timeoutCount = 0;
  let fallbackCount = 0;
  let rerankChangedCount = 0;

  for (const event of searchEvents) {
    const outcome = event.parserOutcome ?? "unknown";
    outcomeMap.set(outcome, (outcomeMap.get(outcome) ?? 0) + 1);

    if (event.parserTimedOut === true) {
      timeoutCount += 1;
    }
    if (event.parserUsedFallback === true) {
      fallbackCount += 1;
      const fallbackReason = event.parserFallbackReason ?? "unknown";
      fallbackReasonMap.set(fallbackReason, (fallbackReasonMap.get(fallbackReason) ?? 0) + 1);
    }
    if (event.rerankHappened ?? event.recommendationDebugSummary?.rerankHappened) {
      rerankChangedCount += 1;
    }
  }

  const toBreakdown = (map: Map<string, number>) =>
    [...map.entries()]
      .map(([outcome, count]) => ({ outcome, count }))
      .sort((left, right) => {
        if (right.count !== left.count) return right.count - left.count;
        return left.outcome.localeCompare(right.outcome);
      });

  return {
    searchEvents: searchEvents.length,
    telemetryKnownEvents,
    unknownTelemetryEvents,
    timeoutRatio: buildRateMetric(timeoutCount, searchEvents.length),
    fallbackRatio: buildRateMetric(fallbackCount, searchEvents.length),
    rerankEffectivenessRatio: buildRateMetric(rerankChangedCount, searchEvents.length),
    outcomeBreakdown: toBreakdown(outcomeMap),
    fallbackReasonBreakdown: toBreakdown(fallbackReasonMap),
  };
};

const buildMetadataPerformance = (
  dimensionMaps: Record<RecommendationAnalyticsDimensionKey, DimensionCounterMap>
): RecommendationAnalyticsMetadataPerformance => {
  const result = {} as RecommendationAnalyticsMetadataPerformance;
  for (const key of DIMENSION_KEYS) {
    result[key] = toDimensionBuckets(dimensionMaps[key]);
  }
  return result;
};

const buildEmptyReport = (source: RecommendationAnalyticsSource, totalLines = 0, invalidLineCount = 0): RecommendationAnalyticsReport => {
  const emptyMap = buildDimensionMaps();
  const metadataPerformance = buildMetadataPerformance(emptyMap);
  return {
    summary: {
      dateKey: source.dateKey,
      timezone: source.timezone,
      sourceFile: source.file,
      sourceWindowStart: null,
      sourceWindowEnd: null,
      searchCount: 0,
      impressions: 0,
      selections: 0,
      checkoutCreated: 0,
      purchases: 0,
      selectionRate: 0,
      checkoutRate: 0,
      purchaseRate: 0,
      parsedLineCount: totalLines - invalidLineCount,
      invalidLineCount,
    },
    funnel: {
      impressions: 0,
      selections: 0,
      checkoutCreated: 0,
      purchases: 0,
      selectionRate: 0,
      checkoutRate: 0,
      purchaseRate: 0,
    },
    metadataPerformance,
    topConvertingStyles: [],
    topPurchasedMetadata: buildTopPurchasedMetadata(metadataPerformance),
    checkoutDropoff: [],
    lowPerformingRecommendations: [],
    selectionAnalytics: buildSelectionAnalytics([]),
    conversionAnalytics: buildConversionAnalytics(0, 0, 0, 0),
    weakMatchAnalytics: {
      queries: [],
      archetypes: [],
    },
    metadataCoverageAnalytics: {
      totalActiveCards: 0,
      cardsWithAnyIntelligence: 0,
      fieldCoverage: FIELD_COVERAGE_KEYS.map((field) => ({
        field,
        totalActiveCards: 0,
        cardsWithAnyIntelligence: 0,
        cardsWithField: 0,
        coverageRate: null,
        insufficientData: true,
      })),
      sparseFamilies: SPARSE_FAMILIES.map((family) => ({
        family,
        cardsMatched: 0,
        totalActiveCards: 0,
        coverageRate: null,
        insufficientData: true,
      })),
    },
    parserStabilityAnalytics: buildParserStabilityAnalytics([]),
    generation: {
      generatedAt: new Date().toISOString(),
      minimumLowPerformanceImpressions: DEFAULT_LOW_PERFORMANCE_IMPRESSIONS,
    },
  };
};

const buildReport = async (input: ReportBuildInput): Promise<RecommendationAnalyticsReport> => {
  if (input.parsedEvents.length === 0) {
    const activeCards = await recommendationAnalyticsRepository.findActiveGalleryCardsForCoverage();
    const emptyReport = buildEmptyReport(input.source, input.totalLines, input.invalidLineCount);
    return {
      ...emptyReport,
      metadataCoverageAnalytics: buildMetadataCoverageAnalytics(activeCards),
    };
  }

  const exposureCardIds = collectExposureCardIds(input.parsedEvents);
  const selectedCardIds = collectSelectedCardIds(input.parsedEvents);
  const orderNumbers = collectOrderNumbers(input.parsedEvents);
  const cardsById = await recommendationAnalyticsRepository.findGalleryCardsByIds([...new Set([...exposureCardIds, ...selectedCardIds])]);
  const ordersByNumber = await recommendationAnalyticsRepository.findOrdersByOrderNumbers(orderNumbers);
  const activeCards = await recommendationAnalyticsRepository.findActiveGalleryCardsForCoverage();

  const dimensionMaps = buildDimensionMaps();
  const uniqueCheckoutEvents = new Map<string, RecommendationFeedbackEvent>();
  const uniquePurchaseEvents = new Map<string, RecommendationFeedbackEvent>();
  const seenSelectionKeys = new Set<string>();
  const seenImpressionKeys = new Set<string>();
  let searchCount = 0;
  let impressions = 0;
  let selections = 0;
  let sourceWindowStart: Date | null = null;
  let sourceWindowEnd: Date | null = null;

  for (const event of input.parsedEvents) {
    const timestamp = new Date(event.timestamp);
    if (!Number.isNaN(timestamp.getTime())) {
      if (!sourceWindowStart || timestamp < sourceWindowStart) sourceWindowStart = timestamp;
      if (!sourceWindowEnd || timestamp > sourceWindowEnd) sourceWindowEnd = timestamp;
    }

    if (event.eventType === "search") {
      searchCount += 1;
      for (const exposed of event.recommendationDebugSummary?.top10AfterRerank ?? []) {
        const impressionKey = `${event.sessionId ?? "unknown"}|${event.timestamp}|${exposed.id}`;
        if (seenImpressionKeys.has(impressionKey)) continue;
        seenImpressionKeys.add(impressionKey);
        impressions += 1;
        const card = cardsById.get(exposed.id) ?? null;
        incrementDimensions(dimensionMaps, card, card?.price ?? null, "impressions");
      }
    }

    if (event.eventType === "selection" && event.selectedCardId) {
      const selectionKey = `${event.sessionId ?? "unknown"}|${event.selectedCardId}|${event.timestamp}`;
      if (seenSelectionKeys.has(selectionKey)) continue;
      seenSelectionKeys.add(selectionKey);
      selections += 1;
      const card = resolveCard(event, ordersByNumber, cardsById);
      incrementDimensions(dimensionMaps, card, card?.price ?? null, "selections");
    }

    if (event.eventType === "checkout_created" && event.orderNumber && !uniqueCheckoutEvents.has(event.orderNumber)) {
      uniqueCheckoutEvents.set(event.orderNumber, event);
    }

    if (event.eventType === "purchase_completed" && event.orderNumber && !uniquePurchaseEvents.has(event.orderNumber)) {
      uniquePurchaseEvents.set(event.orderNumber, event);
    }
  }

  for (const event of uniqueCheckoutEvents.values()) {
    const card = resolveCard(event, ordersByNumber, cardsById);
    const price = resolvePriceForStage(event, card, ordersByNumber);
    incrementDimensions(dimensionMaps, card, price, "checkoutCreated");
  }

  const matchedPurchaseEvents = Array.from(uniquePurchaseEvents.values()).filter((event) =>
    event.orderNumber ? uniqueCheckoutEvents.has(event.orderNumber) : false
  );

  for (const event of matchedPurchaseEvents) {
    const card = resolveCard(event, ordersByNumber, cardsById);
    const price = resolvePriceForStage(event, card, ordersByNumber);
    incrementDimensions(dimensionMaps, card, price, "purchases");
  }

  const checkoutCreated = uniqueCheckoutEvents.size;
  const purchases = matchedPurchaseEvents.length;
  const metadataPerformance = buildMetadataPerformance(dimensionMaps);

  return {
    summary: {
      dateKey: input.source.dateKey,
      timezone: input.source.timezone,
      sourceFile: input.source.file,
      sourceWindowStart: sourceWindowStart?.toISOString() ?? null,
      sourceWindowEnd: sourceWindowEnd?.toISOString() ?? null,
      searchCount,
      impressions,
      selections,
      checkoutCreated,
      purchases,
      selectionRate: safeRate(selections, impressions),
      checkoutRate: safeRate(checkoutCreated, selections),
      purchaseRate: safeRate(purchases, checkoutCreated),
      parsedLineCount: input.totalLines - input.invalidLineCount,
      invalidLineCount: input.invalidLineCount,
    },
    funnel: {
      impressions,
      selections,
      checkoutCreated,
      purchases,
      selectionRate: safeRate(selections, impressions),
      checkoutRate: safeRate(checkoutCreated, selections),
      purchaseRate: safeRate(purchases, checkoutCreated),
    },
    metadataPerformance,
    topConvertingStyles: buildTopConvertingStyles(metadataPerformance.style),
    topPurchasedMetadata: buildTopPurchasedMetadata(metadataPerformance),
    checkoutDropoff: buildCheckoutDropoff(metadataPerformance.title),
    lowPerformingRecommendations: buildLowPerformingRecommendations(metadataPerformance.title),
    selectionAnalytics: buildSelectionAnalytics(input.parsedEvents),
    conversionAnalytics: buildConversionAnalytics(searchCount, selections, checkoutCreated, purchases),
    weakMatchAnalytics: buildWeakMatchAnalytics(input.parsedEvents),
    metadataCoverageAnalytics: buildMetadataCoverageAnalytics(activeCards),
    parserStabilityAnalytics: buildParserStabilityAnalytics(input.parsedEvents),
    generation: {
      generatedAt: new Date().toISOString(),
      minimumLowPerformanceImpressions: DEFAULT_LOW_PERFORMANCE_IMPRESSIONS,
    },
  };
};

const resolveDateKey = (events: RecommendationFeedbackEvent[], timeZone: string): string | null => {
  const timestamps = events
    .map((event) => new Date(event.timestamp))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => right.getTime() - left.getTime());

  if (timestamps.length === 0) return null;
  return toDateKey(timestamps[0], timeZone);
};

export const recommendationAnalyticsService = {
  async loadSource(input?: {
    file?: string | null;
    date?: string | null;
    timezone?: string;
  }): Promise<RecommendationAnalyticsSource | null> {
    const timezone = input?.timezone ?? DEFAULT_TIMEZONE;
    const file = await recommendationAnalyticsRepository.resolveSourceFile(input?.file ?? null);
    if (!file) {
      return null;
    }

    const { content, parsedEvents } = await recommendationAnalyticsRepository.readFeedbackEventsFromFile(file);
    const dateKey = input?.date ?? resolveDateKey(parsedEvents, timezone) ?? toDateKey(new Date(), timezone);

    return {
      file,
      timezone,
      requestedDate: input?.date ?? null,
      dateKey,
      selectedBy: input?.file ? "explicit" : "default",
      content,
    };
  },

  async generateReport(input?: {
    file?: string | null;
    date?: string | null;
    timezone?: string;
  }): Promise<RecommendationAnalyticsReport> {
    const timezone = input?.timezone ?? DEFAULT_TIMEZONE;
    const source = await this.loadSource(input);
    if (!source) {
      return buildEmptyReport({
        file: input?.file ? path.resolve(input.file) : DEFAULT_FEEDBACK_FILE,
        timezone,
        requestedDate: input?.date ?? null,
        dateKey: input?.date ?? toDateKey(new Date(), timezone),
        selectedBy: input?.file ? "explicit" : "default",
        content: "",
      });
    }

    try {
      const { parsedEvents, totalLines, invalidLineCount } =
        await recommendationAnalyticsRepository.readFeedbackEventsFromFile(source.file);
      const filteredEvents = parsedEvents.filter((event) => {
        const date = new Date(event.timestamp);
        if (Number.isNaN(date.getTime())) {
          return false;
        }
        return toDateKey(date, source.timezone) === source.dateKey;
      });

      return await buildReport({
        source,
        parsedEvents: filteredEvents,
        totalLines,
        invalidLineCount,
      });
    } catch {
      return buildEmptyReport(source);
    }
  },

  async generateAndPersistReport(input?: {
    file?: string | null;
    date?: string | null;
    timezone?: string;
  }): Promise<RecommendationAnalyticsReport | null> {
    const source = await this.loadSource(input);
    if (!source) {
      return null;
    }

    const report = await this.generateReport(input);
    const generatedAt = new Date(report.generation.generatedAt);
    await recommendationAnalyticsRepository.upsertDailyAnalytics({
      dateKey: report.summary.dateKey,
      timezone: report.summary.timezone,
      sourceFile: report.summary.sourceFile,
      sourceWindowStart: report.summary.sourceWindowStart ? new Date(report.summary.sourceWindowStart) : null,
      sourceWindowEnd: report.summary.sourceWindowEnd ? new Date(report.summary.sourceWindowEnd) : null,
      searchCount: report.summary.searchCount,
      impressions: report.summary.impressions,
      selections: report.summary.selections,
      checkoutCreated: report.summary.checkoutCreated,
      purchases: report.summary.purchases,
      selectionRate: report.summary.selectionRate,
      checkoutRate: report.summary.checkoutRate,
      purchaseRate: report.summary.purchaseRate,
      reportPayload: JSON.parse(JSON.stringify(report)) as Prisma.InputJsonValue,
      generatedAt,
    });
    await recommendationAnalyticsRepository.createSnapshot({
      sourceFile: report.summary.sourceFile,
      timezone: report.summary.timezone,
      sourceWindowStart: report.summary.sourceWindowStart ? new Date(report.summary.sourceWindowStart) : null,
      sourceWindowEnd: report.summary.sourceWindowEnd ? new Date(report.summary.sourceWindowEnd) : null,
      summaryPayload: JSON.parse(JSON.stringify(report)) as Prisma.InputJsonValue,
      generatedAt,
    });

    return report;
  },
};
