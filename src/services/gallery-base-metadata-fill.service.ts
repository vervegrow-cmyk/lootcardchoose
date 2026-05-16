import path from "node:path";
import type {
  GalleryCommerceNaming,
  GalleryMetadataAuditResult,
  GalleryMetadataIntelligence,
} from "../types/gallery-intelligence.types";
import type { GalleryImageMetadata } from "../utils/gallery-metadata";
import { slugToTitle } from "../utils/gallery-metadata";

type MetadataContainer = Record<string, unknown> & {
  source?: string;
  filename?: string;
  intelligence?: GalleryMetadataIntelligence;
  commerceNaming?: GalleryCommerceNaming;
};

export type BaseMetadataFillResult = {
  eligible: boolean;
  reasons: string[];
  next: GalleryImageMetadata;
  changedFields: string[];
};

const GENERIC_CATEGORIES = new Set(["", "card", "other", "unknown"]);
const GENERIC_STYLE_VALUES = new Set(["", "card"]);
const GENERIC_CHARACTER_VALUES = new Set(["", "unknown"]);
const SSR_HOOK_PATTERNS = [/\bssr\b/i, /\blimited edition\b/i, /\bpremium art\b/i, /\bluxury design\b/i];
const UR_HOOK_PATTERNS = [/\bur\b/i, /\bultra\b/i, /\bmythic\b/i, /\blegendary\b/i, /\bdivine\b/i];
const DISPLAY_HIGH_RISK_PATTERNS = [
  /\bseductive\b/i,
  /\bseductress\b/i,
  /\berotic\b/i,
  /\bhentai\b/i,
  /\bbra\b/i,
  /\badult\b/i,
  /\bmcdonald'?s\b/i,
  /\bnike\b/i,
  /\badidas\b/i,
  /\bdisney\b/i,
  /\bmarvel\b/i,
  /\bpokemon\b/i,
  /\bpokémon\b/i,
];
const BANNED_TITLE_PATTERNS = [
  /\blootcardchoose\b/gi,
  /\blootcard\b/gi,
  /\bpatreo\s*n\b/gi,
  /\bpatreon\b/gi,
  /\bexclusive\b/gi,
  /\berotic\b/gi,
  /\bhentai\b/gi,
];
const BANNED_TAG_PATTERNS = [
  /\blootcard\b/i,
  /\bpatreo\s*n\b/i,
  /\bpatreon\b/i,
  /\berotic\b/i,
  /\bhentai\b/i,
  /\bvren+\w*/i,
  /\bmcdonald'?s\b/i,
];
const DISPLAY_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bseductress\b/gi, replacement: "glamorous character" },
  { pattern: /\bseductive\b/gi, replacement: "elegant" },
  { pattern: /\bsensual\b/gi, replacement: "stylish" },
  { pattern: /\balluring\b/gi, replacement: "glamorous" },
  { pattern: /\berotic\b/gi, replacement: "character art" },
  { pattern: /\bhentai\b/gi, replacement: "anime" },
  { pattern: /\badult\b/gi, replacement: "character art" },
  { pattern: /\bbra\b/gi, replacement: "outfit" },
  { pattern: /\bprovocative\b/gi, replacement: "dynamic" },
  { pattern: /\bexposed\b/gi, replacement: "bold" },
  { pattern: /\bmcdonald'?s\b/gi, replacement: "fast food restaurant" },
  { pattern: /\bnike\b/gi, replacement: "athletic outfit" },
  { pattern: /\badidas\b/gi, replacement: "athletic outfit" },
  { pattern: /\bdisney\b/gi, replacement: "fantasy character" },
  { pattern: /\bmarvel\b/gi, replacement: "fantasy character" },
  { pattern: /\bpokémon\b/gi, replacement: "monster companion" },
  { pattern: /\bpokemon\b/gi, replacement: "monster companion" },
];
const STYLING_TITLE_BLOCKLIST = [/\bsexy\b/i, /\bbeach babe\b/i, /\bglamorous character\b/i, /\blingerie girl\b/i];
const STYLING_TAG_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bbeach babe\b/gi, replacement: "beach muse" },
  { pattern: /\bglamorous character\b/gi, replacement: "fantasy heroine" },
  { pattern: /\blingerie girl\b/gi, replacement: "lace attire heroine" },
  { pattern: /\bsexy\b/gi, replacement: "stylish" },
  { pattern: /\blingerie\b/gi, replacement: "lace attire" },
];
const TITLE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "art",
  "card",
  "character",
  "digital",
  "for",
  "in",
  "of",
  "on",
  "scene",
  "style",
  "the",
  "with",
]);
const TITLE_SEARCH_WORDS = new Set([
  "anime",
  "maid",
  "queen",
  "goddess",
  "kimono",
  "warrior",
  "blue hair",
  "black gold",
  "shrine",
  "beach",
  "fantasy",
  "heroine",
  "attendant",
]);
const GENERIC_TITLE_VALUES = new Set([
  "",
  "anime",
  "anime art",
  "anime card",
  "anime character",
  "character art",
  "character card",
  "digital art",
]);
const DESCRIPTION_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "anime",
  "art",
  "card",
  "character",
  "collectible",
  "digital",
  "for",
  "illustration",
  "in",
  "of",
  "scene",
  "style",
  "the",
  "with",
]);
const TITLE_STYLE_CUES = ["elegant", "moonlit", "crimson", "azure", "royal", "mystic", "shrine", "violet", "golden"];
const TITLE_POLISH_ROLE_PATTERNS = [
  { pattern: /\bmaid\b/i, phrase: "maid" },
  { pattern: /\bqueen\b/i, phrase: "queen" },
  { pattern: /\bgoddess\b/i, phrase: "goddess" },
  { pattern: /\bwarrior\b/i, phrase: "warrior" },
  { pattern: /\bheroine\b/i, phrase: "heroine" },
  { pattern: /\battendant\b/i, phrase: "attendant" },
];
const TITLE_POLISH_SCENE_PATTERNS = [
  { pattern: /\bfast food restaurant\b/i, phrase: "fast food" },
  { pattern: /\bfast food\b/i, phrase: "fast food" },
  { pattern: /\bluxury bedroom\b/i, phrase: "luxury bedroom" },
  { pattern: /\bbedroom\b/i, phrase: "bedroom" },
  { pattern: /\bbeach(?:side)?\b/i, phrase: "beach" },
  { pattern: /\bshrine\b/i, phrase: "shrine" },
  { pattern: /\bgothic\b/i, phrase: "gothic" },
  { pattern: /\bpalace\b/i, phrase: "palace" },
];
const TITLE_POLISH_VISUAL_PATTERNS = [
  { pattern: /\bblue hair(?:ed)?\b/i, phrase: "blue hair" },
  { pattern: /\bblack gold\b/i, phrase: "black gold" },
  { pattern: /\bkimono\b/i, phrase: "kimono" },
];
const TITLE_LOW_VALUE_PATTERNS = [/\billustration\b/gi, /\bcharacter art\b/gi, /\bdigital art\b/gi, /\bcharacter\b/gi];
const TITLE_BANNED_PATTERNS = [
  /\bseductive\b/gi,
  /\bseductress\b/gi,
  /\berotic\b/gi,
  /\bhentai\b/gi,
  /\bbra\b/gi,
  /\badult\b/gi,
  /\bsexy\b/gi,
  /\blingerie\b/gi,
  /\bbikini\b/gi,
  /\bseduction\b/gi,
  /\bmcdonald'?s\b/gi,
  /\bnike\b/gi,
  /\badidas\b/gi,
  /\bdisney\b/gi,
  /\bmarvel\b/gi,
  /\bpokemon\b/gi,
  /\bpok茅mon\b/gi,
];
const TITLE_ALLOWED_STYLING_CUES = new Set(["elegant", "mystic", "royal", "azure", "crimson", "fantasy"]);
const CHARACTER_REFINEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bglamorous character\b/gi, replacement: "fantasy heroine" },
  { pattern: /\bbeach babe\b/gi, replacement: "beach attendant" },
  { pattern: /\bmaid\b/gi, replacement: "maid" },
  { pattern: /\bmystic\b/gi, replacement: "mystic warrior" },
  { pattern: /\bqueen\b/gi, replacement: "royal queen" },
  { pattern: /\bgoddess\b/gi, replacement: "goddess" },
];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

