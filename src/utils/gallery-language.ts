import { SupportedLanguage } from "../hermes/types";

const GALLERY_STOP_WORDS = new Set([
  "给我",
  "我要",
  "帮我",
  "来点",
  "来些",
  "一个",
  "一张",
  "搜索",
  "图库",
  "图片",
  "卡牌",
  "风格",
  "show",
  "me",
  "please",
  "find",
  "search",
  "gallery",
  "image",
  "images",
  "card",
  "cards",
  "trading card",
]);

const MEASURE_WORDS = new Set(["张", "个", "款", "种"]);

const CANONICAL_TERM_MAP: Record<string, string> = {
  黑金: "black gold",
  "black gold": "black gold",
  ssr: "SSR",
  sr: "SR",
  ur: "UR",
  r: "R",
  n: "N",
  女角色: "female character",
  女性角色: "female character",
  美女: "beauty",
  female: "female character",
  girl: "female character",
  "anime girl": "female character",
  "female character": "female character",
  动漫: "anime",
  anime: "anime",
  机甲: "mecha",
  mecha: "mecha",
  暗黑: "dark",
  dark: "dark",
  龙: "dragon",
  dragon: "dragon",
  赛博朋克: "cyberpunk",
  cyberpunk: "cyberpunk",
  可爱: "cute",
  cute: "cute",
  高级感: "premium",
  premium: "premium",
  luxury: "premium",
  战斗: "battle",
  battle: "battle",
  魔法: "magic",
  magic: "magic",
  未来感: "futuristic",
  futuristic: "futuristic",
  金色: "gold",
  gold: "gold",
  黑色: "black",
  black: "black",
  海边: "beach",
  beach: "beach",
  海滩: "beach",
  性感: "sexy",
  sexy: "sexy",
  发货: "shipping",
  物流: "tracking",
  跟踪: "tracking",
  tracking: "tracking",
  付款: "payment",
  支付: "payment",
  payment: "payment",
  购买: "buy",
  buy: "buy",
  购买流程: "buy",
  购买方式: "buy",
  下单: "checkout",
  checkout: "checkout",
  角色: "character",
  character: "character",
  帮助: "help",
  怎么: "help",
};

Object.assign(CANONICAL_TERM_MAP, {
  robotic: "robotic",
  robot: "robotic",
  android: "robotic",
  mechanical: "robotic",
  "sci-fi": "sci-fi",
  "sci fi": "sci-fi",
  "science fiction": "sci-fi",
});

const KEYWORD_EXPANSIONS: Record<string, string[]> = {
  "black gold": ["SSR", "female character", "anime"],
  "female character": ["female", "girl", "anime girl", "anime", "beauty"],
  beauty: ["female character", "anime"],
  anime: ["collectible card"],
  mecha: ["robot", "collectible card"],
  premium: ["luxury"],
  buy: ["checkout", "product page"],
  cute: ["anime", "female character"],
  dark: ["anime", "premium"],
  fantasy: ["premium", "anime"],
  elegant: ["premium", "beauty"],
};

Object.assign(KEYWORD_EXPANSIONS, {
  robotic: ["robot", "android", "mechanical", "collectible card"],
  "sci-fi": ["futuristic", "cyberpunk", "collectible card"],
});

const NEXT_BATCH_PATTERNS = [
  "can we switch to another batch",
  "show me another batch",
  "next batch",
  "another batch",
  "another set",
  "more options",
  "any other options",
  "show me more",
  "more like this",
  "next",
  "more",
  "换一批",
  "再来一批",
  "还有别的吗",
  "下一批",
  "更多类似的",
  "还有其他的吗",
];

const REFINE_PATTERNS = [
  "i don't like these",
  "not these",
  "these are not what i want",
  "these are not right",
  "不喜欢这些",
  "不是这种",
  "这些不太对",
];

const BROADEN_PATTERNS = [
  "try another style",
  "show me another style",
  "different style",
  "something else",
  "换个风格",
];

const GALLERY_REFRESH_PATTERNS = [...NEXT_BATCH_PATTERNS, ...REFINE_PATTERNS, ...BROADEN_PATTERNS];

const ENGLISH_NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

const CHINESE_NUMBER_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

const normalizeText = (value: string): string => value.trim().toLowerCase();

const containsPattern = (message: string, patterns: string[]): boolean => {
  const normalized = normalizeText(message);
  return patterns.some((pattern) => normalized.includes(pattern));
};

