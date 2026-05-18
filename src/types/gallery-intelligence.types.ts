export type GalleryPricingTier = "budget" | "standard" | "premium" | "collector";

export type GalleryEnergyLevel = "low" | "medium" | "high";

export type GalleryCardIntelligenceMetadata = {
  intelligenceVersion: "v1";
  visualLayer: {
    visualStyle: string[];
    colorPalette: string[];
    artStyle: string[];
  };
  emotionalLayer: {
    mood: string[];
    atmosphere: string[];
  };
  characterLayer: {
    characterType: string[];
    genderPresentation?: string;
    roleArchetype: string[];
  };
  worldbuildingLayer: {
    universe: string[];
    theme: string[];
    faction: string[];
  };
  commerceLayer: {
    rarity?: string;
    pricingTier: GalleryPricingTier;
    collectorScore: number;
    waifuScore: number;
    battleScore: number;
  };
};

export type GalleryLegacyVisualLayerFields = {
  primaryColors: string[];
  styleTags: string[];
  compositionTags: string[];
  subjectFocus: string;
  raritySignals: string[];
};

export type GalleryLegacyEmotionalLayerFields = {
  moodTags: string[];
  toneTags: string[];
  energyLevel: GalleryEnergyLevel;
  dramaticIntensity: number;
};

export type GalleryLegacyCharacterLayerFields = {
  entityType: string;
  agePresentation: string;
  archetypeTags: string[];
  poseTags: string[];
};

export type GalleryLegacyWorldbuildingLayerFields = {
  settingTags: string[];
  genreTags: string[];
  factionTags: string[];
  propTags: string[];
  powerSystemTags: string[];
};

export type GalleryLegacyCommerceLayerFields = {
  searchKeywords: string[];
  collectorHooks: string[];
  marketingAngles: string[];
  audienceTags: string[];
  safetyFlags: string[];
  category?: string;
};

export type GalleryVisualLayer = GalleryCardIntelligenceMetadata["visualLayer"] & GalleryLegacyVisualLayerFields;

export type GalleryEmotionalLayer = GalleryCardIntelligenceMetadata["emotionalLayer"] & GalleryLegacyEmotionalLayerFields;

export type GalleryCharacterLayer = GalleryCardIntelligenceMetadata["characterLayer"] & GalleryLegacyCharacterLayerFields;

export type GalleryWorldbuildingLayer = GalleryCardIntelligenceMetadata["worldbuildingLayer"] &
  GalleryLegacyWorldbuildingLayerFields;

export type GalleryCommerceLayer = GalleryCardIntelligenceMetadata["commerceLayer"] & GalleryLegacyCommerceLayerFields;

export type GalleryIntelligenceAudit = {
  needsHumanReview: boolean;
  missingFields: string[];
  lowConfidenceFields: string[];
  invalidTags: string[];
  formatIssues: string[];
  notes: string[];
};

export type GalleryMetadataIntelligence = GalleryCardIntelligenceMetadata & {
  confidence: number;
  visualLayer: GalleryVisualLayer;
  emotionalLayer: GalleryEmotionalLayer;
  characterLayer: GalleryCharacterLayer;
  worldbuildingLayer: GalleryWorldbuildingLayer;
  commerceLayer: GalleryCommerceLayer;
  audit: GalleryIntelligenceAudit;
};

export type GalleryCommerceNaming = {
  displayTitle: string;
  shopifyTitle: string;
  shortName: string;
  slug: string;
  namingVersion: "v1";
  confidence: number;
  source: "vision-intelligence-v1";
};

export type GalleryMetadataAuditResult = {
  intelligence: GalleryMetadataIntelligence;
  commerceNaming: GalleryCommerceNaming | null;
  needsHumanReview: boolean;
  missingFields: string[];
  lowConfidenceFields: string[];
  invalidTags: string[];
  formatIssues: string[];
  notes: string[];
};

export type GalleryIntelligenceVisionResponse = {
  intelligence: {
    confidence: number;
    visualLayer: Partial<GalleryVisualLayer>;
    emotionalLayer: Partial<GalleryEmotionalLayer>;
    characterLayer: Partial<GalleryCharacterLayer>;
    worldbuildingLayer: Partial<GalleryWorldbuildingLayer>;
    commerceLayer: Partial<GalleryCommerceLayer>;
  };
  commerceNaming: {
    displayTitle: string;
    shopifyTitle: string;
    shortName: string;
    slug: string;
    confidence: number;
  };
};
