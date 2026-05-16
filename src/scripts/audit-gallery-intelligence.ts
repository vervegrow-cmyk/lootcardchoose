import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import { Prisma } from "@prisma/client";
import { prisma } from "../services/prisma.service";

type GalleryCardAuditRecord = {
  id: string;
  title: string;
  rarity: string | null;
  price: Prisma.Decimal;
  updatedAt: Date;
  metadata: Prisma.JsonValue | null;
};

type DistributionEntry = {
  value: string;
  count: number;
};

type SampleFinding = {
  id: string;
  title: string;
  intelligenceVersion: string | null;
  hasFiveLayers: boolean;
  hasLegacyCompatibility: boolean;
  visualStyle: string[];
  mood: string[];
  characterType: string[];
  pricingTier: string | null;
  issues: string[];
};

type AuditReport = {
  totalCards: number;
  cardsWithMetadataObject: number;
  cardsWithIntelligence: number;
  sampledCount: number;
  fiveLayerCompletenessRate: string;
  intelligenceVersionV1Rate: string;
  visualStyleDistribution: DistributionEntry[];
  moodDistribution: DistributionEntry[];
  characterTypeDistribution: DistributionEntry[];
  pricingTierDistribution: DistributionEntry[];
  schemaDriftDetected: boolean;
  legacyCompatibilityMissingDetected: boolean;
  issueSummary: DistributionEntry[];
  sampleFindings: SampleFinding[];
  phase2Recommendation: "yes" | "no";
};

type AggregateState = {
  totalCards: number;
  cardsWithMetadataObject: number;
  cardsWithIntelligence: number;
  fiveLayerCompleteCards: number;
  intelligenceVersionV1Cards: number;
  schemaDriftDetected: boolean;
  legacyCompatibilityMissingDetected: boolean;
  issueCounts: Map<string, number>;
  visualStyleCounts: Map<string, number>;
  moodCounts: Map<string, number>;
  characterTypeCounts: Map<string, number>;
  pricingTierCounts: Map<string, number>;
};

const BATCH_SIZE = 100;
const SAMPLE_SIZE = 20;
const REQUIRED_V1_ARRAY_TYPE_FIELDS = [
  "visualLayer.visualStyle",
  "visualLayer.colorPalette",
  "visualLayer.artStyle",
  "emotionalLayer.mood",
  "emotionalLayer.atmosphere",
  "characterLayer.characterType",
  "characterLayer.roleArchetype",
  "worldbuildingLayer.universe",
  "worldbuildingLayer.theme",
  "worldbuildingLayer.faction",
] as const;
const EMPTY_ARRAY_DRIFT_FIELDS: readonly string[] = [];
const PRICING_TIERS = new Set(["budget", "standard", "premium", "collector"]);
const FIVE_LAYER_KEYS = [
  "visualLayer",
  "emotionalLayer",
  "characterLayer",
  "worldbuildingLayer",
  "commerceLayer",
] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const increment = (map: Map<string, number>, key: string): void => {
  map.set(key, (map.get(key) ?? 0) + 1);
};

const toSortedDistribution = (map: Map<string, number>): DistributionEntry[] =>
  [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));

const formatRate = (matched: number, total: number): string =>
  total === 0 ? "0.00%" : `${((matched / total) * 100).toFixed(2)}%`;