const isDigitsOnly = (value: string): boolean => /^\d+$/.test(normalizeText(value));

const normalizeTag = (value: string): string =>
  normalizeText(value.normalize("NFKD").replace(/[^\x00-\x7F]/g, " ").replace(/[^a-zA-Z0-9\s/-]+/g, " ")).toLowerCase();

const normalizePhrase = (value: string): string =>
  normalizeText(value.normalize("NFKD").replace(/[^\x00-\x7F]/g, " ").replace(/[^a-zA-Z0-9\s-]+/g, " "));

const toTitleCase = (value: string): string =>
  normalizeText(value)
    .split(/\s+/)
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : ""))
    .join(" ");

const applyDisplayReplacements = (value: string): string => {
  let next = value.normalize("NFKD").replace(/[^\x00-\x7F]/g, " ");
  for (const { pattern, replacement } of DISPLAY_REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }

  return next;
};

const collapseRepeatedSegments = (value: string): string => {
  let next = value;
  next = next.replace(/\b([a-z]+)(?:\s+\1\b)+/gi, "$1");
  next = next.replace(/\b(character art)(?:\s+\1\b)+/gi, "$1");
  next = next.replace(/\b(anime)(?:\s+\1\b)+/gi, "$1");
  next = next.replace(/\b(fast food restaurant)(?:\s+\1\b)+/gi, "$1");
  return next;
};

const cleanupDisplayText = (value: string): string =>
  normalizeText(
    collapseRepeatedSegments(
      applyDisplayReplacements(value)
        .replace(/[|/]+/g, " ")
        .replace(/\s*[-:|]\s*/g, " ")
        .replace(/\s*,\s*/g, ", ")
        .replace(/\s*\.\s*/g, ". ")
        .replace(/\s+/g, " ")
    )
      .replace(/\b(anime)\s+(character art)\b/gi, "anime character art")
      .replace(/\b(character art)\s+(anime)\b/gi, "anime character art")
      .replace(/\b(outfit)\s+(outfit)\b/gi, "outfit")
      .replace(/\b(fast food restaurant)\s+(restaurant)\b/gi, "fast food restaurant")
      .replace(/\s+,/g, ",")
      .replace(/\s+\./g, ".")
  );

const containsDisplayHighRisk = (value: string): boolean =>
  DISPLAY_HIGH_RISK_PATTERNS.some((pattern) => pattern.test(value));

const hasTitleStylingBlocklist = (value: string): boolean =>
  STYLING_TITLE_BLOCKLIST.some((pattern) => pattern.test(value));

