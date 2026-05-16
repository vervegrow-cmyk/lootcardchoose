import { SupportedLanguage } from "../hermes/types";
import { loadEnv } from "../config/env";
import {
  canonicalizeGalleryTerm,
  detectPreferredLanguage,
  normalizeGalleryLimit,
} from "../utils/gallery-language";
import { logger } from "../utils/logger";

export const QUERY_PARSER_TIMEOUT_MS = 6000;

export type QuerySafetyIntent = "safe" | "neutral" | "adult" | "unknown";

export type IntelligenceGalleryQuery = {
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
  intelligenceQuery?: IntelligenceGalleryQuery;
};

type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

const QUERY_PARSER_TIMEOUT_ERROR = "LLM_QUERY_PARSER_TIMEOUT";
const SEARCHABLE_MOOD_VALUES = new Set(["dark", "cute", "elegant", "futuristic", "battle", "magic"]);
const ABSTRACT_INTELLIGENCE_TERMS = new Set(["boss_like", "oppressive", "holy", "mysterious"]);
const KEYWORD_BLACKLIST = new Set([
  "cards",
  "card",
  "show me",
  "give me",
  "gallery",
  "image",
  "images",
  "张",
  "个",
  "boss_like",
  "oppressive",
  "holy",
  "mysterious",
]);

const EMPTY_INTELLIGENCE_QUERY = (): IntelligenceGalleryQuery => ({
  visualStyle: [],
  moodTags: [],
  toneTags: [],
  characterTypes: [],
  archetypeTags: [],
  settingTags: [],
  genreTags: [],
  colorHints: [],
  rarityHints: [],
  commerceIntent: [],
  safetyIntent: "unknown",
});

const defaultParsedQuery = (language: SupportedLanguage): ParsedGalleryQuery => ({
  language,
  keywords: [],
  tags: [],
  style: "",
  rarity: "",
  category: "",
  character: "",
  color: "",
  mood: "",
  scene: "",
  limit: 10,
  intelligenceQuery: EMPTY_INTELLIGENCE_QUERY(),
});

const detectLanguage = (message: string): SupportedLanguage => detectPreferredLanguage(message);

const buildPrompt = (userMessage: string, language: SupportedLanguage): DeepSeekMessage[] => [
  {
    role: "system",
    content:
      "You are a gallery search parser for LootCardChoose. Return strict JSON only with no markdown and no explanation. " +
      "Use exactly this shape: " +
      '{"language":"zh|en","keywords":string[],"tags":string[],"style":string,"rarity":string,"category":string,"character":string,"color":string,"mood":string,"scene":string,"limit":number,"intelligenceQuery":{"visualStyle":string[],"moodTags":string[],"toneTags":string[],"characterTypes":string[],"archetypeTags":string[],"settingTags":string[],"genreTags":string[],"colorHints":string[],"rarityHints":string[],"commerceIntent":string[],"safetyIntent":"safe|neutral|adult|unknown"}}. ' +
      "The language field must reflect the user's original input language. If unclear, use en. " +
      "Legacy searchable fields should prefer concise English terms even when the user writes in Chinese. " +
      "Keywords must stay short and searchable. Good keywords: black gold, SSR, female character, queen, goddess, maid, warrior, kimono, cyberpunk, gothic, blue hair. " +
      "Do not include quantity words, numbers, classifiers, filler like cards/show me/give me, or abstract mood words like boss_like, oppressive, holy, mysterious in keywords. " +
      "Only put high-certainty searchable cues into keywords. Put richer semantics into intelligenceQuery. " +
      "Limit must always be an integer between 1 and 10. If missing, use 10.",
  },
  {
    role: "user",
    content: `Input language: ${language}\nUser message: ${userMessage}`,
  },
];

const extractJsonPayload = (raw: string): string => {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
};

const normalizeText = (value: string): string => value.trim().replace(/\s+/g, " ");
const normalizeLower = (value: string): string => normalizeText(value).toLowerCase();

const uniqueStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeLower(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(value.trim());
  }
  return result;
};

const addUnique = (values: string[], next: string): string[] => uniqueStrings([...values, next].filter(Boolean));

