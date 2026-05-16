import type { SupportedLanguage } from "../hermes/types";

export type QuerySafetyIntent = "safe" | "neutral" | "adult" | "unknown";

export type IntelligenceQueryLanguage = "en" | "zh" | "unknown";

export type IntelligenceQuery = {
  visualStyle: string[];
  moodTags: string[];
  toneTags: string[];
  characterTypes: string[];
  archetypeTags: string[];
  settingTags: string[];
  genreTags: string[];
  colorHints: string[];
  rarityHints: string[];
  commerceIntent: string[];
  safetyIntent: QuerySafetyIntent;
  visualIntent: string[];
  emotionalIntent: string[];
  characterIntent: string[];
  worldbuildingIntent: string[];
  confidence: number;
  language: IntelligenceQueryLanguage;
  reason: string;
};

export type ParsedGalleryQuery = {
  language: SupportedLanguage;
  keywords: string[];
  tags: string[];
  style: string;
  rarity: string;
  category: string;
  character: string;
  color: string;
  mood: string;
  scene: string;
  limit: number;
  intelligenceQuery?: IntelligenceQuery;
};