const dedupeWords = (value: string): string => {
  const words = normalizeText(value).split(/\s+/);
  const result: string[] = [];
  for (const word of words) {
    if (result[result.length - 1]?.toLowerCase() === word.toLowerCase()) {
      continue;
    }
    result.push(word);
  }
  return result.join(" ");
};

const sanitizeTitle = (value: string): string => {
  let sanitized = value.normalize("NFKD").replace(/[^\x00-\x7F]/g, " ");
  for (const pattern of BANNED_TITLE_PATTERNS) {
    sanitized = sanitized.replace(pattern, " ");
  }
  sanitized = sanitized
    .replace(/^\d+\s*[-:|]?\s*/g, "")
    .replace(/\s*[-:|]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized;
};

const sanitizeDisplayTitle = (value: string): string =>
  toTitleCase(
    dedupeWords(
      cleanupDisplayText(sanitizeTitle(value))
        .replace(/\b(character art)\b/gi, "character art")
        .replace(/\b(anime)\b/gi, "anime")
    )
  );

const sanitizeTagCandidate = (value: string): string => {
  let next = cleanupDisplayText(value);
  for (const { pattern, replacement } of STYLING_TAG_REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }
  const normalized = next
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]+/g, " ");
  return normalizeText(dedupeWords(normalized));
};

const isGenericTitle = (value: string): boolean => {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return true;
  }
  if (GENERIC_TITLE_VALUES.has(normalized)) {
    return true;
  }

  const informativeWords = normalized
    .split(/\s+/)
    .filter((word) => word && !TITLE_STOPWORDS.has(word) && word.length > 2);
  return informativeWords.length < 2;
};

const isWeakTitle = (value: string): boolean => {
  const normalized = normalizeText(value);
  return !normalized || normalized.length < 8 || containsDisplayHighRisk(normalized) || hasTitleStylingBlocklist(normalized) || isGenericTitle(normalized);
};

const uniqueTags = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = sanitizeTagCandidate(value);
    if (
      !normalized ||
      seen.has(normalized) ||
      normalized.length > 48 ||
      normalized.length < 3 ||
      containsDisplayHighRisk(normalized) ||
      BANNED_TAG_PATTERNS.some((pattern) => pattern.test(normalized))
    ) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
};

const getMetadataContainer = (metadata: GalleryImageMetadata): MetadataContainer => {
  if (metadata.metadata == null) {
    return {};
  }
  if (!isPlainObject(metadata.metadata)) {
    throw new Error('Invalid metadata field "metadata": expected object');
  }
  return metadata.metadata as MetadataContainer;
};

const getFallbackTitleCandidates = (filePath: string, metadataContainer: MetadataContainer): Set<string> => {
  const basename = path.basename(filePath, path.extname(filePath));
  const filename = typeof metadataContainer.filename === "string" ? metadataContainer.filename : path.basename(filePath);
  return new Set(
    [basename, filename, slugToTitle(filename), slugToTitle(filePath)]
      .map((value) => normalizeText(value).toLowerCase())
      .filter(Boolean)
  );
};

const isAutoGeneratedTitle = (metadata: GalleryImageMetadata, filePath: string, metadataContainer: MetadataContainer): boolean => {
  const title = normalizeText(metadata.title ?? "");
  if (!title) {
    return true;
  }
  return isDigitsOnly(title) || getFallbackTitleCandidates(filePath, metadataContainer).has(title.toLowerCase());
};

const isAutoGeneratedDescription = (metadata: GalleryImageMetadata): boolean => {
  const description = normalizeText(metadata.description ?? "");
  if (!description) {
    return true;
  }
  return /^auto generated metadata for\b/i.test(description);
};

const isFallbackTags = (metadata: GalleryImageMetadata, filePath: string, metadataContainer: MetadataContainer): boolean => {
  const tags = metadata.tags ?? [];
  if (tags.length === 0) {
    return true;
  }

  if (tags.every((tag) => /^\d+$/.test(normalizeText(tag)))) {
    return true;
  }

  const fallbackTokens = Array.from(getFallbackTitleCandidates(filePath, metadataContainer))
    .flatMap((value) => value.split(/[\s_-]+/))
    .map((value) => normalizeTag(value))
    .filter(Boolean);
  const fallbackSet = new Set(fallbackTokens);

  return tags.every((tag) => fallbackSet.has(normalizeTag(tag)));
};

const isFallbackStyle = (style: string | null | undefined, filePath: string, metadataContainer: MetadataContainer): boolean => {
  const normalized = normalizeText(style ?? "").toLowerCase();
  if (!normalized) {
    return true;
  }
  return GENERIC_STYLE_VALUES.has(normalized) || getFallbackTitleCandidates(filePath, metadataContainer).has(normalized);
};

const isFallbackRarity = (rarity: string | null | undefined, filePath: string, metadataContainer: MetadataContainer): boolean => {
  const normalized = normalizeText(rarity ?? "").toLowerCase();
  if (!normalized) {
    return true;
  }
  return isDigitsOnly(normalized) || getFallbackTitleCandidates(filePath, metadataContainer).has(normalized);
};

const isFallbackCategory = (category: string | null | undefined, filePath: string, metadataContainer: MetadataContainer): boolean => {
  const normalized = normalizeText(category ?? "").toLowerCase();
  if (!normalized) {
    return true;
  }
  return GENERIC_CATEGORIES.has(normalized) || getFallbackTitleCandidates(filePath, metadataContainer).has(normalized);
};