const normalizeRarity = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = normalizeText(value).toUpperCase();
  return ["N", "R", "SR", "SSR", "UR"].includes(normalized) ? normalized : "";
};

const detectLimit = (message: string): number => {
  const digitMatch = message.match(/\b(10|[1-9])\b/);
  if (digitMatch) {
    return normalizeGalleryLimit(Number.parseInt(digitMatch[1], 10), 10);
  }

  if (/[十10]\s*[张個个]/.test(message)) return 10;
  if (/[一1]\s*[张個个]/.test(message)) return 1;
  if (/[二2两]\s*[张個个]/.test(message)) return 2;
  if (/[三3]\s*[张個个]/.test(message)) return 3;
  if (/[四4]\s*[张個个]/.test(message)) return 4;
  if (/[五5]\s*[张個个]/.test(message)) return 5;
  if (/[六6]\s*[张個个]/.test(message)) return 6;
  if (/[七7]\s*[张個个]/.test(message)) return 7;
  if (/[八8]\s*[张個个]/.test(message)) return 8;
  if (/[九9]\s*[张個个]/.test(message)) return 9;
  return 10;
};

const containsAny = (message: string, patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(message));

const normalizeSearchTerm = (value: string): string => {
  const normalized = normalizeLower(value);
  if (!normalized || KEYWORD_BLACKLIST.has(normalized) || /^\d+$/.test(normalized)) {
    return "";
  }
  if (/(black gold|黑金|榛戦噾)/i.test(normalized)) return "black gold";
  if (/(white gold|白金)/i.test(normalized)) return "white gold";
  if (/(blue hair|蓝发|藍髮)/i.test(normalized)) return "blue hair";
  if (/\bssr\b/i.test(normalized)) return "SSR";
  if (/\bur\b/i.test(normalized)) return "UR";
  if (/\bsr\b/i.test(normalized)) return "SR";
  if (/(female character|女角色|女性角色|girl|female|anime girl|美女|濂宠鑹?|濂虫€ц鑹?)/i.test(normalized)) return "female character";
  if (/(queen|女王)/i.test(normalized)) return "queen";
  if (/(goddess|女神)/i.test(normalized)) return "goddess";
  if (/(maid|女仆)/i.test(normalized)) return "maid";
  if (/(warrior|战士|戰士)/i.test(normalized)) return "warrior";
  if (/(heroine|女英雄)/i.test(normalized)) return "heroine";
  if (/(attendant|侍从|侍從)/i.test(normalized)) return "attendant";
  if (/(kimono|和服)/i.test(normalized)) return "kimono";
  if (/(cyberpunk|赛博朋克|賽博朋克|璧涘崥鏈嬪厠)/i.test(normalized)) return "cyberpunk";
  if (/(gothic|哥特)/i.test(normalized)) return "gothic";
  if (/(beach|海边|海滨|娴疯竟|娴锋哗)/i.test(normalized)) return "beach";
  if (/(bedroom|卧室|寢室|luxury bedroom)/i.test(normalized)) return "bedroom";
  if (/(shrine|神社)/i.test(normalized)) return "shrine";
  if (/(palace|宫殿|宮殿)/i.test(normalized)) return "palace";
  if (/(mecha|机甲|鏈虹敳)/i.test(normalized)) return "mecha";
  if (/(vampire|吸血鬼)/i.test(normalized)) return "vampire";
  if (/(anime|动画|動漫|动漫|鍔ㄦ极|浜屾鍏?)/i.test(normalized)) return "anime";
  if (/(one piece style|海贼王风格|海賊王風格)/i.test(normalized)) return "one piece style";
  return canonicalizeGalleryTerm(value).trim();
};

const normalizeKeywordArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(
    value
      .filter((item): item is string => typeof item === "string")
      .map(normalizeSearchTerm)
      .filter(Boolean)
  );
};

const normalizeMappedArray = (value: unknown, mapper: (item: string) => string | string[]): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(
    value
      .filter((item): item is string => typeof item === "string")
      .flatMap(mapper)
      .filter(Boolean)
  );
};