const getNested = (value: Record<string, unknown>, path: string[]): unknown => {
  let current: unknown = value;
  for (const segment of path) {
    if (!isPlainObject(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
};

const collectStringValues = (map: Map<string, number>, values: unknown): void => {
  if (!isStringArray(values)) {
    return;
  }
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    increment(map, trimmed);
  }
};

const createInitialState = (): AggregateState => ({
  totalCards: 0,
  cardsWithMetadataObject: 0,
  cardsWithIntelligence: 0,
  fiveLayerCompleteCards: 0,
  intelligenceVersionV1Cards: 0,
  schemaDriftDetected: false,
  legacyCompatibilityMissingDetected: false,
  issueCounts: new Map<string, number>(),
  visualStyleCounts: new Map<string, number>(),
  moodCounts: new Map<string, number>(),
  characterTypeCounts: new Map<string, number>(),
  pricingTierCounts: new Map<string, number>(),
});

const readIssuesForCard = (
  card: GalleryCardAuditRecord
): {
  metadataObject: Record<string, unknown> | null;
  intelligenceObject: Record<string, unknown> | null;
  issues: string[];
  hasFiveLayers: boolean;
  hasLegacyCompatibility: boolean;
  intelligenceVersion: string | null;
  visualStyle: string[];
  mood: string[];
  characterType: string[];
  pricingTier: string | null;
} => {
  const issues: string[] = [];
  const metadataObject = isPlainObject(card.metadata) ? card.metadata : null;

  if (metadataObject == null) {
    issues.push("metadata_not_object");
    return {
      metadataObject: null,
      intelligenceObject: null,
      issues,
      hasFiveLayers: false,
      hasLegacyCompatibility: false,
      intelligenceVersion: null,
      visualStyle: [],
      mood: [],
      characterType: [],
      pricingTier: null,
    };
  }

  const commerceNaming = metadataObject.commerceNaming;
  const intelligenceObject = isPlainObject(metadataObject.intelligence) ? metadataObject.intelligence : null;

  if (commerceNaming !== undefined && intelligenceObject == null) {
    issues.push("commerceNaming_without_intelligence");
  }
  if (intelligenceObject == null) {
    issues.push("missing_intelligence");
    return {
      metadataObject,
      intelligenceObject: null,
      issues,
      hasFiveLayers: false,
      hasLegacyCompatibility: false,
      intelligenceVersion: null,
      visualStyle: [],
      mood: [],
      characterType: [],
      pricingTier: null,
    };
  }

  const intelligenceVersion =
    typeof intelligenceObject.intelligenceVersion === "string" ? intelligenceObject.intelligenceVersion : null;
  if (intelligenceVersion !== "v1") {
    issues.push("intelligence_version_not_v1");
  }

  let hasFiveLayers = true;
  for (const key of FIVE_LAYER_KEYS) {
    if (!isPlainObject(intelligenceObject[key])) {
      hasFiveLayers = false;
      issues.push(`missing_layer:${key}`);
    }
  }

  const visualLayer = isPlainObject(intelligenceObject.visualLayer) ? intelligenceObject.visualLayer : null;
  const emotionalLayer = isPlainObject(intelligenceObject.emotionalLayer) ? intelligenceObject.emotionalLayer : null;
  const characterLayer = isPlainObject(intelligenceObject.characterLayer) ? intelligenceObject.characterLayer : null;
  const worldbuildingLayer = isPlainObject(intelligenceObject.worldbuildingLayer)
    ? intelligenceObject.worldbuildingLayer
    : null;
  const commerceLayer = isPlainObject(intelligenceObject.commerceLayer) ? intelligenceObject.commerceLayer : null;

  const validateRequiredArray = (container: Record<string, unknown> | null, fieldName: string): string[] => {
    if (container == null) {
      return [];
    }
    const value = container[fieldName];
    if (!isStringArray(value)) {
      issues.push(`invalid_array:${fieldName}`);
      return [];
    }
    return value;
  };

  const visualStyle = validateRequiredArray(visualLayer, "visualStyle");
  const colorPalette = validateRequiredArray(visualLayer, "colorPalette");
  const artStyle = validateRequiredArray(visualLayer, "artStyle");
  const mood = validateRequiredArray(emotionalLayer, "mood");
  const atmosphere = validateRequiredArray(emotionalLayer, "atmosphere");
  const characterType = validateRequiredArray(characterLayer, "characterType");
  const roleArchetype = validateRequiredArray(characterLayer, "roleArchetype");
  const universe = validateRequiredArray(worldbuildingLayer, "universe");
  const theme = validateRequiredArray(worldbuildingLayer, "theme");
  const faction = validateRequiredArray(worldbuildingLayer, "faction");

  void colorPalette;
  void artStyle;
  void atmosphere;
  void roleArchetype;
  void universe;
  void theme;
  void faction;

  if (characterLayer != null && characterLayer.genderPresentation !== undefined && typeof characterLayer.genderPresentation !== "string") {
    issues.push("invalid_genderPresentation");
  }

  let pricingTier: string | null = null;
  if (commerceLayer == null) {
    issues.push("missing_layer:commerceLayer");
  } else {
    pricingTier = typeof commerceLayer.pricingTier === "string" ? commerceLayer.pricingTier : null;
    if (pricingTier == null || !PRICING_TIERS.has(pricingTier)) {
      issues.push("invalid_pricingTier");
    }

    for (const field of ["collectorScore", "waifuScore", "battleScore"] as const) {
      const value = commerceLayer[field];
      if (!isFiniteNumber(value) || value < 0 || value > 100) {
        issues.push(`invalid_score:${field}`);
      }
    }

    if (commerceLayer.rarity !== undefined && typeof commerceLayer.rarity !== "string") {
      issues.push("invalid_rarity");
    }
  }

  const legacyChecks: Array<[string, unknown, "string" | "stringArray" | "number"]> = [
    ["visualLayer.primaryColors", visualLayer?.primaryColors, "stringArray"],
    ["visualLayer.styleTags", visualLayer?.styleTags, "stringArray"],
    ["visualLayer.compositionTags", visualLayer?.compositionTags, "stringArray"],
    ["visualLayer.subjectFocus", visualLayer?.subjectFocus, "string"],
    ["visualLayer.raritySignals", visualLayer?.raritySignals, "stringArray"],
    ["emotionalLayer.moodTags", emotionalLayer?.moodTags, "stringArray"],
    ["emotionalLayer.toneTags", emotionalLayer?.toneTags, "stringArray"],
    ["emotionalLayer.energyLevel", emotionalLayer?.energyLevel, "string"],
    ["emotionalLayer.dramaticIntensity", emotionalLayer?.dramaticIntensity, "number"],
    ["characterLayer.entityType", characterLayer?.entityType, "string"],
    ["characterLayer.agePresentation", characterLayer?.agePresentation, "string"],
    ["characterLayer.archetypeTags", characterLayer?.archetypeTags, "stringArray"],
    ["characterLayer.poseTags", characterLayer?.poseTags, "stringArray"],
    ["worldbuildingLayer.settingTags", worldbuildingLayer?.settingTags, "stringArray"],
    ["worldbuildingLayer.genreTags", worldbuildingLayer?.genreTags, "stringArray"],
    ["worldbuildingLayer.factionTags", worldbuildingLayer?.factionTags, "stringArray"],
    ["worldbuildingLayer.propTags", worldbuildingLayer?.propTags, "stringArray"],
    ["worldbuildingLayer.powerSystemTags", worldbuildingLayer?.powerSystemTags, "stringArray"],
    ["commerceLayer.searchKeywords", commerceLayer?.searchKeywords, "stringArray"],
    ["commerceLayer.collectorHooks", commerceLayer?.collectorHooks, "stringArray"],
    ["commerceLayer.marketingAngles", commerceLayer?.marketingAngles, "stringArray"],
    ["commerceLayer.audienceTags", commerceLayer?.audienceTags, "stringArray"],
    ["commerceLayer.safetyFlags", commerceLayer?.safetyFlags, "stringArray"],
  ];

  let hasLegacyCompatibility = true;
  for (const [field, value, type] of legacyChecks) {
    const valid =
      type === "string"
        ? typeof value === "string"
        : type === "number"
          ? isFiniteNumber(value)
          : isStringArray(value);
    if (!valid) {
      hasLegacyCompatibility = false;
      issues.push(`missing_legacy:${field}`);
    }
  }

  return {
    metadataObject,
    intelligenceObject,
    issues,
    hasFiveLayers,
    hasLegacyCompatibility,
    intelligenceVersion,
    visualStyle,
    mood,
    characterType,
    pricingTier,
  };
};

const buildSampleIndices = (count: number): number[] => {
  if (count <= SAMPLE_SIZE) {
    return Array.from({ length: count }, (_, index) => index);
  }

  const selected = new Set<number>();
  for (let index = 0; index < Math.min(5, count); index += 1) {
    selected.add(index);
  }
  for (let index = Math.max(0, count - 5); index < count; index += 1) {
    selected.add(index);
  }

  const middleStart = 5;
  const middleEnd = count - 5;
  const middleLength = Math.max(0, middleEnd - middleStart);

  if (middleLength > 0) {
    for (let slot = 0; slot < 10; slot += 1) {
      const offset = Math.floor(((slot + 0.5) * middleLength) / 10);
      const candidate = Math.min(middleEnd - 1, middleStart + offset);
      if (candidate >= middleStart && candidate < middleEnd) {
        selected.add(candidate);
      }
    }

    for (let candidate = middleStart; selected.size < SAMPLE_SIZE && candidate < middleEnd; candidate += 1) {
      selected.add(candidate);
    }
  }

  return [...selected].sort((left, right) => left - right).slice(0, SAMPLE_SIZE);
};

const loadAllCards = async (): Promise<GalleryCardAuditRecord[]> => {
  const records: GalleryCardAuditRecord[] = [];
  let cursorId: string | undefined;

  while (true) {
    const batch = await prisma.galleryCard.findMany({
      select: {
        id: true,
        title: true,
        rarity: true,
        price: true,
        updatedAt: true,
        metadata: true,
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: BATCH_SIZE,
      ...(cursorId
        ? {
            cursor: { id: cursorId },
            skip: 1,
          }
        : {}),
    });

    if (batch.length === 0) {
      break;
    }

    records.push(...(batch as GalleryCardAuditRecord[]));
    cursorId = batch[batch.length - 1]?.id;
  }

  records.sort((left, right) => {
    const dateDiff = right.updatedAt.getTime() - left.updatedAt.getTime();
    if (dateDiff !== 0) {
      return dateDiff;
    }
    return left.id.localeCompare(right.id);
  });

  return records;
};

const main = async (): Promise<void> => {
  try {
    const cards = await loadAllCards();
    const state = createInitialState();
    const cardAnalyses = new Map<string, ReturnType<typeof readIssuesForCard>>();

    for (const card of cards) {
      state.totalCards += 1;
      if (isPlainObject(card.metadata)) {
        state.cardsWithMetadataObject += 1;
      }

      const analysis = readIssuesForCard(card);
      cardAnalyses.set(card.id, analysis);

      if (analysis.intelligenceObject != null) {
        state.cardsWithIntelligence += 1;
        collectStringValues(state.visualStyleCounts, analysis.visualStyle);
        collectStringValues(state.moodCounts, analysis.mood);
        collectStringValues(state.characterTypeCounts, analysis.characterType);
        if (analysis.pricingTier) {
          increment(state.pricingTierCounts, analysis.pricingTier);
        }
      }

      if (analysis.hasFiveLayers) {
        state.fiveLayerCompleteCards += 1;
      }
      if (analysis.intelligenceVersion === "v1") {
        state.intelligenceVersionV1Cards += 1;
      }
      if (!analysis.hasLegacyCompatibility) {
        state.legacyCompatibilityMissingDetected = true;
      }
      if (analysis.issues.length > 0) {
        state.schemaDriftDetected = true;
      }
      for (const issue of analysis.issues) {
        increment(state.issueCounts, issue);
      }
    }

    void REQUIRED_V1_ARRAY_TYPE_FIELDS;
    void EMPTY_ARRAY_DRIFT_FIELDS;

    const sampleIndices = buildSampleIndices(cards.length);
    const sampleFindings: SampleFinding[] = sampleIndices.map((index) => {
      const card = cards[index]!;
      const analysis = cardAnalyses.get(card.id)!;
      return {
        id: card.id,
        title: card.title,
        intelligenceVersion: analysis.intelligenceVersion,
        hasFiveLayers: analysis.hasFiveLayers,
        hasLegacyCompatibility: analysis.hasLegacyCompatibility,
        visualStyle: analysis.visualStyle,
        mood: analysis.mood,
        characterType: analysis.characterType,
        pricingTier: analysis.pricingTier,
        issues: analysis.issues,
      };
    });

    const phase2Recommendation: "yes" | "no" =
      state.cardsWithIntelligence === state.totalCards &&
      state.intelligenceVersionV1Cards === state.totalCards &&
      state.totalCards > 0 &&
      state.fiveLayerCompleteCards / state.totalCards >= 0.95 &&
      state.schemaDriftDetected === false &&
      state.legacyCompatibilityMissingDetected === false
        ? "yes"
        : "no";

    const report: AuditReport = {
      totalCards: state.totalCards,
      cardsWithMetadataObject: state.cardsWithMetadataObject,
      cardsWithIntelligence: state.cardsWithIntelligence,
      sampledCount: sampleFindings.length,
      fiveLayerCompletenessRate: formatRate(state.fiveLayerCompleteCards, state.totalCards),
      intelligenceVersionV1Rate: formatRate(state.intelligenceVersionV1Cards, state.totalCards),
      visualStyleDistribution: toSortedDistribution(state.visualStyleCounts),
      moodDistribution: toSortedDistribution(state.moodCounts),
      characterTypeDistribution: toSortedDistribution(state.characterTypeCounts),
      pricingTierDistribution: toSortedDistribution(state.pricingTierCounts),
      schemaDriftDetected: state.schemaDriftDetected,
      legacyCompatibilityMissingDetected: state.legacyCompatibilityMissingDetected,
      issueSummary: toSortedDistribution(state.issueCounts),
      sampleFindings,
      phase2Recommendation,
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error) => {
  console.error("[GALLERY AUDIT INTELLIGENCE] fatal error", error);
  process.exit(1);
});