const isFallbackCharacter = (
  character: string | null | undefined,
  filePath: string,
  metadataContainer: MetadataContainer
): boolean => {
  const normalized = normalizeText(character ?? "").toLowerCase();
  if (!normalized) {
    return true;
  }
  return GENERIC_CHARACTER_VALUES.has(normalized) || getFallbackTitleCandidates(filePath, metadataContainer).has(normalized);
};

const isFallbackColor = (color: string | null | undefined, filePath: string, metadataContainer: MetadataContainer): boolean => {
  const normalized = normalizeText(color ?? "").toLowerCase();
  if (!normalized) {
    return true;
  }
  return isDigitsOnly(normalized) || getFallbackTitleCandidates(filePath, metadataContainer).has(normalized);
};

const hasFallbackLikeManagedFields = (
  metadata: GalleryImageMetadata,
  filePath: string,
  metadataContainer: MetadataContainer
): boolean =>
  isAutoGeneratedTitle(metadata, filePath, metadataContainer) ||
  isAutoGeneratedDescription(metadata) ||
  isFallbackTags(metadata, filePath, metadataContainer) ||
  isFallbackStyle(metadata.style, filePath, metadataContainer) ||
  isFallbackRarity(metadata.rarity, filePath, metadataContainer) ||
  isFallbackCategory(metadata.category, filePath, metadataContainer) ||
  isFallbackCharacter(metadata.character, filePath, metadataContainer) ||
  isFallbackColor(metadata.color, filePath, metadataContainer);

const isProtectedReadableTitle = (
  title: string | null | undefined,
  filePath: string,
  metadataContainer: MetadataContainer
): boolean => {
  const normalized = normalizeText(title ?? "");
  if (!normalized) {
    return false;
  }
  return !isWeakTitle(normalized) && !isAutoGeneratedTitle({ title: normalized }, filePath, metadataContainer);
};

const pickMeaningfulPhrase = (values: string[], stopwords: Set<string>): string | null => {
  for (const value of values) {
    const candidate = normalizeText(cleanupDisplayText(value).toLowerCase());
    if (!candidate || containsDisplayHighRisk(candidate)) {
      continue;
    }
    const informativeWords = candidate
      .split(/\s+/)
      .filter((word) => word && !stopwords.has(word) && word.length > 2);
    if (informativeWords.length > 0) {
      return candidate;
    }
  }
  return null;
};

const titleCasePhrase = (value: string): string => toTitleCase(normalizeText(value).replace(/-/g, " "));

const countTitleWords = (value: string): number => normalizeText(value).split(/\s+/).filter(Boolean).length;

const stripTitlePatterns = (value: string, patterns: RegExp[]): string => {
  let next = value;
  for (const pattern of patterns) {
    next = next.replace(pattern, " ");
  }
  return normalizeText(next);
};

const extractCue = (
  values: string[],
  patterns: Array<{ pattern: RegExp; phrase: string }>
): string | null => {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) {
      continue;
    }
    for (const { pattern, phrase } of patterns) {
      if (pattern.test(normalized)) {
        return phrase;
      }
    }
  }
  return null;
};

const dedupeTitlePhrases = (phrases: string[]): string[] => {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const phrase of phrases) {
    const normalized = normalizeText(phrase.toLowerCase());
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
};

const hasSearchableCue = (value: string): boolean => {
  const normalized = normalizeText(value.toLowerCase());
  if (!normalized) {
    return false;
  }
  return (
    TITLE_POLISH_ROLE_PATTERNS.some(({ pattern }) => pattern.test(normalized)) ||
    TITLE_POLISH_SCENE_PATTERNS.some(({ pattern }) => pattern.test(normalized)) ||
    TITLE_POLISH_VISUAL_PATTERNS.some(({ pattern }) => pattern.test(normalized))
  );
};

const isMachineyTitle = (value: string): boolean => {
  const normalized = normalizeText(value.toLowerCase());
  if (!normalized) {
    return true;
  }
  return (
    normalized === "maid bedroom" ||
    normalized === "anime girl" ||
    /\bcharacter art warrior\b/i.test(normalized) ||
    /\bheroine character art\b/i.test(normalized)
  );
};

const normalizeTitleCandidate = (value: string): string => {
  let next = cleanupDisplayText(value).toLowerCase();
  next = stripTitlePatterns(next, TITLE_BANNED_PATTERNS);
  next = stripTitlePatterns(next, TITLE_LOW_VALUE_PATTERNS);
  next = next
    .replace(/\banime\b/gi, " anime ")
    .replace(/\bportrait portrait\b/gi, "portrait")
    .replace(/\bheroine heroine\b/gi, "heroine")
    .replace(/\bmaid maid\b/gi, "maid")
    .replace(/\s+/g, " ");
  return normalizeText(next);
};