const normalizeColorHint = (value: string): string | string[] => {
  const normalized = normalizeLower(value);
  if (/(black gold|黑金|榛戦噾)/i.test(normalized)) return ["black", "gold"];
  if (/(white gold|白金)/i.test(normalized)) return ["white", "gold"];
  if (/(blue hair|蓝发|藍髮)/i.test(normalized)) return "blue hair";
  if (/(black|黑)/i.test(normalized)) return "black";
  if (/(gold|金)/i.test(normalized)) return "gold";
  if (/(white|白)/i.test(normalized)) return "white";
  if (/(blue|蓝|藍)/i.test(normalized)) return "blue";
  return normalizeSearchTerm(value);
};

const normalizeCharacterType = (value: string): string => {
  const normalized = normalizeLower(value);
  if (/(female character|女角色|女性角色|girl|female)/i.test(normalized)) return "female character";
  if (/(maid|女仆)/i.test(normalized)) return "maid";
  if (/(warrior|战士|戰士)/i.test(normalized)) return "warrior";
  if (/(heroine|女英雄)/i.test(normalized)) return "heroine";
  if (/(attendant|侍从|侍從)/i.test(normalized)) return "attendant";
  if (/(queen|女王)/i.test(normalized)) return "queen";
  if (/(goddess|女神)/i.test(normalized)) return "goddess";
  if (/(mecha girl|机甲少女)/i.test(normalized)) return "mecha girl";
  return normalizeSearchTerm(value);
};

const normalizeArchetype = (value: string): string => {
  const normalized = normalizeLower(value);
  if (/(queen|女王)/i.test(normalized)) return "queen";
  if (/(goddess|女神)/i.test(normalized)) return "goddess";
  if (/(maid|女仆)/i.test(normalized)) return "maid";
  if (/(warrior|战士|戰士)/i.test(normalized)) return "warrior";
  if (/(vampire|吸血鬼)/i.test(normalized)) return "vampire";
  return normalizeSearchTerm(value);
};

const normalizeSetting = (value: string): string => {
  const normalized = normalizeLower(value);
  if (/(beach|海边|海滨)/i.test(normalized)) return "beach";
  if (/(bedroom|卧室|寢室|luxury bedroom)/i.test(normalized)) return "bedroom";
  if (/(shrine|神社)/i.test(normalized)) return "shrine";
  if (/(gothic|哥特)/i.test(normalized)) return "gothic";
  if (/(fast food|快餐)/i.test(normalized)) return "fast food";
  if (/(palace|宫殿|宮殿)/i.test(normalized)) return "palace";
  if (/(kimono|和服)/i.test(normalized)) return "kimono";
  return normalizeSearchTerm(value);
};

const normalizeVisualStyle = (value: string): string => {
  const normalized = normalizeLower(value);
  if (/(cyberpunk|赛博朋克|賽博朋克|璧涘崥鏈嬪厠)/i.test(normalized)) return "cyberpunk";
  if (/(gothic|哥特)/i.test(normalized)) return "gothic";
  if (/(anime|动画|動漫|动漫|鍔ㄦ极)/i.test(normalized)) return "anime";
  if (/(one piece style|海贼王风格|海賊王風格)/i.test(normalized)) return "one piece style";
  if (/(kimono|和服)/i.test(normalized)) return "kimono";
  if (/(elegant|优雅)/i.test(normalized)) return "elegant";
  return canonicalizeGalleryTerm(value).trim();
};

const normalizeGenreTag = (value: string): string => {
  const normalized = normalizeLower(value);
  if (/(mecha|机甲|鏈虹敳)/i.test(normalized)) return "mecha";
  if (/(vampire|吸血鬼)/i.test(normalized)) return "vampire";
  if (/(fantasy|奇幻)/i.test(normalized)) return "fantasy";
  if (/(cyberpunk|赛博朋克|賽博朋克)/i.test(normalized)) return "cyberpunk";
  if (/(gothic|哥特)/i.test(normalized)) return "gothic";
  return canonicalizeGalleryTerm(value).trim();
};

