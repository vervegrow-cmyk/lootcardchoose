import { SupportedLanguage } from "../hermes/types";

const GALLERY_STOP_WORDS = new Set([
  "给我",
  "我要",
  "帮我",
  "来点",
  "来些",
  "一个",
  "找",
  "搜索",
  "图库",
  "图片",
  "卡牌",
  "样式",
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

const MEASURE_WORDS = new Set(["张", "个", "套", "款", "种"]);

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
  shipping: "shipping",
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
};

const NEXT_BATCH_PATTERNS = [
  "can we switch to another batch",
  "show me another batch",
  "next batch",
  "more options",
  "any other options",
  "show me more",
  "more like this",
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
  "不喜欢这些",
  "不是这种",
  "这些不太对",
];

const BROADEN_PATTERNS = [
  "try another style",
  "something else",
  "换个风格",
];

const normalizeText = (value: string): string => value.trim().toLowerCase();

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
  cleaned = cleaned.replace(/[，。、“”"'‘’！；？！,.:;()[\]{}<>/\\|@#$%^&*_+=~-]+/g, " ");
  cleaned = cleaned.replace(/\d+\s*(张|个|套|款|种)?/g, " ");

  for (const stopWord of GALLERY_STOP_WORDS) {
    cleaned = cleaned.replace(new RegExp(stopWord, "gi"), " ");
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

export const inferRefreshModeFromMessage = (
  message: string
): "next_batch" | "refine" | "broaden" => {
  const normalized = normalizeText(message);

  if (REFINE_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return "refine";
  }

  if (BROADEN_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return "broaden";
  }

  if (NEXT_BATCH_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return "next_batch";
  }

  return "next_batch";
};
