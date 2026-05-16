import { SupportedLanguage } from "../hermes/types";
import { loadEnv } from "../config/env";
import type {
  IntelligenceQuery,
  IntelligenceQueryLanguage,
  ParsedGalleryQuery,
  QuerySafetyIntent,
} from "../types/gallery-query.types";
import { canonicalizeGalleryTerm, detectPreferredLanguage, normalizeGalleryLimit } from "../utils/gallery-language";
import { logger } from "../utils/logger";

export type { IntelligenceQuery, IntelligenceQueryLanguage, ParsedGalleryQuery, QuerySafetyIntent };
export type IntelligenceGalleryQuery = IntelligenceQuery;

export const QUERY_PARSER_TIMEOUT_MS = 6000;

type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

type PartialIntelligenceQuery = Partial<IntelligenceQuery>;

const QUERY_PARSER_TIMEOUT_ERROR = "LLM_QUERY_PARSER_TIMEOUT";
const SEARCHABLE_MOOD_VALUES = new Set(["dark", "cute", "elegant", "battle", "magic", "futuristic"]);
const ABSTRACT_KEYWORDS = new Set(["boss_like", "oppressive", "divine", "mysterious"]);
const KEYWORD_BLACKLIST = new Set([
  "card",
  "cards",
  "show",
  "show me",
  "give",
  "give me",
  "find",
  "find me",
  "want",
  "i want",
  "something",
  "a",
  "an",
  "the",
  "one",
  "some",
  "张",
  "个",
  "些",
  "一下",
  "一张",
  "一个",
  "一套",
  "量词",
]);
const QUANTIFIER_PATTERNS = [
  /^\d+$/,
  /^\d+\s*(card|cards|pcs|pieces)$/i,
  /^(one|two|three|four|five|six|seven|eight|nine|ten)$/i,
  /^(张|个|些|套|份)$/,
];