const buildPolishedTitle = (parts: {
  styleCue?: string | null;
  sceneCue?: string | null;
  visualCue?: string | null;
  roleCue?: string | null;
  keepAnime?: boolean;
}): string => {
  const phrases: string[] = [];
  const normalizedScene = normalizeText(parts.sceneCue ?? "");
  const normalizedVisual = normalizeText(parts.visualCue ?? "");
  const normalizedRole = normalizeText(parts.roleCue ?? "");
  const normalizedStyle = normalizeText(parts.styleCue ?? "");

  if (normalizedScene === "luxury bedroom") {
    phrases.push("luxury bedroom");
    if (normalizedRole && normalizedRole !== "maid") {
      phrases.push(normalizedRole);
    } else if (normalizedRole === "maid") {
      phrases.push("maid");
      phrases.push("portrait");
    } else {
      phrases.push("heroine");
    }
  } else if (normalizedScene === "fast food") {
    if (normalizedStyle) {
      phrases.push(normalizedStyle);
    }
    phrases.push("fast food");
    phrases.push(normalizedRole || "maid");
  } else if (normalizedScene === "bedroom") {
    phrases.push("bedroom");
    if (normalizedRole) {
      phrases.push(normalizedRole);
      if (normalizedRole === "maid") {
        phrases.push("portrait");
      }
    } else {
      phrases.push("heroine");
    }
  } else {
    if (normalizedStyle) {
      phrases.push(normalizedStyle);
    }
    if (normalizedScene) {
      phrases.push(normalizedScene);
    } else if (normalizedVisual) {
      phrases.push(normalizedVisual);
    }
    if (normalizedRole) {
      phrases.push(normalizedRole);
    } else if (!normalizedScene && normalizedVisual) {
      phrases.push("heroine");
    }
  }

  if (!normalizedScene && normalizedVisual && normalizedRole && !phrases.includes(normalizedVisual)) {
    phrases.splice(Math.min(phrases.length, normalizedStyle ? 1 : 0), 0, normalizedVisual);
  }

  if (parts.keepAnime && !phrases.includes("anime")) {
    phrases.push("anime");
  }

  let deduped = dedupeTitlePhrases(phrases);
  while (deduped.length > 5) {
    const removableIndex =
      deduped.findIndex((phrase) => TITLE_ALLOWED_STYLING_CUES.has(phrase)) >= 0
        ? deduped.findIndex((phrase) => TITLE_ALLOWED_STYLING_CUES.has(phrase))
        : deduped.findIndex((phrase) => phrase === "anime" || phrase === "portrait");
    if (removableIndex < 0) {
      deduped = deduped.slice(0, 5);
      break;
    }
    deduped.splice(removableIndex, 1);
  }

  if (deduped.length < 3 && !deduped.includes("portrait")) {
    deduped.push("portrait");
  }
  if (deduped.length < 3 && !deduped.includes("anime")) {
    deduped.push("anime");
  }

  return titleCasePhrase(deduped.join(" "));
};

const polishTitle = (
  currentTitle: string,
  intelligence: GalleryMetadataIntelligence,
  commerceNaming: GalleryCommerceNaming
): string => {
  const normalizedCurrent = normalizeTitleCandidate(currentTitle);
  const titleValues = [
    normalizedCurrent,
    sanitizeTagCandidate(commerceNaming.displayTitle),
    sanitizeTagCandidate(commerceNaming.shortName),
    ...intelligence.commerceLayer.searchKeywords.map((value) => sanitizeTagCandidate(value)),
    ...intelligence.characterLayer.archetypeTags.map((value) => sanitizeTagCandidate(value)),
    ...intelligence.worldbuildingLayer.settingTags.map((value) => sanitizeTagCandidate(value)),
    ...intelligence.visualLayer.primaryColors.map((value) => sanitizeTagCandidate(value)),
  ].filter(Boolean) as string[];

  const roleCue = extractCue(titleValues, TITLE_POLISH_ROLE_PATTERNS) ?? "heroine";
  const sceneCue = extractCue(titleValues, TITLE_POLISH_SCENE_PATTERNS);
  const visualCue = extractCue(titleValues, TITLE_POLISH_VISUAL_PATTERNS);
  const styleCue = TITLE_STYLE_CUES.find((cue) => normalizedCurrent.includes(cue)) ?? pickTitleStyleCue(intelligence);
  const keepAnime = !sceneCue && !visualCue && !roleCue;

  let candidate = buildPolishedTitle({
    styleCue: styleCue ? (TITLE_ALLOWED_STYLING_CUES.has(styleCue) ? styleCue : null) : null,
    sceneCue,
    visualCue,
    roleCue,
    keepAnime,
  });

  candidate = sanitizeDisplayTitle(candidate);
  const wordCount = countTitleWords(candidate);
  if (
    wordCount < 3 ||
    wordCount > 5 ||
    !hasSearchableCue(candidate) ||
    isMachineyTitle(candidate) ||
    containsDisplayHighRisk(candidate) ||
    hasTitleStylingBlocklist(candidate)
  ) {
    const fallback = buildPolishedTitle({
      sceneCue,
      visualCue,
      roleCue,
      keepAnime: !sceneCue && !visualCue,
    });
    const cleanedFallback = sanitizeDisplayTitle(fallback);
    if (
      countTitleWords(cleanedFallback) >= 3 &&
      countTitleWords(cleanedFallback) <= 5 &&
      hasSearchableCue(cleanedFallback) &&
      !isMachineyTitle(cleanedFallback) &&
      !containsDisplayHighRisk(cleanedFallback) &&
      !hasTitleStylingBlocklist(cleanedFallback)
    ) {
      return cleanedFallback;
    }
  }

  if (!hasSearchableCue(candidate) && !candidate.toLowerCase().includes("anime")) {
    candidate = sanitizeDisplayTitle(`${candidate} Anime`);
  }

  if (countTitleWords(candidate) < 3) {
    candidate = sanitizeDisplayTitle(`${candidate} Portrait`);
  }

  return sanitizeDisplayTitle(candidate);
};

const pickFromPatterns = (values: string[], patterns: RegExp[]): string | null => {
  for (const value of values) {
    const candidate = sanitizeTagCandidate(value);
    if (!candidate) {
      continue;
    }
    if (patterns.some((pattern) => pattern.test(candidate))) {
      return candidate;
    }
  }
  return null;
};

