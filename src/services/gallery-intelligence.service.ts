import path from "node:path";
import { galleryIntelligenceVisionService } from "./gallery-intelligence-vision.service";
import type {
  GalleryCharacterLayer,
  GalleryCommerceLayer,
  GalleryCommerceNaming,
  GalleryEmotionalLayer,
  GalleryIntelligenceAudit,
  GalleryMetadataIntelligence,
  GalleryVisualLayer,
  GalleryWorldbuildingLayer,
} from "../types/gallery-intelligence.types";
import type { GalleryImageMetadata } from "../utils/gallery-metadata";

type BuildGalleryIntelligenceInput = {
  imagePath: string;
  relativePath: string;
  metadata: GalleryImageMetadata;
};

type BuildGalleryIntelligenceOutput = {
  intelligence: GalleryMetadataIntelligence;
  commerceNaming: GalleryCommerceNaming;
};

const MAX_LIST_LENGTH = 12;
const MAX_PHRASE_LENGTH = 64;
const MAX_TITLE_LENGTH = 120;
const ENERGY_LEVELS = new Set(["low", "medium", "high"]);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(Math.max(value, minimum), maximum);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeAsciiWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const isGarbagePhrase = (value: string): boolean => {
  if (value.length === 0 || value.length > MAX_PHRASE_LENGTH) {
    return true;
  }
  if (!/[a-z0-9]/i.test(value)) {
    return true;
  }
  if (/[^\x00-\x7F]/.test(value)) {
    return true;
  }
  if (/^[\W_]+$/.test(value)) {
    return true;
  }
  return false;
};

const normalizeTagPhrase = (value: string): string => {
  const ascii = value.normalize("NFKD").replace(/[^\x00-\x7F]/g, " ");
  const cleaned = normalizeAsciiWhitespace(ascii.replace(/[^a-zA-Z0-9\s/-]+/g, " ").replace(/[/-]{2,}/g, "-"));
  return cleaned.toLowerCase();
};

const normalizeReadableString = (value: string, maxLength = MAX_TITLE_LENGTH): string =>
  normalizeAsciiWhitespace(value.normalize("NFKD").replace(/[^\x00-\x7F]/g, " ")).slice(0, maxLength).trim();

const dedupeStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }

  return result;
};

const normalizeTagArray = (values: string[]): { values: string[]; invalidTags: string[] } => {
  const invalidTags: string[] = [];
  const accepted: string[] = [];

  for (const raw of values) {
    const normalized = normalizeTagPhrase(raw);
    if (isGarbagePhrase(normalized)) {
      invalidTags.push(raw);
      continue;
    }
    accepted.push(normalized);
  }

  return {
    values: dedupeStrings(accepted).slice(0, MAX_LIST_LENGTH),
    invalidTags: dedupeStrings(invalidTags.map((value) => normalizeAsciiWhitespace(value)).filter(Boolean)),
  };
};

const normalizeConfidence = (value: number): number => clamp(Number.isFinite(value) ? value : 0, 0, 1);