const normalizeMoodTag = (value: string): string => {
  const normalized = normalizeLower(value);
  if (/(最终boss|最终 boss|final boss|boss like|boss_like|boss)/i.test(normalized)) return "boss_like";
  if (/(压迫|压迫感|壓迫|oppressive)/i.test(normalized)) return "oppressive";
  if (/(圣洁|神圣|holy)/i.test(normalized)) return "holy";
  if (/(神秘|mysterious)/i.test(normalized)) return "mysterious";
  if (/(dark|黑暗|暗黑|鏆楅粦)/i.test(normalized)) return "dark";
  if (/(elegant|优雅)/i.test(normalized)) return "elegant";
  return canonicalizeGalleryTerm(value).trim();
};

const normalizeToneTag = (value: string): string => {
  const normalized = normalizeLower(value);
  if (/(dark|黑暗|暗黑)/i.test(normalized)) return "dark";
  if (/(holy|神圣|圣洁)/i.test(normalized)) return "holy";
  if (/(mysterious|神秘)/i.test(normalized)) return "mysterious";
  if (/(elegant|优雅)/i.test(normalized)) return "elegant";
  return canonicalizeGalleryTerm(value).trim();
};

const normalizeCommerceIntent = (value: string): string => {
  const normalized = normalizeLower(value);
  if (/(collect|collectible|收藏)/i.test(normalized)) return "collectible";
  if (/(gift|送礼|送禮)/i.test(normalized)) return "giftable";
  if (/(buy|purchase|购买|購買|checkout)/i.test(normalized)) return "buy";
  return canonicalizeGalleryTerm(value).trim();
};

const normalizeSafetyIntent = (value: unknown): QuerySafetyIntent => {
  if (typeof value !== "string") {
    return "unknown";
  }
  const normalized = normalizeLower(value);
  if (normalized === "safe" || normalized === "neutral" || normalized === "adult" || normalized === "unknown") {
    return normalized;
  }
  return "unknown";
};

const normalizeIntelligenceQuery = (value: Partial<IntelligenceGalleryQuery> | undefined): IntelligenceGalleryQuery => ({
  visualStyle: normalizeMappedArray(value?.visualStyle, normalizeVisualStyle),
  moodTags: normalizeMappedArray(value?.moodTags, normalizeMoodTag),
  toneTags: normalizeMappedArray(value?.toneTags, normalizeToneTag),
  characterTypes: normalizeMappedArray(value?.characterTypes, normalizeCharacterType),
  archetypeTags: normalizeMappedArray(value?.archetypeTags, normalizeArchetype),
  settingTags: normalizeMappedArray(value?.settingTags, normalizeSetting),
  genreTags: normalizeMappedArray(value?.genreTags, normalizeGenreTag),
  colorHints: normalizeMappedArray(value?.colorHints, normalizeColorHint),
  rarityHints: normalizeMappedArray(value?.rarityHints, (item) => normalizeRarity(item)),
  commerceIntent: normalizeMappedArray(value?.commerceIntent, normalizeCommerceIntent),
  safetyIntent: normalizeSafetyIntent(value?.safetyIntent),
});

const buildLegacyCharacter = (intelligenceQuery: IntelligenceGalleryQuery): string => {
  if (intelligenceQuery.characterTypes.includes("female character")) {
    return "female character";
  }
  return intelligenceQuery.characterTypes[0] ?? intelligenceQuery.archetypeTags[0] ?? "";
};

const buildLegacyColor = (intelligenceQuery: IntelligenceGalleryQuery): string => {
  const hints = intelligenceQuery.colorHints;
  if (hints.includes("black") && hints.includes("gold")) return "black gold";
  if (hints.includes("white") && hints.includes("gold")) return "white gold";
  if (hints.includes("blue hair")) return "blue hair";
  return hints[0] ?? "";
};

const buildLegacyStyle = (intelligenceQuery: IntelligenceGalleryQuery): string =>
  intelligenceQuery.visualStyle[0] ?? intelligenceQuery.genreTags[0] ?? "";

const buildLegacyScene = (intelligenceQuery: IntelligenceGalleryQuery): string => intelligenceQuery.settingTags[0] ?? "";

