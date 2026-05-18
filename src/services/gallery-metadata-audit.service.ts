import type {
  GalleryCommerceNaming,
  GalleryEnergyLevel,
  GalleryIntelligenceAudit,
  GalleryMetadataAuditResult,
  GalleryMetadataIntelligence,
} from "../types/gallery-intelligence.types";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ENERGY_LEVELS = new Set<GalleryEnergyLevel>(["low", "medium", "high"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

const uniqueStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
};

const buildAudit = (
  missingFields: string[],
  lowConfidenceFields: string[],
  invalidTags: string[],
  formatIssues: string[],
  notes: string[]
): GalleryIntelligenceAudit => ({
  needsHumanReview:
    missingFields.length > 0 || lowConfidenceFields.length > 0 || invalidTags.length > 0 || formatIssues.length > 0,
  missingFields: uniqueStrings(missingFields),
  lowConfidenceFields: uniqueStrings(lowConfidenceFields),
  invalidTags: uniqueStrings(invalidTags),
  formatIssues: uniqueStrings(formatIssues),
  notes: uniqueStrings(notes),
});

const createEmptyIntelligence = (): GalleryMetadataIntelligence => ({
  intelligenceVersion: "v1",
  confidence: 0,
  visualLayer: {
    visualStyle: [],
    colorPalette: [],
    artStyle: [],
    primaryColors: [],
    styleTags: [],
    compositionTags: [],
    subjectFocus: "",
    raritySignals: [],
  },
  emotionalLayer: {
    mood: [],
    atmosphere: [],
    moodTags: [],
    toneTags: [],
    energyLevel: "medium",
    dramaticIntensity: 0,
  },
  characterLayer: {
    characterType: [],
    entityType: "",
    genderPresentation: "",
    agePresentation: "",
    roleArchetype: [],
    archetypeTags: [],
    poseTags: [],
  },
  worldbuildingLayer: {
    universe: [],
    theme: [],
    faction: [],
    settingTags: [],
    genreTags: [],
    factionTags: [],
    propTags: [],
    powerSystemTags: [],
  },
  commerceLayer: {
    pricingTier: "budget",
    collectorScore: 0,
    waifuScore: 0,
    battleScore: 0,
    searchKeywords: [],
    collectorHooks: [],
    marketingAngles: [],
    audienceTags: [],
    safetyFlags: [],
  },
  audit: {
    needsHumanReview: false,
    missingFields: [],
    lowConfidenceFields: [],
    invalidTags: [],
    formatIssues: [],
    notes: [],
  },
});

type AuditInput = {
  intelligence?: GalleryMetadataIntelligence | null;
  commerceNaming?: GalleryCommerceNaming | null;
};

const collectTagIssues = (
  values: unknown,
  field: string,
  invalidTags: string[],
  formatIssues: string[]
): void => {
  if (!Array.isArray(values)) {
    formatIssues.push(`${field} must be a string array`);
    return;
  }

  for (const value of values) {
    if (typeof value !== "string") {
      formatIssues.push(`${field} contains non-string items`);
      continue;
    }
    if (!value.trim()) {
      invalidTags.push(`${field}:<empty>`);
      continue;
    }
    if (/[^\x00-\x7F]/.test(value) || value.length > 64) {
      invalidTags.push(`${field}:${value}`);
    }
  }
};

export const galleryMetadataAuditService = {
  audit(input: AuditInput): GalleryMetadataAuditResult {
    const missingFields: string[] = [];
    const lowConfidenceFields: string[] = [];
    const invalidTags: string[] = [];
    const formatIssues: string[] = [];
    const notes: string[] = [];

    const intelligence = input.intelligence ?? createEmptyIntelligence();
    const commerceNaming = input.commerceNaming ?? null;

    if (!input.intelligence) {
      missingFields.push("metadata.intelligence");
      notes.push("metadata.intelligence is missing");
    }

    const requiredLayers: Array<[string, unknown]> = [
      ["metadata.intelligence.visualLayer", intelligence.visualLayer],
      ["metadata.intelligence.emotionalLayer", intelligence.emotionalLayer],
      ["metadata.intelligence.characterLayer", intelligence.characterLayer],
      ["metadata.intelligence.worldbuildingLayer", intelligence.worldbuildingLayer],
      ["metadata.intelligence.commerceLayer", intelligence.commerceLayer],
    ];

    for (const [field, value] of requiredLayers) {
      if (!isPlainObject(value)) {
        missingFields.push(field);
      }
    }

    if (intelligence.confidence < 0.6) {
      lowConfidenceFields.push("metadata.intelligence.confidence");
    }

    collectTagIssues(intelligence.visualLayer.primaryColors, "visualLayer.primaryColors", invalidTags, formatIssues);
    collectTagIssues(intelligence.visualLayer.styleTags, "visualLayer.styleTags", invalidTags, formatIssues);
    collectTagIssues(
      intelligence.visualLayer.compositionTags,
      "visualLayer.compositionTags",
      invalidTags,
      formatIssues
    );
    collectTagIssues(intelligence.visualLayer.raritySignals, "visualLayer.raritySignals", invalidTags, formatIssues);
    collectTagIssues(intelligence.emotionalLayer.moodTags, "emotionalLayer.moodTags", invalidTags, formatIssues);
    collectTagIssues(intelligence.emotionalLayer.toneTags, "emotionalLayer.toneTags", invalidTags, formatIssues);
    collectTagIssues(intelligence.characterLayer.archetypeTags, "characterLayer.archetypeTags", invalidTags, formatIssues);
    collectTagIssues(intelligence.characterLayer.poseTags, "characterLayer.poseTags", invalidTags, formatIssues);
    collectTagIssues(
      intelligence.worldbuildingLayer.settingTags,
      "worldbuildingLayer.settingTags",
      invalidTags,
      formatIssues
    );
    collectTagIssues(intelligence.worldbuildingLayer.genreTags, "worldbuildingLayer.genreTags", invalidTags, formatIssues);
    collectTagIssues(
      intelligence.worldbuildingLayer.factionTags,
      "worldbuildingLayer.factionTags",
      invalidTags,
      formatIssues
    );
    collectTagIssues(intelligence.worldbuildingLayer.propTags, "worldbuildingLayer.propTags", invalidTags, formatIssues);
    collectTagIssues(
      intelligence.worldbuildingLayer.powerSystemTags,
      "worldbuildingLayer.powerSystemTags",
      invalidTags,
      formatIssues
    );
    collectTagIssues(
      intelligence.commerceLayer.searchKeywords,
      "commerceLayer.searchKeywords",
      invalidTags,
      formatIssues
    );
    collectTagIssues(
      intelligence.commerceLayer.collectorHooks,
      "commerceLayer.collectorHooks",
      invalidTags,
      formatIssues
    );
    collectTagIssues(
      intelligence.commerceLayer.marketingAngles,
      "commerceLayer.marketingAngles",
      invalidTags,
      formatIssues
    );
    collectTagIssues(intelligence.commerceLayer.audienceTags, "commerceLayer.audienceTags", invalidTags, formatIssues);
    collectTagIssues(intelligence.commerceLayer.safetyFlags, "commerceLayer.safetyFlags", invalidTags, formatIssues);

    if (!ENERGY_LEVELS.has(intelligence.emotionalLayer.energyLevel)) {
      formatIssues.push("emotionalLayer.energyLevel must be low, medium, or high");
    }
    if (
      typeof intelligence.emotionalLayer.dramaticIntensity !== "number" ||
      Number.isNaN(intelligence.emotionalLayer.dramaticIntensity) ||
      intelligence.emotionalLayer.dramaticIntensity < 0 ||
      intelligence.emotionalLayer.dramaticIntensity > 1
    ) {
      formatIssues.push("emotionalLayer.dramaticIntensity must be between 0 and 1");
    }

    if (!commerceNaming) {
      missingFields.push("metadata.commerceNaming");
      notes.push("metadata.commerceNaming is missing");
    } else {
      if (!commerceNaming.displayTitle.trim()) {
        missingFields.push("metadata.commerceNaming.displayTitle");
      }
      if (!commerceNaming.shopifyTitle.trim()) {
        missingFields.push("metadata.commerceNaming.shopifyTitle");
      }
      if (!commerceNaming.slug.trim()) {
        missingFields.push("metadata.commerceNaming.slug");
      }
      if (commerceNaming.slug && !SLUG_PATTERN.test(commerceNaming.slug)) {
        formatIssues.push("metadata.commerceNaming.slug must be lowercase kebab-case");
      }
      if (commerceNaming.confidence < 0 || commerceNaming.confidence > 1) {
        formatIssues.push("metadata.commerceNaming.confidence must be between 0 and 1");
      }
    }

    if (!isStringArray(intelligence.audit.invalidTags)) {
      formatIssues.push("metadata.intelligence.audit.invalidTags must be a string array");
    }

    const audit = buildAudit(missingFields, lowConfidenceFields, invalidTags, formatIssues, notes);
    intelligence.audit = audit;

    return {
      intelligence,
      commerceNaming,
      needsHumanReview: audit.needsHumanReview,
      missingFields: audit.missingFields,
      lowConfidenceFields: audit.lowConfidenceFields,
      invalidTags: audit.invalidTags,
      formatIssues: audit.formatIssues,
      notes: audit.notes,
    };
  },
};