const pickSearchRole = (intelligence: GalleryMetadataIntelligence): string | null => {
  const values = [
    ...intelligence.characterLayer.archetypeTags,
    intelligence.characterLayer.entityType,
    ...intelligence.commerceLayer.searchKeywords,
    ...intelligence.worldbuildingLayer.genreTags,
  ].filter(Boolean) as string[];

  const explicitRole =
    pickFromPatterns(values, [/\bmaid\b/i, /\bqueen\b/i, /\bgoddess\b/i, /\bwarrior\b/i, /\bheroine\b/i, /\battendant\b/i, /\bmystic\b/i]) ??
    pickMeaningfulPhrase(values, TITLE_STOPWORDS);
  return explicitRole ? sanitizeTagCandidate(explicitRole) : null;
};

const pickSearchScene = (intelligence: GalleryMetadataIntelligence): string | null => {
  const values = [
    ...intelligence.worldbuildingLayer.settingTags,
    ...intelligence.commerceLayer.searchKeywords,
    ...intelligence.visualLayer.styleTags,
  ];
  const explicitScene =
    pickFromPatterns(values, [/\bbeach\b/i, /\bshrine\b/i, /\bkimono\b/i, /\bfantasy\b/i, /\bblack gold\b/i, /\bblue hair\b/i, /\bbedroom\b/i, /\bgothic\b/i, /\bfast food\b/i, /\bpalace\b/i]) ??
    pickMeaningfulPhrase(values, TITLE_STOPWORDS);
  return explicitScene ? sanitizeTagCandidate(explicitScene) : null;
};

const pickTitleStyleCue = (intelligence: GalleryMetadataIntelligence): string | null => {
  const candidates = [
    ...intelligence.emotionalLayer.toneTags,
    ...intelligence.emotionalLayer.moodTags,
    ...intelligence.visualLayer.primaryColors,
    ...intelligence.worldbuildingLayer.settingTags,
  ].map((value) => sanitizeTagCandidate(value));

  for (const cue of TITLE_STYLE_CUES) {
    if (candidates.some((candidate) => candidate.includes(cue))) {
      return cue;
    }
  }

  const color = sanitizeTagCandidate(intelligence.visualLayer.primaryColors[0] ?? "");
  if (color === "blue") return "azure";
  if (color === "purple") return "violet";
  if (color === "red") return "crimson";
  if (color === "gold") return "golden";
  return "elegant";
};

const buildStyledTitle = (
  currentTitle: string,
  intelligence: GalleryMetadataIntelligence,
  commerceNaming: GalleryCommerceNaming
): string => {
  const cleanedCurrent = sanitizeDisplayTitle(currentTitle);
  const role = pickSearchRole(intelligence);
  const scene = pickSearchScene(intelligence);
  const styleCue = pickTitleStyleCue(intelligence);

  const currentWords = sanitizeTagCandidate(cleanedCurrent)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  const roleWords = role ? titleCasePhrase(role).split(/\s+/) : [];
  const sceneWords = scene ? titleCasePhrase(scene).split(/\s+/) : [];

  const assembled: string[] = [];
  if (styleCue && !currentWords.some((word) => word.toLowerCase() === styleCue)) {
    assembled.push(titleCasePhrase(styleCue));
  }
  for (const word of roleWords) {
    if (!assembled.some((item) => item.toLowerCase() === word.toLowerCase())) {
      assembled.push(word);
    }
  }
  for (const word of sceneWords) {
    if (!assembled.some((item) => item.toLowerCase() === word.toLowerCase())) {
      assembled.push(word);
    }
  }

  const searchableFallback = currentWords
    .map((word) => titleCasePhrase(word))
    .filter((word) => TITLE_SEARCH_WORDS.has(word.toLowerCase()) || roleWords.some((roleWord) => roleWord.toLowerCase() === word.toLowerCase()));
  for (const word of searchableFallback) {
    if (!assembled.some((item) => item.toLowerCase() === word.toLowerCase())) {
      assembled.push(word);
    }
  }

  let candidate = assembled.join(" ");
  candidate = sanitizeDisplayTitle(candidate);
  if (isWeakTitle(candidate)) {
    const shortName = sanitizeDisplayTitle(commerceNaming.shortName);
    if (!isWeakTitle(shortName)) {
      return shortName;
    }
    return cleanedCurrent;
  }

  return polishTitle(candidate, intelligence, commerceNaming);
};

const formatColors = (values: string[]): string | null => {
  const colors = uniqueTags(values).slice(0, 2);
  if (colors.length === 0) {
    return null;
  }
  if (colors.length === 1) {
    return `${colors[0]} tones`;
  }
  return `${colors[0]} and ${colors[1]} tones`;
};

const buildDescription = (intelligence: GalleryMetadataIntelligence): string => {
  const style = pickMeaningfulPhrase(intelligence.visualLayer.styleTags, DESCRIPTION_STOPWORDS) ?? "anime";
  const colors = formatColors(intelligence.visualLayer.primaryColors) ?? "elegant colors";
  const role =
    pickSearchRole(intelligence) ??
    pickMeaningfulPhrase(intelligence.characterLayer.archetypeTags, DESCRIPTION_STOPWORDS) ??
    "character";
  const setting =
    pickSearchScene(intelligence) ??
    pickMeaningfulPhrase(intelligence.worldbuildingLayer.settingTags, DESCRIPTION_STOPWORDS) ??
    "fantasy scene";
  const mood =
    pickMeaningfulPhrase(intelligence.emotionalLayer.toneTags, DESCRIPTION_STOPWORDS) ??
    pickMeaningfulPhrase(intelligence.emotionalLayer.moodTags, DESCRIPTION_STOPWORDS) ??
    "refined";

  const sentence = `A collectible ${style} card with ${colors}, ${mood} styling, and a polished ${titleCasePhrase(role).toLowerCase()} showcase inspired by ${titleCasePhrase(setting).toLowerCase()} scenes.`;
  return normalizeText(
    cleanupDisplayText(sentence)
      .replace(/\bcharacter character\b/gi, "character")
      .replace(/\bscenes scenes\b/gi, "scenes")
      .replace(/\binspired by ([a-z\s]+) scenes scenes\b/gi, "inspired by $1 scenes")
  );
};