const buildLegacyMood = (intelligenceQuery: IntelligenceGalleryQuery): string => {
  const mood = intelligenceQuery.moodTags.find((value) => SEARCHABLE_MOOD_VALUES.has(value));
  if (mood) {
    return mood;
  }
  return intelligenceQuery.toneTags.find((value) => SEARCHABLE_MOOD_VALUES.has(value)) ?? "";
};

const buildMinimalHybridKeywords = (
  baseKeywords: string[],
  intelligenceQuery: IntelligenceGalleryQuery,
  legacy: Pick<ParsedGalleryQuery, "style" | "rarity" | "character" | "color" | "scene">
): string[] => {
  const raw = [
    ...baseKeywords,
    ...intelligenceQuery.colorHints,
    ...intelligenceQuery.rarityHints,
    ...intelligenceQuery.characterTypes,
    ...intelligenceQuery.archetypeTags,
    ...intelligenceQuery.settingTags,
    ...intelligenceQuery.visualStyle,
    ...intelligenceQuery.genreTags,
    legacy.style,
    legacy.rarity,
    legacy.character,
    legacy.color,
    legacy.scene,
  ]
    .map(normalizeSearchTerm)
    .filter(Boolean)
    .filter((value) => !ABSTRACT_INTELLIGENCE_TERMS.has(value));

  return uniqueStrings(raw).filter((value) => {
    const normalized = normalizeLower(value);
    return normalized && !KEYWORD_BLACKLIST.has(normalized) && !ABSTRACT_INTELLIGENCE_TERMS.has(normalized);
  });
};

const applyMinimalHybrid = (
  partial: Partial<ParsedGalleryQuery>,
  intelligenceQuery: IntelligenceGalleryQuery,
  language: SupportedLanguage,
  userMessage: string
): ParsedGalleryQuery => {
  const style = normalizeSearchTerm(typeof partial.style === "string" ? partial.style : "") || buildLegacyStyle(intelligenceQuery);
  const rarity = normalizeRarity(partial.rarity) || intelligenceQuery.rarityHints[0] || "";
  const character =
    normalizeSearchTerm(typeof partial.character === "string" ? partial.character : "") || buildLegacyCharacter(intelligenceQuery);
  const color = normalizeSearchTerm(typeof partial.color === "string" ? partial.color : "") || buildLegacyColor(intelligenceQuery);
  const scene = normalizeSearchTerm(typeof partial.scene === "string" ? partial.scene : "") || buildLegacyScene(intelligenceQuery);
  const moodCandidate = typeof partial.mood === "string" ? normalizeMoodTag(partial.mood) : "";
  const mood = SEARCHABLE_MOOD_VALUES.has(moodCandidate) ? moodCandidate : buildLegacyMood(intelligenceQuery);
  const category = typeof partial.category === "string" ? canonicalizeGalleryTerm(partial.category).trim() : "";
  const tags = normalizeKeywordArray(partial.tags);
  const baseKeywords = normalizeKeywordArray(partial.keywords);
  const keywords = buildMinimalHybridKeywords(baseKeywords, intelligenceQuery, { style, rarity, character, color, scene });

  return {
    ...defaultParsedQuery(language),
    language: partial.language === "zh" || partial.language === "en" ? partial.language : language,
    keywords,
    tags,
    style,
    rarity,
    category,
    character,
    color,
    mood,
    scene,
    limit: normalizeGalleryLimit(partial.limit ?? detectLimit(userMessage), 10),
    intelligenceQuery,
  };
};

