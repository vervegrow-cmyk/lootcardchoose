export type GalleryEnergyLevel = "low" | "medium" | "high";

export type GalleryVisualLayer = {
  primaryColors: string[];
  styleTags: string[];
  compositionTags: string[];
  subjectFocus: string;
  raritySignals: string[];
};

export type GalleryEmotionalLayer = {
  moodTags: string[];
  toneTags: string[];
  energyLevel: GalleryEnergyLevel;
  dramaticIntensity: number;
};

export type GalleryCharacterLayer = {
  entityType: string;
  genderPresentation: string;
  agePresentation: string;
  archetypeTags: string[];
  poseTags: string[];
};

export type GalleryWorldbuildingLayer = {
  settingTags: string[];
  genreTags: string[];
  factionTags: string[];
  propTags: string[];
  powerSystemTags: string[];
};

export type GalleryCommerceLayer = {
  searchKeywords: string[];
  collectorHooks: string[];
  marketingAngles: string[];
  audienceTags: string[];
  safetyFlags: string[];
  category?: string;
};

export type GalleryIntelligenceAudit = {
  needsHumanReview: boolean;
  missingFields: string[];
  lowConfidenceFields: string[];
  invalidTags: string[];
  formatIssues: string[];
  notes: string[];
};

export type GalleryMetadataIntelligence = {
  intelligenceVersion: "v1";
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