const buildTags = (
  intelligence: GalleryMetadataIntelligence,
  commerceNaming: GalleryCommerceNaming,
  title: string
): string[] =>
  uniqueTags([
    title,
    commerceNaming.shortName,
    commerceNaming.displayTitle,
    ...intelligence.commerceLayer.searchKeywords,
    ...intelligence.emotionalLayer.moodTags,
    ...intelligence.emotionalLayer.toneTags,
    ...intelligence.characterLayer.archetypeTags,
    intelligence.characterLayer.entityType,
    ...intelligence.worldbuildingLayer.settingTags,
    ...intelligence.worldbuildingLayer.genreTags,
    ...intelligence.visualLayer.styleTags,
  ]).slice(0, 15);

const inferRarity = (
  intelligence: GalleryMetadataIntelligence,
  currentRarity: string | null | undefined
): string | null => {
  const hooks = intelligence.commerceLayer.collectorHooks.join(" ");
  if (UR_HOOK_PATTERNS.some((pattern) => pattern.test(hooks))) {
    return "UR";
  }
  if (SSR_HOOK_PATTERNS.some((pattern) => pattern.test(hooks))) {
    return "SSR";
  }
  return currentRarity?.trim() || null;
};

const buildSafeCharacter = (intelligence: GalleryMetadataIntelligence): string => {
  const entity = normalizeText(cleanupDisplayText(intelligence.characterLayer.entityType));
  let archetype = normalizeText(cleanupDisplayText(intelligence.characterLayer.archetypeTags[0] ?? ""));
  for (const { pattern, replacement } of CHARACTER_REFINEMENTS) {
    archetype = archetype.replace(pattern, replacement);
  }
  let safeArchetype = !archetype || containsDisplayHighRisk(archetype) ? "" : archetype.toLowerCase();
  safeArchetype = safeArchetype
    .replace(/\bhumanoid\b/gi, "")
    .replace(/\bhuman female\b/gi, "female")
    .replace(/\bhuman\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const value = [entity.toLowerCase().replace(/\bhuman female\b/gi, "female").replace(/\bhumanoid\b/gi, "").trim(), safeArchetype]
    .filter(Boolean)
    .join(" ");
  const cleaned = normalizeText(cleanupDisplayText(value));
  return cleaned.slice(0, 120);
};

const buildSafeTitleFromIntelligence = (
  intelligence: GalleryMetadataIntelligence,
  commerceNaming: GalleryCommerceNaming
): string => {
  const searchKeywords = uniqueTags(intelligence.commerceLayer.searchKeywords);
  const titleKeyword = searchKeywords.find((keyword) => !containsDisplayHighRisk(keyword) && !isGenericTitle(keyword));
  if (titleKeyword) {
    return toTitleCase(titleKeyword);
  }

  const colorCue = formatColors(intelligence.visualLayer.primaryColors)?.replace(/\stones$/i, "") ?? "";
  const archetype =
    pickMeaningfulPhrase(intelligence.characterLayer.archetypeTags, TITLE_STOPWORDS) ??
    pickMeaningfulPhrase([intelligence.characterLayer.entityType], TITLE_STOPWORDS) ??
    "";
  const setting =
    pickMeaningfulPhrase(intelligence.worldbuildingLayer.settingTags, TITLE_STOPWORDS) ??
    pickMeaningfulPhrase(intelligence.visualLayer.styleTags, TITLE_STOPWORDS) ??
    "";
  const combined = [colorCue, archetype, setting].filter(Boolean).join(" ");
  const fromCombined = sanitizeDisplayTitle(combined);
  if (!isWeakTitle(fromCombined)) {
    return fromCombined;
  }

  const shortName = sanitizeDisplayTitle(commerceNaming.shortName);
  if (!isWeakTitle(shortName)) {
    return shortName;
  }

  return "Stylish Anime Character";
};

const buildStyle = (intelligence: GalleryMetadataIntelligence, currentStyle: string | null | undefined): string | null => {
  const style = normalizeText(intelligence.visualLayer.styleTags[0] ?? "");
  if (style) {
    return style;
  }
  return normalizeText(currentStyle ?? "") || null;
};

const buildCategory = (
  intelligence: GalleryMetadataIntelligence,
  currentCategory: string | null | undefined
): string | null => {
  const commerceCategory = normalizeText(intelligence.commerceLayer.category ?? "");
  if (commerceCategory) {
    return commerceCategory;
  }
  return normalizeText(currentCategory ?? "") || null;
};

const buildColor = (intelligence: GalleryMetadataIntelligence, currentColor: string | null | undefined): string | null => {
  const colors = uniqueTags(intelligence.visualLayer.primaryColors).slice(0, 4);
  if (colors.length > 0) {
    return colors.join(" ");
  }
  return normalizeText(currentColor ?? "") || null;
};

const deepEqual = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

export const galleryBaseMetadataFillService = {
  buildFilledMetadata(input: {
    filePath: string;
    metadata: GalleryImageMetadata;
    audit: GalleryMetadataAuditResult;
    force?: boolean;
  }): BaseMetadataFillResult {
    const metadataContainer = getMetadataContainer(input.metadata);
    const reasons: string[] = [];
    const force = input.force === true;
    const fallbackLike = hasFallbackLikeManagedFields(input.metadata, input.filePath, metadataContainer);

    if (metadataContainer.source !== "filename-fallback" && !fallbackLike) {
      reasons.push("metadata is not filename-fallback or fallback-like");
    }

    if (input.audit.needsHumanReview) {
      reasons.push("metadata audit requires human review");
    }

    const intelligence = metadataContainer.intelligence;
    const commerceNaming = metadataContainer.commerceNaming;
    if (!intelligence || !commerceNaming) {
      reasons.push("missing metadata.intelligence or metadata.commerceNaming");
    }

    if (reasons.length > 0 || !intelligence || !commerceNaming) {
      return {
        eligible: false,
        reasons,
        next: input.metadata,
        changedFields: [],
      };
    }

    const next: GalleryImageMetadata = {
      ...input.metadata,
      price: input.metadata.price,
      metadata: metadataContainer,
    };
    const changedFields: string[] = [];

    const pushChangedField = (field: string): void => {
      if (!changedFields.includes(field)) {
        changedFields.push(field);
      }
    };

    const shouldRewriteTitle =
      isAutoGeneratedTitle(input.metadata, input.filePath, metadataContainer) ||
      (force && !isProtectedReadableTitle(input.metadata.title, input.filePath, metadataContainer));

    if (shouldRewriteTitle) {
      const cleanedDisplayTitle = sanitizeDisplayTitle(commerceNaming.displayTitle);
      const fallbackTitle = isWeakTitle(cleanedDisplayTitle)
        ? buildSafeTitleFromIntelligence(intelligence, commerceNaming)
        : cleanedDisplayTitle;
      const nextTitle = buildStyledTitle(fallbackTitle, intelligence, commerceNaming);
      if (nextTitle && next.title !== nextTitle) {
        next.title = nextTitle;
        pushChangedField("title");
      }
    }

    if (isAutoGeneratedDescription(input.metadata)) {
      const nextDescription = buildDescription(intelligence);
      if (next.description !== nextDescription) {
        next.description = nextDescription;
        pushChangedField("description");
      }
    }

    if (isFallbackTags(input.metadata, input.filePath, metadataContainer)) {
      const nextTags = buildTags(intelligence, commerceNaming, next.title ?? input.metadata.title ?? "");
      if (!deepEqual(input.metadata.tags ?? [], nextTags)) {
        next.tags = nextTags;
        pushChangedField("tags");
      }
    }

    if (isFallbackStyle(input.metadata.style, input.filePath, metadataContainer)) {
      const nextStyle = buildStyle(intelligence, input.metadata.style);
      if ((next.style ?? null) !== (nextStyle ?? null)) {
        next.style = nextStyle;
        pushChangedField("style");
      }
    }

    if (isFallbackRarity(input.metadata.rarity, input.filePath, metadataContainer)) {
      const nextRarity = inferRarity(intelligence, input.metadata.rarity);
      if (nextRarity && (next.rarity ?? null) !== nextRarity) {
        next.rarity = nextRarity;
        pushChangedField("rarity");
      }
    }

    if (isFallbackCategory(input.metadata.category, input.filePath, metadataContainer)) {
      const nextCategory = buildCategory(intelligence, input.metadata.category);
      if ((next.category ?? null) !== (nextCategory ?? null)) {
        next.category = nextCategory;
        pushChangedField("category");
      }
    }

    if (isFallbackCharacter(input.metadata.character, input.filePath, metadataContainer)) {
      const nextCharacter = buildSafeCharacter(intelligence);
      if ((next.character ?? null) !== (nextCharacter ?? null)) {
        next.character = nextCharacter;
        pushChangedField("character");
      }
    }

    if (isFallbackColor(input.metadata.color, input.filePath, metadataContainer)) {
      const nextColor = buildColor(intelligence, input.metadata.color);
      if ((next.color ?? null) !== (nextColor ?? null)) {
        next.color = nextColor;
        pushChangedField("color");
      }
    }

    if (changedFields.length === 0) {
      reasons.push("no fallback top-level fields required updates");
    }

    return {
      eligible: true,
      reasons,
      next,
      changedFields,
    };
  },

  assertSafeStructure(before: GalleryImageMetadata, after: GalleryImageMetadata): void {
    const beforeMetadata = getMetadataContainer(before);
    const afterMetadata = getMetadataContainer(after);

    if (!deepEqual(beforeMetadata.intelligence ?? null, afterMetadata.intelligence ?? null)) {
      throw new Error("metadata.intelligence changed during base metadata fill");
    }
    if (!deepEqual(beforeMetadata.commerceNaming ?? null, afterMetadata.commerceNaming ?? null)) {
      throw new Error("metadata.commerceNaming changed during base metadata fill");
    }

    const beforeMetadataKeys = Object.keys(beforeMetadata).sort();
    const afterMetadataKeys = Object.keys(afterMetadata).sort();
    if (!deepEqual(beforeMetadataKeys, afterMetadataKeys)) {
      throw new Error("metadata key structure changed during base metadata fill");
    }
  },
};