const buildRuleBasedIntelligenceQuery = (userMessage: string): IntelligenceGalleryQuery => {
  const query = EMPTY_INTELLIGENCE_QUERY();

  if (containsAny(userMessage, [/(black gold|黑金|榛戦噾)/i])) {
    query.colorHints = addUnique(query.colorHints, "black");
    query.colorHints = addUnique(query.colorHints, "gold");
  }
  if (containsAny(userMessage, [/(white gold|白金)/i])) {
    query.colorHints = addUnique(query.colorHints, "white");
    query.colorHints = addUnique(query.colorHints, "gold");
  }
  if (containsAny(userMessage, [/(blue hair|蓝发|藍髮)/i])) {
    query.colorHints = addUnique(query.colorHints, "blue hair");
  }

  if (containsAny(userMessage, [/\bSSR\b/i])) query.rarityHints = addUnique(query.rarityHints, "SSR");
  if (containsAny(userMessage, [/\bUR\b/i])) query.rarityHints = addUnique(query.rarityHints, "UR");
  if (containsAny(userMessage, [/\bSR\b/i])) query.rarityHints = addUnique(query.rarityHints, "SR");

  if (containsAny(userMessage, [/(女角色|女性角色|girl|female|anime girl|濂宠鑹?|濂虫€ц鑹?)/i])) {
    query.characterTypes = addUnique(query.characterTypes, "female character");
  }
  if (containsAny(userMessage, [/(queen|女王)/i])) {
    query.archetypeTags = addUnique(query.archetypeTags, "queen");
    query.characterTypes = addUnique(query.characterTypes, "female character");
  }
  if (containsAny(userMessage, [/(goddess|女神)/i])) {
    query.archetypeTags = addUnique(query.archetypeTags, "goddess");
  }
  if (containsAny(userMessage, [/(maid|女仆)/i])) {
    query.characterTypes = addUnique(query.characterTypes, "maid");
    query.archetypeTags = addUnique(query.archetypeTags, "maid");
  }
  if (containsAny(userMessage, [/(warrior|战士|戰士)/i])) {
    query.characterTypes = addUnique(query.characterTypes, "warrior");
    query.archetypeTags = addUnique(query.archetypeTags, "warrior");
  }
  if (containsAny(userMessage, [/(heroine|女英雄)/i])) {
    query.characterTypes = addUnique(query.characterTypes, "heroine");
  }
  if (containsAny(userMessage, [/(attendant|侍从|侍從)/i])) {
    query.characterTypes = addUnique(query.characterTypes, "attendant");
  }

  if (containsAny(userMessage, [/(mecha|机甲|鏈虹敳)/i])) {
    query.genreTags = addUnique(query.genreTags, "mecha");
  }
  if (containsAny(userMessage, [/(vampire|吸血鬼)/i])) {
    query.genreTags = addUnique(query.genreTags, "vampire");
    query.archetypeTags = addUnique(query.archetypeTags, "vampire");
  }

  if (containsAny(userMessage, [/(beach|海边|海滨|娴疯竟|娴锋哗)/i])) query.settingTags = addUnique(query.settingTags, "beach");
  if (containsAny(userMessage, [/(bedroom|卧室|寢室|luxury bedroom)/i])) query.settingTags = addUnique(query.settingTags, "bedroom");
  if (containsAny(userMessage, [/(shrine|神社)/i])) query.settingTags = addUnique(query.settingTags, "shrine");
  if (containsAny(userMessage, [/(gothic|哥特)/i])) query.settingTags = addUnique(query.settingTags, "gothic");
  if (containsAny(userMessage, [/(fast food|快餐)/i])) query.settingTags = addUnique(query.settingTags, "fast food");
  if (containsAny(userMessage, [/(palace|宫殿|宮殿)/i])) query.settingTags = addUnique(query.settingTags, "palace");
  if (containsAny(userMessage, [/(kimono|和服)/i])) query.settingTags = addUnique(query.settingTags, "kimono");

  if (containsAny(userMessage, [/(cyberpunk|赛博朋克|賽博朋克|璧涘崥鏈嬪厠)/i])) {
    query.visualStyle = addUnique(query.visualStyle, "cyberpunk");
    query.genreTags = addUnique(query.genreTags, "cyberpunk");
  }
  if (containsAny(userMessage, [/(gothic|哥特)/i])) {
    query.visualStyle = addUnique(query.visualStyle, "gothic");
    query.genreTags = addUnique(query.genreTags, "gothic");
  }
  if (containsAny(userMessage, [/(anime|动画|動漫|动漫|鍔ㄦ极|浜屾鍏?)/i])) {
    query.visualStyle = addUnique(query.visualStyle, "anime");
  }
  if (containsAny(userMessage, [/(kimono|和服)/i])) {
    query.visualStyle = addUnique(query.visualStyle, "kimono");
  }
  if (containsAny(userMessage, [/(one piece style|海贼王风格|海賊王風格)/i])) {
    query.visualStyle = addUnique(query.visualStyle, "one piece style");
  }
  if (containsAny(userMessage, [/(elegant|优雅)/i])) {
    query.visualStyle = addUnique(query.visualStyle, "elegant");
  }

  if (containsAny(userMessage, [/(圣洁|神圣|holy)/i])) {
    query.moodTags = addUnique(query.moodTags, "holy");
    query.toneTags = addUnique(query.toneTags, "holy");
  }
  if (containsAny(userMessage, [/(神秘|mysterious)/i])) {
    query.moodTags = addUnique(query.moodTags, "mysterious");
    query.toneTags = addUnique(query.toneTags, "mysterious");
  }
  if (containsAny(userMessage, [/(最终boss|最终 boss|final boss|boss like|boss_like|boss)/i])) {
    query.moodTags = addUnique(query.moodTags, "boss_like");
  }
  if (containsAny(userMessage, [/(压迫|压迫感|壓迫|oppressive)/i])) {
    query.moodTags = addUnique(query.moodTags, "oppressive");
  }
  if (containsAny(userMessage, [/(dark|黑暗|暗黑|鏆楅粦)/i])) {
    query.toneTags = addUnique(query.toneTags, "dark");
  }

  if (containsAny(userMessage, [/(collect|collectible|收藏)/i])) {
    query.commerceIntent = addUnique(query.commerceIntent, "collectible");
  }
  if (containsAny(userMessage, [/(buy|purchase|购买|購買|checkout)/i])) {
    query.commerceIntent = addUnique(query.commerceIntent, "buy");
  }

  if (containsAny(userMessage, [/(adult|nsfw|hentai|erotic|lingerie|bikini|sexy)/i])) {
    query.safetyIntent = "adult";
  } else if (query.moodTags.length > 0 || query.toneTags.length > 0) {
    query.safetyIntent = "neutral";
  }

  return query;
};