const parseExplicitEnglishSelection = (normalized: string): number | null => {
  const exactDigit = normalized.match(/^#?\s*(10|[1-9])$/);
  if (exactDigit) {
    return Number.parseInt(exactDigit[1], 10);
  }

  if (normalized in ENGLISH_NUMBER_WORDS) {
    return ENGLISH_NUMBER_WORDS[normalized];
  }

  const matchers: Array<RegExp> = [
    /^number\s+(one|two|three|four|five|six|seven|eight|nine|ten)$/,
    /^option\s+(one|two|three|four|five|six|seven|eight|nine|ten)$/,
    /^(?:i\s+choose|choose|select|pick|take)\s+(one|two|three|four|five|six|seven|eight|nine|ten|10|[1-9])$/,
    /^(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?:\s+one)?$/,
    /^i(?:'ll|\s+will)?\s+take\s+the\s+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?:\s+one)?$/,
  ];

  for (const matcher of matchers) {
    const match = normalized.match(matcher);
    const token = match?.[1];
    if (!token) {
      continue;
    }

    if (/^\d+$/.test(token)) {
      const numericValue = Number.parseInt(token, 10);
      return numericValue >= 1 && numericValue <= 10 ? numericValue : null;
    }

    return ENGLISH_NUMBER_WORDS[token] ?? null;
  }

  return null;
};

const parseExplicitChineseSelection = (message: string): number | null => {
  const trimmed = message.trim();

  const exactDigit = trimmed.match(/^#?\s*(10|[1-9])$/);
  if (exactDigit) {
    return Number.parseInt(exactDigit[1], 10);
  }

  const patterns: Array<RegExp> = [
    /^第([1-9]|10)个$/,
    /^第([一二三四五六七八九十])个$/,
    /^选([1-9]|10)$/,
    /^选择([1-9]|10)$/,
    /^选第([1-9]|10)个$/,
    /^选第([一二三四五六七八九十])个$/,
    /^我要第([1-9]|10)个$/,
    /^我要第([一二三四五六七八九十])个$/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    const token = match?.[1];
    if (!token) {
      continue;
    }

    if (/^\d+$/.test(token)) {
      const numericValue = Number.parseInt(token, 10);
      return numericValue >= 1 && numericValue <= 10 ? numericValue : null;
    }

    return CHINESE_NUMBER_MAP[token] ?? null;
  }

  return null;
};

export const detectPreferredLanguage = (message: string): SupportedLanguage =>
  /[\u4e00-\u9fff]/.test(message) ? "zh" : "en";

export const normalizeGalleryLimit = (value: unknown, fallback = 10): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  if (value < 1) {
    return fallback;
  }

  return Math.min(Math.floor(value), 10);
};

export const canonicalizeGalleryTerm = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const normalized = normalizeText(trimmed);
  return CANONICAL_TERM_MAP[normalized] ?? trimmed;
};

const stripMeaninglessText = (value: string): string => {
  let cleaned = value.trim();
  cleaned = cleaned.replace(/[，。、“”"'‘’！？；？,.:;()[\]{}<>/\\|@#$%^&*_+=~-]+/g, " ");
  cleaned = cleaned.replace(/\d+\s*(张|个|款|种)?/g, " ");

  for (const stopWord of GALLERY_STOP_WORDS) {
    const escaped = stopWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (/^[a-z0-9 ]+$/i.test(stopWord)) {
      cleaned = cleaned.replace(new RegExp(`\\b${escaped}\\b`, "gi"), " ");
      continue;
    }
    cleaned = cleaned.replace(new RegExp(escaped, "gi"), " ");
  }

  return cleaned.replace(/\s+/g, " ").trim();
};

const uniqueValues = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    const normalized = normalizeText(trimmed);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(trimmed);
  }

  return result;
};

export const extractGalleryKeywordCandidates = (input: string): string[] => {
  const cleaned = stripMeaninglessText(input);
  if (!cleaned) {
    return [];
  }

  const matches = cleaned.match(/[\u4e00-\u9fff]+|[a-zA-Z]+(?:\s+[a-zA-Z]+)*|[0-9]+/g) ?? [];
  const result: string[] = [];

  for (const rawMatch of matches) {
    let token = rawMatch.trim();
    if (!token || /^\d+$/.test(token)) {
      continue;
    }

    while (token.length > 1 && MEASURE_WORDS.has(token.charAt(0))) {
      token = token.slice(1).trim();
    }

    while (token.length > 1 && MEASURE_WORDS.has(token.charAt(token.length - 1))) {
      token = token.slice(0, -1).trim();
    }

    if (!token) {
      continue;
    }

    const normalized = normalizeText(token);
    if (!normalized || GALLERY_STOP_WORDS.has(normalized)) {
      continue;
    }

    result.push(canonicalizeGalleryTerm(token));
  }

  return uniqueValues(result);
};

export const expandGalleryKeywords = (values: string[]): string[] => {
  const queue = uniqueValues(values.map(canonicalizeGalleryTerm).filter(Boolean));
  const seen = new Set<string>();
  const result: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const normalized = normalizeText(current);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(current);

    const expansions = KEYWORD_EXPANSIONS[normalized] ?? [];
    for (const expansion of expansions) {
      if (!seen.has(normalizeText(expansion))) {
        queue.push(expansion);
      }
    }
  }

  return result;
};

export const normalizeGalleryKeywordsToEnglish = (values: string[]): string[] =>
  expandGalleryKeywords(values.flatMap((value) => extractGalleryKeywordCandidates(value)));

export const isGalleryRefreshMessage = (message: string): boolean => containsPattern(message, GALLERY_REFRESH_PATTERNS);

export const inferRefreshModeFromMessage = (message: string): "next_batch" | "refine" | "broaden" => {
  if (containsPattern(message, REFINE_PATTERNS)) {
    return "refine";
  }

  if (containsPattern(message, BROADEN_PATTERNS)) {
    return "broaden";
  }

  if (containsPattern(message, NEXT_BATCH_PATTERNS)) {
    return "next_batch";
  }

  return "next_batch";
};

export const parseSelectedIndex = (
  message: string,
  options?: {
    hasActiveSession?: boolean;
  }
): number | null => {
  if (!options?.hasActiveSession) {
    return null;
  }

  const normalized = normalizeText(message);
  const englishSelection = parseExplicitEnglishSelection(normalized);
  if (englishSelection) {
    return englishSelection;
  }

  const chineseSelection = parseExplicitChineseSelection(message);
  if (chineseSelection) {
    return chineseSelection;
  }

  return null;
};

export const isGallerySelectMessage = (
  message: string,
  options?: {
    hasActiveSession?: boolean;
  }
): boolean => parseSelectedIndex(message, options) !== null;
