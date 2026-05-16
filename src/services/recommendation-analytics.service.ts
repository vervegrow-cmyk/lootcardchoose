import { Prisma } from "@prisma/client";
import type {
  RecommendationAnalyticsCardPerformance,
  RecommendationAnalyticsCheckoutDropoffItem,
  RecommendationAnalyticsDimensionBucket,
  RecommendationAnalyticsDimensionKey,
  RecommendationAnalyticsMetadataPerformance,
  RecommendationAnalyticsReport,
  RecommendationAnalyticsSource,
  RecommendationAnalyticsTopPurchasedMetadata,
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
const DIMENSION_KEYS: RecommendationAnalyticsDimensionKey[] = [
  "rarity",
  "style",
  "character",
  "color",
  "title",
  "priceTier",
];

type AnalyticsCounter = {
  impressions: number;
  selections: number;
  checkoutCreated: number;
  purchases: number;
};

type DimensionCounterMap = Map<string, AnalyticsCounter>;

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

const toDateKey = (date: Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const toNumber = (value: string | number | null | undefined): number | null => {
  if (value == null || value === "") {
    return null;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeBucket = (value: string | null | undefined): string => {
  const normalized = value?.trim();
  return normalized || "unknown";
};

const resolvePriceTier = (value: number | null): string => {
  if (value == null) {
    return "unknown";
  }
  if (value < 10) {
    return "<10";
  }
  if (value < 20) {
    return "10-19.99";
  }
  if (value < 30) {
    return "20-29.99";
  }
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

const sortDimensionBuckets = (buckets: RecommendationAnalyticsDimensionBucket[]): RecommendationAnalyticsDimensionBucket[] =>
  [...buckets].sort((left, right) => {
    if (right.purchases !== left.purchases) {
      return right.purchases - left.purchases;
    }
    if (right.checkoutCreated !== left.checkoutCreated) {
      return right.checkoutCreated - left.checkoutCreated;
    }
    if (right.selections !== left.selections) {
      return right.selections - left.selections;
    }
    if (right.impressions !== left.impressions) {
      return right.impressions - left.impressions;
    }
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
});

const collectExposureCardIds = (events: RecommendationFeedbackEvent[]): string[] => {
  const cardIds = new Set<string>();
  for (const event of events) {
    if (event.eventType !== "search") {
      continue;
    }
    for (const item of event.recommendationDebugSummary?.top10AfterRerank ?? []) {
      if (item.id) {
        cardIds.add(item.id);
      }
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
    const orderAmount = toNumber(order?.amount);
    if (orderAmount != null) {
      return orderAmount;
    }
  }
  return card ? card.price : null;
};

const incrementDimensions = (
  dimensionMaps: Record<RecommendationAnalyticsDimensionKey, DimensionCounterMap>,
  card: RecommendationAnalyticsGalleryRecord | null,
  price: number | null,
  field: keyof AnalyticsCounter
): void => {
  const rarityBucket = normalizeBucket(card?.rarity);
  const styleBucket = normalizeBucket(card?.style);
  const characterBucket = normalizeBucket(card?.character);
  const colorBucket = normalizeBucket(card?.color);
  const titleBucket = normalizeBucket(card?.title);
  const priceTierBucket = resolvePriceTier(price);

  incrementCounter(getCounter(dimensionMaps.rarity, rarityBucket), field);
  incrementCounter(getCounter(dimensionMaps.style, styleBucket), field);
  incrementCounter(getCounter(dimensionMaps.character, characterBucket), field);
  incrementCounter(getCounter(dimensionMaps.color, colorBucket), field);
  incrementCounter(getCounter(dimensionMaps.title, titleBucket), field);
  incrementCounter(getCounter(dimensionMaps.priceTier, priceTierBucket), field);
};

const buildTopPurchasedMetadata = (
  metadataPerformance: RecommendationAnalyticsMetadataPerformance
): RecommendationAnalyticsTopPurchasedMetadata => ({
  rarity: metadataPerformance.rarity.filter((item) => item.purchases > 0).slice(0, 5),
  style: metadataPerformance.style.filter((item) => item.purchases > 0).slice(0, 5),
  character: metadataPerformance.character.filter((item) => item.purchases > 0).slice(0, 5),
  color: metadataPerformance.color.filter((item) => item.purchases > 0).slice(0, 5),
  title: metadataPerformance.title.filter((item) => item.purchases > 0).slice(0, 5),
  priceTier: metadataPerformance.priceTier.filter((item) => item.purchases > 0).slice(0, 5),
});

const buildTopConvertingStyles = (
  styleBuckets: RecommendationAnalyticsDimensionBucket[]
): RecommendationAnalyticsDimensionBucket[] =>
  [...styleBuckets]
    .filter((item) => item.impressions >= DEFAULT_LOW_PERFORMANCE_IMPRESSIONS && item.checkoutCreated > 0)
    .sort((left, right) => {
      if (right.purchaseRate !== left.purchaseRate) {
        return right.purchaseRate - left.purchaseRate;
      }
      if (right.purchases !== left.purchases) {
        return right.purchases - left.purchases;
      }
      return right.impressions - left.impressions;
    })
    .slice(0, 5);

const buildCheckoutDropoff = (
  titleBuckets: RecommendationAnalyticsDimensionBucket[]
): RecommendationAnalyticsCheckoutDropoffItem[] =>
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
      if (right.dropoffCount !== left.dropoffCount) {
        return right.dropoffCount - left.dropoffCount;
      }
      return right.dropoffRate - left.dropoffRate;
    })
    .slice(0, DEFAULT_TOP_LIMIT);

const buildLowPerformingRecommendations = (
  titleBuckets: RecommendationAnalyticsDimensionBucket[]
): RecommendationAnalyticsCardPerformance[] =>
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
      if (left.purchaseRate !== right.purchaseRate) {
        return left.purchaseRate - right.purchaseRate;
      }
      if (left.selectionRate !== right.selectionRate) {
        return left.selectionRate - right.selectionRate;
      }
      return right.impressions - left.impressions;
    })
    .slice(0, DEFAULT_TOP_LIMIT);

const buildReport = async (input: ReportBuildInput): Promise<RecommendationAnalyticsReport> => {
  const exposureCardIds = collectExposureCardIds(input.parsedEvents);
  const selectedCardIds = collectSelectedCardIds(input.parsedEvents);
  const orderNumbers = collectOrderNumbers(input.parsedEvents);
  const cardsById = await recommendationAnalyticsRepository.findGalleryCardsByIds([
    ...new Set([...exposureCardIds, ...selectedCardIds]),
  ]);
  const ordersByNumber = await recommendationAnalyticsRepository.findOrdersByOrderNumbers(orderNumbers);

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
      if (!sourceWindowStart || timestamp < sourceWindowStart) {
        sourceWindowStart = timestamp;
      }
      if (!sourceWindowEnd || timestamp > sourceWindowEnd) {
        sourceWindowEnd = timestamp;
      }
    }

    if (event.eventType === "search") {
      searchCount += 1;
      for (const exposed of event.recommendationDebugSummary?.top10AfterRerank ?? []) {
        const impressionKey = `${event.sessionId ?? "unknown"}|${event.timestamp}|${exposed.id}`;
        if (seenImpressionKeys.has(impressionKey)) {
          continue;
        }
        seenImpressionKeys.add(impressionKey);
        impressions += 1;
        const card = cardsById.get(exposed.id) ?? null;
        incrementDimensions(dimensionMaps, card, card?.price ?? null, "impressions");
      }
    }

    if (event.eventType === "selection" && event.selectedCardId) {
      const selectionKey = `${event.sessionId ?? "unknown"}|${event.selectedCardId}|${event.timestamp}`;
      if (seenSelectionKeys.has(selectionKey)) {
        continue;
      }
      seenSelectionKeys.add(selectionKey);
      selections += 1;
      const card = resolveCard(event, ordersByNumber, cardsById);
      incrementDimensions(dimensionMaps, card, card?.price ?? null, "selections");
    }

    if (event.eventType === "checkout_created" && event.orderNumber) {
      if (!uniqueCheckoutEvents.has(event.orderNumber)) {
        uniqueCheckoutEvents.set(event.orderNumber, event);
      }
    }

    if (event.eventType === "purchase_completed" && event.orderNumber) {
      if (!uniquePurchaseEvents.has(event.orderNumber)) {
        uniquePurchaseEvents.set(event.orderNumber, event);
      }
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

  const metadataPerformance: RecommendationAnalyticsMetadataPerformance = {
    rarity: toDimensionBuckets(dimensionMaps.rarity),
    style: toDimensionBuckets(dimensionMaps.style),
    character: toDimensionBuckets(dimensionMaps.character),
    color: toDimensionBuckets(dimensionMaps.color),
    title: toDimensionBuckets(dimensionMaps.title),
    priceTier: toDimensionBuckets(dimensionMaps.priceTier),
  };

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

  if (timestamps.length === 0) {
    return null;
  }

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
  async generateAndPersistReport(input?: {
    file?: string | null;
    date?: string | null;
    timezone?: string;
  }): Promise<RecommendationAnalyticsReport | null> {
    const source = await this.loadSource(input);
    if (!source) {
      return null;
    }

    const { parsedEvents, totalLines, invalidLineCount } =
      await recommendationAnalyticsRepository.readFeedbackEventsFromFile(source.file);
    const filteredEvents = parsedEvents.filter((event) => {
      const date = new Date(event.timestamp);
      if (Number.isNaN(date.getTime())) {
        return false;
      }
      return toDateKey(date, source.timezone) === source.dateKey;
    });

    const report = await buildReport({
      source,
      parsedEvents: filteredEvents,
      totalLines,
      invalidLineCount,
    });

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