const mergeIntelligenceQuery = (
  primary: IntelligenceGalleryQuery,
  fallback: IntelligenceGalleryQuery
): IntelligenceGalleryQuery => ({
  visualStyle: uniqueStrings([...primary.visualStyle, ...fallback.visualStyle]),
  moodTags: uniqueStrings([...primary.moodTags, ...fallback.moodTags]),
  toneTags: uniqueStrings([...primary.toneTags, ...fallback.toneTags]),
  characterTypes: uniqueStrings([...primary.characterTypes, ...fallback.characterTypes]),
  archetypeTags: uniqueStrings([...primary.archetypeTags, ...fallback.archetypeTags]),
  settingTags: uniqueStrings([...primary.settingTags, ...fallback.settingTags]),
  genreTags: uniqueStrings([...primary.genreTags, ...fallback.genreTags]),
  colorHints: uniqueStrings([...primary.colorHints, ...fallback.colorHints]),
  rarityHints: uniqueStrings([...primary.rarityHints, ...fallback.rarityHints]),
  commerceIntent: uniqueStrings([...primary.commerceIntent, ...fallback.commerceIntent]),
  safetyIntent: primary.safetyIntent === "unknown" ? fallback.safetyIntent : primary.safetyIntent,
});

const safeJsonParse = (raw: string, fallbackLanguage: SupportedLanguage, userMessage: string): ParsedGalleryQuery | null => {
  try {
    const parsed = JSON.parse(extractJsonPayload(raw)) as Partial<ParsedGalleryQuery> & {
      intelligenceQuery?: Partial<IntelligenceGalleryQuery>;
    };
    const intelligenceQuery = mergeIntelligenceQuery(
      normalizeIntelligenceQuery(parsed.intelligenceQuery),
      buildRuleBasedIntelligenceQuery(userMessage)
    );
    return applyMinimalHybrid(parsed, intelligenceQuery, fallbackLanguage, userMessage);
  } catch {
    return null;
  }
};