const slugifyTitle = (value: string): string =>
  normalizeReadableString(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const normalizeVisualLayer = (
  value: Partial<GalleryVisualLayer>
): { layer: GalleryVisualLayer; invalidTags: string[] } => {
  const primaryColors = normalizeTagArray(value.primaryColors ?? []);
  const styleTags = normalizeTagArray(value.styleTags ?? []);
  const compositionTags = normalizeTagArray(value.compositionTags ?? []);
  const raritySignals = normalizeTagArray(value.raritySignals ?? []);

  return {
    layer: {
      primaryColors: primaryColors.values,
      styleTags: styleTags.values,
      compositionTags: compositionTags.values,
      subjectFocus: normalizeTagPhrase(value.subjectFocus ?? "").slice(0, MAX_PHRASE_LENGTH),
      raritySignals: raritySignals.values,
    },
    invalidTags: [
      ...primaryColors.invalidTags,
      ...styleTags.invalidTags,
      ...compositionTags.invalidTags,
      ...raritySignals.invalidTags,
    ],
  };
};

const normalizeEmotionalLayer = (
  value: Partial<GalleryEmotionalLayer>
): { layer: GalleryEmotionalLayer; invalidTags: string[] } => {
  const moodTags = normalizeTagArray(value.moodTags ?? []);
  const toneTags = normalizeTagArray(value.toneTags ?? []);
  const energyLevel = normalizeTagPhrase(value.energyLevel ?? "");

  return {
    layer: {
      moodTags: moodTags.values,
      toneTags: toneTags.values,
      energyLevel: ENERGY_LEVELS.has(energyLevel) ? (energyLevel as "low" | "medium" | "high") : "medium",
      dramaticIntensity: normalizeConfidence(typeof value.dramaticIntensity === "number" ? value.dramaticIntensity : 0),
    },
    invalidTags: [...moodTags.invalidTags, ...toneTags.invalidTags],
  };
};

const normalizeCharacterLayer = (
  value: Partial<GalleryCharacterLayer>
): { layer: GalleryCharacterLayer; invalidTags: string[] } => {
  const archetypeTags = normalizeTagArray(value.archetypeTags ?? []);
  const poseTags = normalizeTagArray(value.poseTags ?? []);

  return {
    layer: {
      entityType: normalizeTagPhrase(value.entityType ?? "").slice(0, MAX_PHRASE_LENGTH),
      genderPresentation: normalizeTagPhrase(value.genderPresentation ?? "").slice(0, MAX_PHRASE_LENGTH),
      agePresentation: normalizeTagPhrase(value.agePresentation ?? "").slice(0, MAX_PHRASE_LENGTH),
      archetypeTags: archetypeTags.values,
      poseTags: poseTags.values,
    },
    invalidTags: [...archetypeTags.invalidTags, ...poseTags.invalidTags],
  };
};

const normalizeWorldbuildingLayer = (
  value: Partial<GalleryWorldbuildingLayer>
): { layer: GalleryWorldbuildingLayer; invalidTags: string[] } => {
  const settingTags = normalizeTagArray(value.settingTags ?? []);
  const genreTags = normalizeTagArray(value.genreTags ?? []);
  const factionTags = normalizeTagArray(value.factionTags ?? []);
  const propTags = normalizeTagArray(value.propTags ?? []);
  const powerSystemTags = normalizeTagArray(value.powerSystemTags ?? []);

  return {
    layer: {
      settingTags: settingTags.values,
      genreTags: genreTags.values,
      factionTags: factionTags.values,
      propTags: propTags.values,
      powerSystemTags: powerSystemTags.values,
    },
    invalidTags: [
      ...settingTags.invalidTags,
      ...genreTags.invalidTags,
      ...factionTags.invalidTags,
      ...propTags.invalidTags,
      ...powerSystemTags.invalidTags,
    ],
  };
};

const normalizeCommerceLayer = (
  value: Partial<GalleryCommerceLayer>
): { layer: GalleryCommerceLayer; invalidTags: string[] } => {
  const searchKeywords = normalizeTagArray(value.searchKeywords ?? []);
  const collectorHooks = normalizeTagArray(value.collectorHooks ?? []);
  const marketingAngles = normalizeTagArray(value.marketingAngles ?? []);
  const audienceTags = normalizeTagArray(value.audienceTags ?? []);
  const safetyFlags = normalizeTagArray(value.safetyFlags ?? []);

  return {
    layer: {
      searchKeywords: searchKeywords.values,
      collectorHooks: collectorHooks.values,
      marketingAngles: marketingAngles.values,
      audienceTags: audienceTags.values,
      safetyFlags: safetyFlags.values,
    },
    invalidTags: [
      ...searchKeywords.invalidTags,
      ...collectorHooks.invalidTags,
      ...marketingAngles.invalidTags,
      ...audienceTags.invalidTags,
      ...safetyFlags.invalidTags,
    ],
  };
};

const buildEmptyAudit = (): GalleryIntelligenceAudit => ({
  needsHumanReview: false,
  missingFields: [],
  lowConfidenceFields: [],
  invalidTags: [],
  formatIssues: [],
  notes: [],
});

export const galleryIntelligenceService = {
  async buildCandidates(input: BuildGalleryIntelligenceInput): Promise<BuildGalleryIntelligenceOutput> {
    const raw = await galleryIntelligenceVisionService.analyzeImage(input.imagePath, input.metadata);
    const visual = normalizeVisualLayer(raw.intelligence.visualLayer);
    const emotional = normalizeEmotionalLayer(raw.intelligence.emotionalLayer);
    const character = normalizeCharacterLayer(raw.intelligence.characterLayer);
    const worldbuilding = normalizeWorldbuildingLayer(raw.intelligence.worldbuildingLayer);
    const commerce = normalizeCommerceLayer(raw.intelligence.commerceLayer);

    const displayTitle = normalizeReadableString(raw.commerceNaming.displayTitle);
    const shopifyTitle = normalizeReadableString(raw.commerceNaming.shopifyTitle);
    const shortName = normalizeReadableString(raw.commerceNaming.shortName, 80);
    const normalizedSlug = slugifyTitle(raw.commerceNaming.slug || displayTitle);

    const confidenceInputs = [
      normalizeConfidence(raw.intelligence.confidence),
      normalizeConfidence(raw.commerceNaming.confidence),
      visual.layer.primaryColors.length > 0 ? 1 : 0.5,
      commerce.layer.searchKeywords.length > 0 ? 1 : 0.5,
    ];

    const averageConfidence =
      confidenceInputs.reduce((sum, value) => sum + value, 0) / Math.max(confidenceInputs.length, 1);

    const intelligence: GalleryMetadataIntelligence = {
      intelligenceVersion: "v1",
      confidence: normalizeConfidence(averageConfidence),
      visualLayer: visual.layer,
      emotionalLayer: emotional.layer,
      characterLayer: character.layer,
      worldbuildingLayer: worldbuilding.layer,
      commerceLayer: commerce.layer,
      audit: buildEmptyAudit(),
    };

    const commerceNaming: GalleryCommerceNaming = {
      displayTitle,
      shopifyTitle,
      shortName,
      slug: SLUG_PATTERN.test(normalizedSlug) ? normalizedSlug : slugifyTitle(displayTitle),
      namingVersion: "v1",
      confidence: normalizeConfidence(raw.commerceNaming.confidence),
      source: "vision-intelligence-v1",
    };

    const invalidTags = dedupeStrings(
      [
        ...visual.invalidTags,
        ...emotional.invalidTags,
        ...character.invalidTags,
        ...worldbuilding.invalidTags,
        ...commerce.invalidTags,
      ].filter(Boolean)
    );

    intelligence.audit = {
      ...intelligence.audit,
      invalidTags,
      notes: [`generated from ${path.basename(input.imagePath)} with image-first grounding`],
    };

    return {
      intelligence,
      commerceNaming,
    };
  },

  isMetadataObject(value: unknown): value is Record<string, unknown> {
    return isPlainObject(value);
  },
};