const EMPTY_INTELLIGENCE_QUERY = (): IntelligenceQuery => ({
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
  visualIntent: [],
  emotionalIntent: [],
  characterIntent: [],
  worldbuildingIntent: [],
  confidence: 0,
  language: "unknown",
  reason: "",
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

const detectIntelligenceLanguage = (message: string): IntelligenceQueryLanguage => {
  if (!message.trim()) {
    return "unknown";
  }
  return /[\u4e00-\u9fff]/.test(message) ? "zh" : "en";
};

const buildPrompt = (userMessage: string, language: SupportedLanguage): DeepSeekMessage[] => [
  {
    role: "system",
    content:
      "You are a gallery search parser for LootCardChoose. Return strict JSON only with no markdown and no explanation. " +
      "Use exactly this shape: " +
      '{"language":"zh|en","keywords":string[],"tags":string[],"style":string,"rarity":string,"category":string,"character":string,"color":string,"mood":string,"scene":string,"limit":number,"intelligenceQuery":{"visualStyle":string[],"moodTags":string[],"toneTags":string[],"characterTypes":string[],"archetypeTags":string[],"settingTags":string[],"genreTags":string[],"colorHints":string[],"rarityHints":string[],"commerceIntent":string[],"safetyIntent":"safe|neutral|adult|unknown","visualIntent":string[],"emotionalIntent":string[],"characterIntent":string[],"worldbuildingIntent":string[],"confidence":number,"language":"en|zh|unknown","reason":string}}. ' +
      "The language field must reflect the user's original input language. If unclear, use en. " +
      "Legacy searchable fields should prefer concise English terms even when the user writes in Chinese. " +
      "Use canonical English-first tokens in intelligenceQuery such as black_gold, cyberpunk, dark_fantasy, queen, goddess, collectible, boss_like, divine. " +
      "Do not include pure numbers, quantity words, classifiers, or filler words in keywords. " +
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
    const trimmed = normalizeText(value);
    const normalized = normalizeLower(trimmed);
    if (!trimmed || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(trimmed);
  }

  return result;
};

const addUnique = (values: string[], next: string): string[] => uniqueStrings([...values, next].filter(Boolean));

const containsAny = (message: string, patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(message));

const isQuantifierKeyword = (value: string): boolean => {
  const normalized = normalizeLower(value);
  return QUANTIFIER_PATTERNS.some((pattern) => pattern.test(normalized));
};

const normalizeRarity = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = normalizeText(value).toUpperCase();
  if (["N", "R", "SR", "SSR", "UR"].includes(normalized)) {
    return normalized;
  }
  if (normalized === "RARE") {
    return "R";
  }
  return "";
};

const detectLimit = (message: string): number => {
  const digitMatch = message.match(/\b(10|[1-9])\b/);
  if (digitMatch) {
    return normalizeGalleryLimit(Number.parseInt(digitMatch[1], 10), 10);
  }

  const chineseDigitPatterns: Array<[RegExp, number]> = [
    [/十\s*(张|个)/, 10],
    [/(一|1)\s*(张|个)/, 1],
    [/(两|二|2)\s*(张|个)/, 2],
    [/(三|3)\s*(张|个)/, 3],
    [/(四|4)\s*(张|个)/, 4],
    [/(五|5)\s*(张|个)/, 5],
    [/(六|6)\s*(张|个)/, 6],
    [/(七|7)\s*(张|个)/, 7],
    [/(八|8)\s*(张|个)/, 8],
    [/(九|9)\s*(张|个)/, 9],
  ];

  for (const [pattern, limit] of chineseDigitPatterns) {
    if (pattern.test(message)) {
      return limit;
    }
  }

  return 10;
};

const normalizeSearchTerm = (value: string): string => {
  const normalized = normalizeLower(value);
  if (!normalized || KEYWORD_BLACKLIST.has(normalized) || isQuantifierKeyword(normalized) || /^\d+$/.test(normalized)) {
    return "";
  }

  if (/(black[\s_-]*gold|黑金)/i.test(normalized)) return "black gold";
  if (/(white[\s_-]*gold|白金)/i.test(normalized)) return "white gold";
  if (/(black(?:\s+and\s+|[\s_-]*)red|黑红)/i.test(normalized)) return "black red";
  if (/(blue[\s_-]*hair|蓝发)/i.test(normalized)) return "blue hair";
  if (/\bssr\b/i.test(normalized)) return "SSR";
  if (/\bur\b/i.test(normalized)) return "UR";
  if (/\bsr\b/i.test(normalized)) return "SR";
  if (/\br\b/i.test(normalized)) return "R";
  if (/(queen|女王)/i.test(normalized)) return "queen";
  if (/(goddess|女神)/i.test(normalized)) return "goddess";
  if (/(warrior|战士)/i.test(normalized)) return "warrior";
  if (/(priestess|祭司|神官)/i.test(normalized)) return "priestess";
  if (/(angel|天使)/i.test(normalized)) return "angel";
  if (/(villain|反派)/i.test(normalized)) return "villain";
  if (/(dragon[\s_-]*lord|龙王|龙主)/i.test(normalized)) return "dragon lord";
  if (/(mecha[\s_-]*girl|机甲少女)/i.test(normalized)) return "mecha girl";
  if (/(anime[\s_-]*girl|动漫女孩|二次元女孩)/i.test(normalized)) return "female character";
  if (/(girl|female|女角色|女性角色)/i.test(normalized)) return "female character";
  if (/(cyberpunk|赛博朋克)/i.test(normalized)) return "cyberpunk";
  if (/(dark[\s_-]*fantasy|暗黑幻想)/i.test(normalized)) return "dark fantasy";
  if (/(gothic|哥特)/i.test(normalized)) return "gothic";
  if (/(anime|动漫|动画|二次元)/i.test(normalized)) return "anime";
  if (/(holy|divine|神圣|神性)/i.test(normalized)) return "divine";
  if (/(collectible|收藏|收藏级)/i.test(normalized)) return "collectible";
  if (/(premium|高端|高级感)/i.test(normalized)) return "premium";
  if (/(high[\s_-]*value|高价值)/i.test(normalized)) return "high value";
  if (/(display[\s_-]*piece|展示卡|展示向)/i.test(normalized)) return "display piece";
  if (/(battle[\s_-]*arena|竞技场|战场)/i.test(normalized)) return "battle arena";
  if (/(fantasy[\s_-]*kingdom|王国奇幻|皇家幻想)/i.test(normalized)) return "fantasy kingdom";
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
      .filter((item) => !isQuantifierKeyword(item))
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
  if (/(black[\s_-]*gold|黑金)/i.test(normalized)) return ["black", "gold"];
  if (/(white[\s_-]*gold|白金)/i.test(normalized)) return ["white", "gold"];
  if (/(black(?:\s+and\s+|[\s_-]*)red|黑红)/i.test(normalized)) return ["black", "red"];
  if (/(blue[\s_-]*hair|蓝发)/i.test(normalized)) return ["blue", "blue hair"];
  if (/(neon|霓虹)/i.test(normalized)) return "neon";
  if (/(black|黑)/i.test(normalized)) return "black";
  if (/(gold|金)/i.test(normalized)) return "gold";
  if (/(white|白)/i.test(normalized)) return "white";
  if (/(red|红)/i.test(normalized)) return "red";
  if (/(blue|蓝)/i.test(normalized)) return "blue";
  return normalizeSearchTerm(value);
};

const normalizeCharacterType = (value: string): string => {
  const normalized = normalizeLower(value);
  if (/(mecha[\s_-]*girl|机甲少女)/i.test(normalized)) return "mecha girl";
  if (/(anime[\s_-]*girl|动漫女孩|二次元女孩)/i.test(normalized)) return "female character";
  if (/(girl|female|女角色|女性角色)/i.test(normalized)) return "female character";
  if (/(queen|女王)/i.test(normalized)) return "queen";
  if (/(goddess|女神)/i.test(normalized)) return "goddess";
  if (/(warrior|战士)/i.test(normalized)) return "warrior";
  if (/(priestess|祭司|神官)/i.test(normalized)) return "priestess";
  if (/(angel|天使)/i.test(normalized)) return "angel";
  if (/(dragon[\s_-]*lord|龙王|龙主)/i.test(normalized)) return "dragon lord";
  return normalizeSearchTerm(value);
};

const normalizeArchetype = (value: string): string => {
  const normalized = normalizeLower(value);
  if (/(queen|女王)/i.test(normalized)) return "queen";
  if (/(goddess|女神)/i.test(normalized)) return "goddess";
  if (/(warrior|战士)/i.test(normalized)) return "warrior";
  if (/(priestess|祭司|神官)/i.test(normalized)) return "priestess";
  if (/(angel|天使)/i.test(normalized)) return "angel";
  if (/(villain|反派)/i.test(normalized)) return "villain";
  if (/(dragon[\s_-]*lord|龙王|龙主)/i.test(normalized)) return "dragon lord";
  return normalizeSearchTerm(value);
};

const normalizeSetting = (value: string): string => {
  const normalized = normalizeLower(value);
  if (/(cathedral|大教堂)/i.test(normalized)) return "cathedral";
  if (/(palace|宫殿)/i.test(normalized)) return "palace";
  if (/(shrine|神社|圣殿)/i.test(normalized)) return "shrine";
  if (/(arena|竞技场|战场)/i.test(normalized)) return "arena";
  if (/(kingdom|王国)/i.test(normalized)) return "kingdom";
  if (/(empire|帝国)/i.test(normalized)) return "empire";
  if (/(gothic|哥特)/i.test(normalized)) return "gothic";
  return normalizeSearchTerm(value);
};

const normalizeVisualStyle = (value: string): string => {
  const normalized = normalizeLower(value);
  if (/(cyberpunk|赛博朋克)/i.test(normalized)) return "cyberpunk";
  if (/(dark[\s_-]*fantasy|暗黑幻想)/i.test(normalized)) return "dark fantasy";
  if (/(gothic|哥特)/i.test(normalized)) return "gothic";
  if (/(anime|动漫|动画|二次元)/i.test(normalized)) return "anime";
  if (/(elegant|优雅)/i.test(normalized)) return "elegant";
  if (/(holy|divine|神圣|神性)/i.test(normalized)) return "divine";
  return canonicalizeGalleryTerm(value).trim();
};

const normalizeGenreTag = (value: string): string => {
  const normalized = normalizeLower(value);
  if (/(cyberpunk|赛博朋克)/i.test(normalized)) return "cyberpunk";
  if (/(dark[\s_-]*fantasy|暗黑幻想)/i.test(normalized)) return "dark fantasy";
  if (/(fantasy|奇幻)/i.test(normalized)) return "fantasy";
  if (/(mecha|机甲)/i.test(normalized)) return "mecha";
  if (/(gothic|哥特)/i.test(normalized)) return "gothic";
  if (/(battle|战斗)/i.test(normalized)) return "battle";
  return canonicalizeGalleryTerm(value).trim();
};

const normalizeMoodTag = (value: string): string => {
  const normalized = normalizeLower(value);
  if (/(boss[\s_-]*like|boss|最终\s*boss|最终boss)/i.test(normalized)) return "boss_like";
  if (/(oppressive|压迫感|威压)/i.test(normalized)) return "oppressive";
  if (/(holy|divine|神圣|神性)/i.test(normalized)) return "divine";
  if (/(mysterious|神秘)/i.test(normalized)) return "mysterious";
  if (/(dark|黑暗)/i.test(normalized)) return "dark";
  if (/(elegant|优雅)/i.test(normalized)) return "elegant";
  if (/(cute|可爱)/i.test(normalized)) return "cute";
  if (/(battle|战斗)/i.test(normalized)) return "battle";
  if (/(magic|魔法)/i.test(normalized)) return "magic";
  return canonicalizeGalleryTerm(value).trim();
};

const normalizeToneTag = (value: string): string => {
  const normalized = normalizeLower(value);
  if (/(dark|黑暗)/i.test(normalized)) return "dark";
  if (/(elegant|优雅)/i.test(normalized)) return "elegant";
  if (/(cute|可爱)/i.test(normalized)) return "cute";
  if (/(battle|战斗)/i.test(normalized)) return "battle";
  if (/(magic|魔法)/i.test(normalized)) return "magic";
  if (/(holy|divine|神圣|神性)/i.test(normalized)) return "divine";
  return canonicalizeGalleryTerm(value).trim();
};

const normalizeCommerceIntent = (value: string): string => {
  const normalized = normalizeLower(value);
  if (/(collect|collectible|收藏)/i.test(normalized)) return "collectible";
  if (/(premium|高端|高级感)/i.test(normalized)) return "premium";
  if (/(rare|稀有)/i.test(normalized)) return "rare";
  if (/(high[\s_-]*value|高价值)/i.test(normalized)) return "high_value";
  if (/(display[\s_-]*piece|展示)/i.test(normalized)) return "display_piece";
  if (/(waifu|老婆向)/i.test(normalized)) return "waifu";
  if (/(battle|战斗)/i.test(normalized)) return "battle";
  if (/(buy|purchase|checkout|购买)/i.test(normalized)) return "buy";
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

const clampConfidence = (value: number): number => Math.max(0, Math.min(1, Number(value.toFixed(2))));

const buildLegacyColor = (intelligenceQuery: IntelligenceQuery): string => {
  const hints = intelligenceQuery.colorHints;
  if (hints.includes("black") && hints.includes("gold")) return "black gold";
  if (hints.includes("white") && hints.includes("gold")) return "white gold";
  if (hints.includes("black") && hints.includes("red")) return "black red";
  if (hints.includes("blue hair")) return "blue hair";
  return hints[0] ?? "";
};

const buildLegacyCharacter = (intelligenceQuery: IntelligenceQuery): string => {
  if (intelligenceQuery.characterTypes.includes("female character")) {
    return "female character";
  }
  return intelligenceQuery.characterTypes[0] ?? intelligenceQuery.archetypeTags[0] ?? "";
};

const buildLegacyStyle = (intelligenceQuery: IntelligenceQuery): string =>
  intelligenceQuery.visualStyle[0] ?? intelligenceQuery.genreTags[0] ?? "";

const buildLegacyScene = (intelligenceQuery: IntelligenceQuery): string => intelligenceQuery.settingTags[0] ?? "";

const buildLegacyMood = (intelligenceQuery: IntelligenceQuery): string => {
  const searchableMood = intelligenceQuery.moodTags.find((item) => SEARCHABLE_MOOD_VALUES.has(item));
  if (searchableMood) {
    return searchableMood;
  }
  return intelligenceQuery.toneTags.find((item) => SEARCHABLE_MOOD_VALUES.has(item)) ?? "";
};

const inferVisualIntent = (query: IntelligenceQuery): string[] => {
  let result = uniqueStrings(query.visualIntent);
  const color = query.colorHints;

  if (color.includes("black") && color.includes("gold")) result = addUnique(result, "black_gold");
  if (query.visualStyle.includes("cyberpunk") || query.genreTags.includes("cyberpunk")) result = addUnique(result, "cyberpunk");
  if (query.visualStyle.includes("dark fantasy") || query.genreTags.includes("dark fantasy")) result = addUnique(result, "dark_fantasy");
  if (query.visualStyle.includes("anime")) result = addUnique(result, "anime");
  if (query.visualStyle.includes("gothic")) result = addUnique(result, "gothic");
  if (query.visualStyle.includes("divine")) result = addUnique(result, "divine");

  return result;
};

const inferEmotionalIntent = (query: IntelligenceQuery): string[] => {
  let result = uniqueStrings(query.emotionalIntent);
  for (const tag of [...query.moodTags, ...query.toneTags]) {
    if (["boss_like", "oppressive", "mysterious", "elegant", "divine", "cute", "dark", "battle", "magic"].includes(tag)) {
      result = addUnique(result, tag);
    }
  }
  return result;
};

const inferCharacterIntent = (query: IntelligenceQuery): string[] => {
  let result = uniqueStrings(query.characterIntent);
  if (query.archetypeTags.includes("queen")) {
    result = addUnique(result, "queen");
    result = addUnique(result, "ruler");
  }
  if (query.archetypeTags.includes("goddess")) result = addUnique(result, "goddess");
  if (query.characterTypes.includes("warrior") || query.archetypeTags.includes("warrior")) result = addUnique(result, "warrior");
  if (query.characterTypes.includes("mecha girl")) result = addUnique(result, "mecha_girl");
  if (query.characterTypes.includes("female character") && query.visualStyle.includes("anime")) result = addUnique(result, "anime_girl");
  if (query.archetypeTags.includes("dragon lord")) result = addUnique(result, "dragon_lord");
  if (query.archetypeTags.includes("priestess") || query.characterTypes.includes("priestess")) result = addUnique(result, "priestess");
  if (query.archetypeTags.includes("angel") || query.characterTypes.includes("angel")) result = addUnique(result, "angel");
  if (query.archetypeTags.includes("villain")) result = addUnique(result, "villain");
  return result;
};

const inferWorldbuildingIntent = (query: IntelligenceQuery): string[] => {
  let result = uniqueStrings(query.worldbuildingIntent);
  if (
    (query.visualStyle.includes("cyberpunk") || query.genreTags.includes("cyberpunk")) &&
    (query.settingTags.includes("cathedral") || query.settingTags.includes("shrine"))
  ) {
    result = addUnique(result, "cyber_cathedral");
  }
  if (
    query.visualStyle.includes("dark fantasy") ||
    query.genreTags.includes("dark fantasy") ||
    (query.toneTags.includes("dark") && query.genreTags.includes("fantasy"))
  ) {
    result = addUnique(result, "dark_fantasy");
  }
  if (query.settingTags.includes("kingdom") || query.settingTags.includes("palace")) result = addUnique(result, "fantasy_kingdom");
  if (query.settingTags.includes("arena") || query.genreTags.includes("battle")) result = addUnique(result, "battle_arena");
  if (query.settingTags.includes("empire")) result = addUnique(result, "void_empire");
  return result;
};

const inferConfidence = (query: IntelligenceQuery): number => {
  const categoryHits = [
    query.visualIntent.length > 0 || query.visualStyle.length > 0 || query.colorHints.length > 0,
    query.emotionalIntent.length > 0 || query.moodTags.length > 0 || query.toneTags.length > 0,
    query.characterIntent.length > 0 || query.characterTypes.length > 0 || query.archetypeTags.length > 0,
    query.worldbuildingIntent.length > 0 || query.settingTags.length > 0 || query.genreTags.length > 0,
    query.commerceIntent.length > 0 || query.rarityHints.length > 0,
  ].filter(Boolean).length;

  const signalCount =
    query.visualIntent.length +
    query.emotionalIntent.length +
    query.characterIntent.length +
    query.worldbuildingIntent.length +
    query.commerceIntent.length +
    query.rarityHints.length;

  return clampConfidence(0.32 + categoryHits * 0.09 + Math.min(signalCount, 8) * 0.04);
};

const buildReason = (query: IntelligenceQuery): string => {
  const parts: string[] = [];
  const visual = query.visualIntent[0] ?? query.visualStyle[0];
  const emotion = query.emotionalIntent[0] ?? query.moodTags[0] ?? query.toneTags[0];
  const character = query.characterIntent[0] ?? query.archetypeTags[0] ?? query.characterTypes[0];
  const world = query.worldbuildingIntent[0] ?? query.settingTags[0] ?? query.genreTags[0];
  const commerce = query.commerceIntent[0] ?? query.rarityHints[0];

  if (visual) parts.push(`visual cue ${visual}`);
  if (emotion) parts.push(`emotion ${emotion}`);
  if (character) parts.push(`character ${character}`);
  if (world) parts.push(`world ${world}`);
  if (commerce) parts.push(`commerce ${commerce}`);

  if (parts.length === 0) {
    return "The parser found only weak signals, so the query stayed broad.";
  }

  return `The parser matched ${parts.slice(0, 3).join(", ")} from the user message.`;
};

const finalizeIntelligenceQuery = (
  partial: PartialIntelligenceQuery | undefined,
  userMessage: string,
  language: IntelligenceQueryLanguage
): IntelligenceQuery => {
  const base: IntelligenceQuery = {
    ...EMPTY_INTELLIGENCE_QUERY(),
    visualStyle: normalizeMappedArray(partial?.visualStyle, normalizeVisualStyle),
    moodTags: normalizeMappedArray(partial?.moodTags, normalizeMoodTag),
    toneTags: normalizeMappedArray(partial?.toneTags, normalizeToneTag),
    characterTypes: normalizeMappedArray(partial?.characterTypes, normalizeCharacterType),
    archetypeTags: normalizeMappedArray(partial?.archetypeTags, normalizeArchetype),
    settingTags: normalizeMappedArray(partial?.settingTags, normalizeSetting),
    genreTags: normalizeMappedArray(partial?.genreTags, normalizeGenreTag),
    colorHints: normalizeMappedArray(partial?.colorHints, normalizeColorHint),
    rarityHints: normalizeMappedArray(partial?.rarityHints, (item) => normalizeRarity(item)),
    commerceIntent: normalizeMappedArray(partial?.commerceIntent, normalizeCommerceIntent),
    safetyIntent: normalizeSafetyIntent(partial?.safetyIntent),
    visualIntent: normalizeMappedArray(partial?.visualIntent, (item) => item),
    emotionalIntent: normalizeMappedArray(partial?.emotionalIntent, (item) => item),
    characterIntent: normalizeMappedArray(partial?.characterIntent, (item) => item),
    worldbuildingIntent: normalizeMappedArray(partial?.worldbuildingIntent, (item) => item),
    confidence: typeof partial?.confidence === "number" ? clampConfidence(partial.confidence) : 0,
    language: partial?.language === "en" || partial?.language === "zh" || partial?.language === "unknown" ? partial.language : language,
    reason: typeof partial?.reason === "string" ? normalizeText(partial.reason) : "",
  };

  base.visualIntent = inferVisualIntent(base);
  base.emotionalIntent = inferEmotionalIntent(base);
  base.characterIntent = inferCharacterIntent(base);
  base.worldbuildingIntent = inferWorldbuildingIntent(base);
  base.language = language;
  base.confidence = base.confidence > 0 ? base.confidence : inferConfidence(base);
  base.reason = base.reason || buildReason(base);

  if (base.safetyIntent === "unknown") {
    if (/(adult|nsfw|hentai|erotic|lingerie|bikini|sexy)/i.test(userMessage)) {
      base.safetyIntent = "adult";
    } else if (
      base.emotionalIntent.length > 0 ||
      base.visualIntent.length > 0 ||
      base.characterIntent.length > 0 ||
      base.worldbuildingIntent.length > 0
    ) {
      base.safetyIntent = "neutral";
    }
  }

  return base;
};

const mergeIntelligenceQuery = (primary: IntelligenceQuery, fallback: IntelligenceQuery): IntelligenceQuery =>
  finalizeIntelligenceQuery(
    {
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
      visualIntent: uniqueStrings([...primary.visualIntent, ...fallback.visualIntent]),
      emotionalIntent: uniqueStrings([...primary.emotionalIntent, ...fallback.emotionalIntent]),
      characterIntent: uniqueStrings([...primary.characterIntent, ...fallback.characterIntent]),
      worldbuildingIntent: uniqueStrings([...primary.worldbuildingIntent, ...fallback.worldbuildingIntent]),
      confidence: Math.max(primary.confidence, fallback.confidence),
      language: primary.language === "unknown" ? fallback.language : primary.language,
      reason: primary.reason || fallback.reason,
    },
    "",
    primary.language === "unknown" ? fallback.language : primary.language
  );

const buildMinimalHybridKeywords = (
  baseKeywords: string[],
  intelligenceQuery: IntelligenceQuery,
  legacy: Pick<ParsedGalleryQuery, "style" | "rarity" | "character" | "color" | "scene" | "mood">
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
    ...intelligenceQuery.commerceIntent,
    legacy.style,
    legacy.rarity,
    legacy.character,
    legacy.color,
    legacy.scene,
    legacy.mood,
  ]
    .map(normalizeSearchTerm)
    .filter(Boolean)
    .filter((value) => !ABSTRACT_KEYWORDS.has(normalizeLower(value)))
    .filter((value) => !isQuantifierKeyword(value));

  return uniqueStrings(raw).filter((value) => {
    const normalized = normalizeLower(value);
    return normalized && !KEYWORD_BLACKLIST.has(normalized) && !ABSTRACT_KEYWORDS.has(normalized);
  });
};

const applyMinimalHybrid = (
  partial: Partial<ParsedGalleryQuery>,
  intelligenceQuery: IntelligenceQuery,
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
  const keywords = buildMinimalHybridKeywords(baseKeywords, intelligenceQuery, { style, rarity, character, color, scene, mood });

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

const addSignal = (
  query: IntelligenceQuery,
  fields: Partial<Record<keyof IntelligenceQuery, string | string[] | QuerySafetyIntent>>
): IntelligenceQuery => {
  const next = { ...query };

  const push = (key: keyof Pick<
    IntelligenceQuery,
    | "visualStyle"
    | "moodTags"
    | "toneTags"
    | "characterTypes"
    | "archetypeTags"
    | "settingTags"
    | "genreTags"
    | "colorHints"
    | "rarityHints"
    | "commerceIntent"
    | "visualIntent"
    | "emotionalIntent"
    | "characterIntent"
    | "worldbuildingIntent"
  >) => {
    const value = fields[key];
    if (!value) {
      return;
    }
    const list = Array.isArray(value) ? value : [value];
    next[key] = uniqueStrings([...(next[key] as string[]), ...list]);
  };

  push("visualStyle");
  push("moodTags");
  push("toneTags");
  push("characterTypes");
  push("archetypeTags");
  push("settingTags");
  push("genreTags");
  push("colorHints");
  push("rarityHints");
  push("commerceIntent");
  push("visualIntent");
  push("emotionalIntent");
  push("characterIntent");
  push("worldbuildingIntent");

  if (fields.safetyIntent) {
    next.safetyIntent = fields.safetyIntent as QuerySafetyIntent;
  }

  return next;
};

const buildRuleBasedIntelligenceQuery = (
  userMessage: string,
  language: IntelligenceQueryLanguage = detectIntelligenceLanguage(userMessage)
): IntelligenceQuery => {
  let query = EMPTY_INTELLIGENCE_QUERY();

  if (containsAny(userMessage, [/(black[\s_-]*gold|黑金)/i])) {
    query = addSignal(query, { colorHints: ["black", "gold"], visualIntent: "black_gold" });
  }
  if (containsAny(userMessage, [/(white[\s_-]*gold|白金)/i])) {
    query = addSignal(query, { colorHints: ["white", "gold"] });
  }
  if (containsAny(userMessage, [/(black(?:\s+and\s+|[\s_-]*)red|黑红)/i])) {
    query = addSignal(query, { colorHints: ["black", "red"] });
  }
  if (containsAny(userMessage, [/(blue[\s_-]*hair|蓝发)/i])) {
    query = addSignal(query, { colorHints: ["blue", "blue hair"] });
  }
  if (containsAny(userMessage, [/(gold|金色|金)/i])) {
    query = addSignal(query, { colorHints: "gold" });
  }
  if (containsAny(userMessage, [/(neon|霓虹)/i])) {
    query = addSignal(query, { colorHints: "neon" });
  }

  if (containsAny(userMessage, [/\bSSR\b/i])) query = addSignal(query, { rarityHints: "SSR" });
  if (containsAny(userMessage, [/\bUR\b/i])) query = addSignal(query, { rarityHints: "UR" });
  if (containsAny(userMessage, [/\bSR\b/i])) query = addSignal(query, { rarityHints: "SR" });
  if (containsAny(userMessage, [/(rare|稀有)/i])) query = addSignal(query, { commerceIntent: "rare" });

  if (containsAny(userMessage, [/(queen|女王)/i])) {
    query = addSignal(query, { archetypeTags: "queen", characterIntent: ["queen", "ruler"] });
  }
  if (containsAny(userMessage, [/(goddess|女神)/i])) {
    query = addSignal(query, { archetypeTags: "goddess", characterIntent: "goddess" });
  }
  if (containsAny(userMessage, [/(warrior|战士)/i])) {
    query = addSignal(query, { characterTypes: "warrior", archetypeTags: "warrior", characterIntent: "warrior" });
  }
  if (containsAny(userMessage, [/(mecha[\s_-]*girl|机甲少女)/i])) {
    query = addSignal(query, { characterTypes: "mecha girl", characterIntent: "mecha_girl", genreTags: "mecha" });
  }
  if (containsAny(userMessage, [/(dragon[\s_-]*lord|龙王|龙主)/i])) {
    query = addSignal(query, { archetypeTags: "dragon lord", characterIntent: "dragon_lord" });
  }
  if (containsAny(userMessage, [/(priestess|祭司|神官)/i])) {
    query = addSignal(query, { characterTypes: "priestess", archetypeTags: "priestess", characterIntent: "priestess" });
  }
  if (containsAny(userMessage, [/(angel|天使)/i])) {
    query = addSignal(query, { characterTypes: "angel", archetypeTags: "angel", characterIntent: "angel" });
  }
  if (containsAny(userMessage, [/(villain|反派)/i])) {
    query = addSignal(query, { archetypeTags: "villain", characterIntent: "villain" });
  }
  if (containsAny(userMessage, [/(girl|female|女角色|女性角色|动漫女孩|anime[\s_-]*girl)/i])) {
    query = addSignal(query, { characterTypes: "female character" });
  }
  if (containsAny(userMessage, [/(waifu|老婆向)/i])) {
    query = addSignal(query, { commerceIntent: "waifu" });
  }

  if (containsAny(userMessage, [/(cyberpunk|赛博朋克)/i])) {
    query = addSignal(query, { visualStyle: "cyberpunk", genreTags: "cyberpunk", visualIntent: "cyberpunk" });
  }
  if (containsAny(userMessage, [/(dark[\s_-]*fantasy|暗黑幻想)/i])) {
    query = addSignal(query, { visualStyle: "dark fantasy", genreTags: "dark fantasy", visualIntent: "dark_fantasy" });
  }
  if (containsAny(userMessage, [/(anime|动漫|动画|二次元)/i])) {
    query = addSignal(query, { visualStyle: "anime" });
  }
  if (containsAny(userMessage, [/(gothic|哥特)/i])) {
    query = addSignal(query, { visualStyle: "gothic", genreTags: "gothic" });
  }
  if (containsAny(userMessage, [/(elegant|优雅)/i])) {
    query = addSignal(query, { visualStyle: "elegant", toneTags: "elegant", emotionalIntent: "elegant" });
  }
  if (containsAny(userMessage, [/(holy|divine|神圣|神性)/i])) {
    query = addSignal(query, { visualStyle: "divine", moodTags: "divine", toneTags: "divine", emotionalIntent: "divine" });
  }

  if (containsAny(userMessage, [/(mysterious|神秘)/i])) {
    query = addSignal(query, { moodTags: "mysterious", toneTags: "mysterious", emotionalIntent: "mysterious" });
  }
  if (containsAny(userMessage, [/(boss[\s_-]*like|boss|最终\s*boss|最终boss)/i])) {
    query = addSignal(query, { moodTags: "boss_like", emotionalIntent: "boss_like" });
  }
  if (containsAny(userMessage, [/(oppressive|压迫感|威压|压力感|pressure)/i])) {
    query = addSignal(query, { moodTags: "oppressive", emotionalIntent: "oppressive" });
  }
  if (containsAny(userMessage, [/(dark|黑暗)/i])) {
    query = addSignal(query, { toneTags: "dark", emotionalIntent: "dark" });
  }
  if (containsAny(userMessage, [/(cute|可爱)/i])) {
    query = addSignal(query, { moodTags: "cute", toneTags: "cute", emotionalIntent: "cute" });
  }
  if (containsAny(userMessage, [/(battle|battle-ready|战斗|战斗感)/i])) {
    query = addSignal(query, { moodTags: "battle", toneTags: "battle", genreTags: "battle", commerceIntent: "battle" });
  }
  if (containsAny(userMessage, [/(magic|magical|魔法)/i])) {
    query = addSignal(query, { moodTags: "magic", toneTags: "magic" });
  }
  if (containsAny(userMessage, [/(powerful|强大|强势)/i])) {
    query = addSignal(query, { emotionalIntent: "boss_like" });
  }

  if (containsAny(userMessage, [/(cathedral|大教堂)/i])) {
    query = addSignal(query, { settingTags: "cathedral" });
  }
  if (containsAny(userMessage, [/(palace|宫殿)/i])) {
    query = addSignal(query, { settingTags: "palace", worldbuildingIntent: "fantasy_kingdom" });
  }
  if (containsAny(userMessage, [/(shrine|神社|圣殿)/i])) {
    query = addSignal(query, { settingTags: "shrine" });
  }
  if (containsAny(userMessage, [/(arena|竞技场|战场)/i])) {
    query = addSignal(query, { settingTags: "arena", worldbuildingIntent: "battle_arena" });
  }
  if (containsAny(userMessage, [/(kingdom|王国|皇家幻想|royal fantasy)/i])) {
    query = addSignal(query, { settingTags: "kingdom", genreTags: "fantasy", worldbuildingIntent: "fantasy_kingdom" });
  }
  if (containsAny(userMessage, [/(empire|帝国|虚空帝国)/i])) {
    query = addSignal(query, { settingTags: "empire", worldbuildingIntent: "void_empire" });
  }

  if (containsAny(userMessage, [/(collectible|收藏|收藏价值)/i])) {
    query = addSignal(query, { commerceIntent: "collectible" });
  }
  if (containsAny(userMessage, [/(premium|高端|高级感|贵气)/i])) {
    query = addSignal(query, { commerceIntent: "premium" });
  }
  if (containsAny(userMessage, [/(high[\s_-]*value|高价值|价值高)/i])) {
    query = addSignal(query, { commerceIntent: "high_value" });
  }
  if (containsAny(userMessage, [/(display(?:[\s_-]*piece)?|展示卡|展示向)/i])) {
    query = addSignal(query, { commerceIntent: "display_piece" });
  }
  if (containsAny(userMessage, [/(expensive|奢华|luxury)/i])) {
    query = addSignal(query, { commerceIntent: ["premium", "high_value"] });
  }

  if (containsAny(userMessage, [/(adult|nsfw|hentai|erotic|lingerie|bikini|sexy)/i])) {
    query = addSignal(query, { safetyIntent: "adult" });
  }

  return finalizeIntelligenceQuery(query, userMessage, language);
};

const safeJsonParse = (raw: string, fallbackLanguage: SupportedLanguage, userMessage: string): ParsedGalleryQuery | null => {
  try {
    const parsed = JSON.parse(extractJsonPayload(raw)) as Partial<ParsedGalleryQuery> & {
      intelligenceQuery?: PartialIntelligenceQuery;
    };

    const resolvedLanguage = parsed.language === "zh" || parsed.language === "en" ? parsed.language : fallbackLanguage;
    const intelligenceLanguage = detectIntelligenceLanguage(userMessage) ?? resolvedLanguage;
    const parsedIntelligence = finalizeIntelligenceQuery(parsed.intelligenceQuery, userMessage, intelligenceLanguage);
    const fallbackIntelligence = buildRuleBasedIntelligenceQuery(userMessage, intelligenceLanguage);
    const intelligenceQuery = mergeIntelligenceQuery(parsedIntelligence, fallbackIntelligence);

    return applyMinimalHybrid(parsed, intelligenceQuery, resolvedLanguage, userMessage);
  } catch {
    return null;
  }
};

export const buildRuleBasedGalleryQuery = (userMessage: string, language: SupportedLanguage): ParsedGalleryQuery => {
  const intelligenceQuery = buildRuleBasedIntelligenceQuery(userMessage, detectIntelligenceLanguage(userMessage));
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