export const buildRuleBasedGalleryQuery = (
  userMessage: string,
  language: SupportedLanguage
): ParsedGalleryQuery => {
  const intelligenceQuery = buildRuleBasedIntelligenceQuery(userMessage);
  return applyMinimalHybrid({}, intelligenceQuery, language, userMessage);
};

const fallbackParsedQuery = (userMessage: string, language: SupportedLanguage): ParsedGalleryQuery =>
  buildRuleBasedGalleryQuery(userMessage, language);

const logFallback = (
  query: string,
  language: SupportedLanguage,
  reason: "timeout" | "non_200" | "json_parse_failed" | "network_error" | "missing_api_key"
): ParsedGalleryQuery => {
  const fallback = fallbackParsedQuery(query, language);
  logger.warn("[LLM QUERY PARSER] fallback", {
    query,
    reason,
    fallbackKeywords: fallback.keywords,
    intelligenceQuery: fallback.intelligenceQuery,
  });
  return fallback;
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));

export const parseGalleryQuery = async (
  userMessage: string,
  language?: SupportedLanguage
): Promise<ParsedGalleryQuery | null> => {
  const env = loadEnv();
  const enabled = env.enableNaturalLanguageSearch;
  logger.info("[LLM QUERY PARSER] enabled", { enabled });

  if (!enabled) {
    return null;
  }

  const resolvedLanguage = language ?? detectLanguage(userMessage);
  const apiKey = env.deepseekApiKey;
  const baseUrl = env.deepseekBaseUrl;
  const model = env.deepseekModel;

  if (!apiKey) {
    return logFallback(userMessage, resolvedLanguage, "missing_api_key");
  }

  logger.info("[LLM QUERY PARSER] input", { query: userMessage, language: resolvedLanguage });

  const controller = new AbortController();
  let timeoutHandle: NodeJS.Timeout | undefined;

  try {
    const response = await Promise.race<
      | { ok: true; payload: DeepSeekResponse }
      | { ok: false; status: number }
    >([
      (async () => {
        const httpResponse = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            messages: buildPrompt(userMessage, resolvedLanguage),
          }),
          signal: controller.signal,
        });

        if (!httpResponse.ok) {
          return { ok: false as const, status: httpResponse.status };
        }

        return {
          ok: true as const,
          payload: (await httpResponse.json()) as DeepSeekResponse,
        };
      })(),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          controller.abort();
          reject(new Error(QUERY_PARSER_TIMEOUT_ERROR));
        }, QUERY_PARSER_TIMEOUT_MS);
      }),
    ]);

    if (!response.ok) {
      const fallback = fallbackParsedQuery(userMessage, resolvedLanguage);
      logger.warn("[LLM QUERY PARSER] fallback", {
        query: userMessage,
        reason: "non_200",
        status: response.status,
        fallbackKeywords: fallback.keywords,
      });
      return fallback;
    }

    const content = response.payload.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = safeJsonParse(content, resolvedLanguage, userMessage);
    if (!parsed) {
      return logFallback(userMessage, resolvedLanguage, "json_parse_failed");
    }

    logger.info("[LLM QUERY PARSER] parsed", parsed);
    return parsed;
  } catch (error) {
    if ((error instanceof Error && error.message === QUERY_PARSER_TIMEOUT_ERROR) || isAbortError(error)) {
      const fallback = fallbackParsedQuery(userMessage, resolvedLanguage);
      logger.warn("[LLM QUERY PARSER] timeout", {
        query: userMessage,
        timeoutMs: QUERY_PARSER_TIMEOUT_MS,
        fallbackKeywords: fallback.keywords,
      });
      return fallback;
    }

    const fallback = fallbackParsedQuery(userMessage, resolvedLanguage);
    logger.warn("[LLM QUERY PARSER] fallback", {
      query: userMessage,
      reason: "network_error",
      error: error instanceof Error ? error.message : String(error),
      fallbackKeywords: fallback.keywords,
    });
    return fallback;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};
