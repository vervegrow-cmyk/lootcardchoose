import { Prisma } from "@prisma/client";
import { loadEnv } from "../config/env";
import { logger } from "../utils/logger";

export const PRODUCT_TITLE_NAMING_TIMEOUT_MS = 6000;

export type CardNamingSource = {
  title?: string;
  description?: string | null;
  tags?: string[];
  style?: string | null;
  rarity?: string | null;
  category?: string | null;
  character?: string | null;
  color?: string | null;
  metadata?: Prisma.JsonValue | Record<string, unknown> | null;
  sourceId?: string;
};

export type GenerateMarketingTitleInput = CardNamingSource;

export type GenerateMarketingTitleOutput = {
  marketingTitle: string;
  source: "llm" | "fallback";
  rawTitle?: string;
};

type DeepSeekMessage = {
  role: "system" | "user";
  content: string;
};

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

type NamingPayload = {
  title: string;
  description: string | null;
  tags: string[];
  style: string | null;
  rarity: string | null;
  category: string | null;
  character: string | null;
  color: string | null;
  metadata: Prisma.JsonValue | Record<string, unknown> | null;
  sourceId: string | null;
};

const TECHNICAL_TERMS = new Set([
  "shopify",
  "product",
  "variant",
  "order",
  "sku",
  "gid",
  "http",
  "https",
  "admin",
  "graphql",
  "lootcard",
]);

const DESCRIPTOR_STOPWORDS = new Set([
  "anime",
  "trading",
  "collectible",
  "card",
  "premium",
  "luxury",
  "female",
  "male",
  "character",
  "girl",
  "boy",
  "woman",
  "man",
  "lady",
  "heroine",
  "champion",
  "queen",
  "empress",
  "valkyrie",
  "princess",
  "warrior",
  "angel",
  "demon",
  "goddess",
  "figure",
  "portrait",
  "art",
  "illustration",
  "beautiful",
  "beauty",
]);

const GENERIC_TITLE_TERMS = new Set([
  "anime",
  "trading",
  "collectible",
  "card",
  "premium",
  "female",
  "male",
  "character",
  "girl",
  "boy",
  "lootcard",
]);

const ARCHETYPE_PATTERNS: Array<{ pattern: RegExp; values: string[] }> = [
  { pattern: /\bempress\b/i, values: ["Empress"] },
  { pattern: /\bqueen\b/i, values: ["Queen"] },
  { pattern: /\bvalkyrie\b/i, values: ["Valkyrie"] },
  { pattern: /\bprincess\b/i, values: ["Princess"] },
  { pattern: /\bsorceress\b|\bwitch\b/i, values: ["Sorceress", "Witch"] },
  { pattern: /\bangel\b/i, values: ["Angel"] },
  { pattern: /\bdemon\b/i, values: ["Demon"] },
  { pattern: /\bgoddess\b/i, values: ["Goddess"] },
  { pattern: /\bwarrior\b/i, values: ["Warrior", "Valkyrie"] },
  { pattern: /\bdragon\b/i, values: ["Empress", "Valkyrie"] },
  { pattern: /\bmecha\b|\brobot\b/i, values: ["Phantom", "Vanguard"] },
  { pattern: /\bphantom\b/i, values: ["Phantom"] },
  { pattern: /\bheroine\b/i, values: ["Heroine"] },
];

const COLOR_THEME_PATTERNS: Array<{ pattern: RegExp; values: string[] }> = [
  { pattern: /\bblack gold\b|\bgold black\b/i, values: ["Shadow", "Obsidian", "Eclipse"] },
  { pattern: /\bblack\b/i, values: ["Midnight", "Obsidian", "Shadow"] },
  { pattern: /\bgold\b|\bgolden\b/i, values: ["Golden", "Radiant"] },
  { pattern: /\bpurple\b|\bviolet\b/i, values: ["Midnight", "Violet"] },
  { pattern: /\bred\b|\bcrimson\b|\bscarlet\b/i, values: ["Crimson", "Scarlet"] },
  { pattern: /\bsilver\b|\bchrome\b/i, values: ["Silver", "Lunar"] },
  { pattern: /\bblue\b|\bsapphire\b/i, values: ["Sapphire", "Azure"] },
  { pattern: /\bgreen\b|\bemerald\b/i, values: ["Emerald", "Verdant"] },
  { pattern: /\bwhite\b|\bivory\b/i, values: ["Ivory", "Celestial"] },
];

const STYLE_THEME_PATTERNS: Array<{ pattern: RegExp; values: string[] }> = [
  { pattern: /\bcyberpunk\b|\bneon\b/i, values: ["Neon", "Neo"] },
  { pattern: /\bmecha\b|\brobot\b/i, values: ["Core", "Phantom"] },
  { pattern: /\bfantasy\b|\bmythic\b|\bmystic\b/i, values: ["Mythic", "Celestial"] },
  { pattern: /\bdragon\b|\bflame\b/i, values: ["Dragon", "Crimson"] },
  { pattern: /\bgothic\b|\bdark\b/i, values: ["Midnight", "Obsidian"] },
  { pattern: /\bsakura\b|\bcherry blossom\b|\bfloral\b|\bpink roses?\b/i, values: ["Sakura", "Blossom"] },
];

const RARITY_VALUES = new Set(["N", "R", "SR", "SSR", "UR"]);

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collectMetadataStrings = (
  value: Prisma.JsonValue | Record<string, unknown> | null | undefined,
  result: string[] = []
): string[] => {
  if (typeof value === "string") {
    result.push(value);
    return result;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectMetadataStrings(item as Prisma.JsonValue, result);
    }
    return result;
  }

  if (isJsonObject(value)) {
    for (const item of Object.values(value)) {
      collectMetadataStrings(item as Prisma.JsonValue, result);
    }
  }

  return result;
};

const buildStableSeed = (input: CardNamingSource): string =>
  [
    input.sourceId ?? "",
    input.title ?? "",
    input.style ?? "",
    input.rarity ?? "",
    input.character ?? "",
    input.color ?? "",
    ...(input.tags ?? []),
  ]
    .join("|")
    .toLowerCase();

const stableHash = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const pickStable = (values: string[], seed: string): string => values[stableHash(seed) % values.length];

const toTitleCase = (value: string): string =>
  value
    .split(/([:-])/)
    .map((part) => {
      if (part === ":" || part === "-") {
        return part;
      }
      const lower = part.toLowerCase();
      return lower ? `${lower[0].toUpperCase()}${lower.slice(1)}` : "";
    })
    .join("");

const sanitizeWordToken = (value: string): string => value.trim().toLowerCase();

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

const removeTechnicalFragments = (rawTitle: string): string =>
  rawTitle
    .replace(/gid:\/\/[^\s]+/gi, " ")
    .replace(/\bLC-[A-Z0-9-]+\b/gi, " ")
    .replace(/\b(?:shopify|variant|product|order|sku|handle|lootcard)\b/gi, " ")
    .replace(/[“”"'`]+/g, " ")
    .replace(/\d+/g, " ")
    .replace(/[^\x00-\x7F]+/g, " ");

export const sanitizeMarketingTitle = (rawTitle: string): string => {
  const cleaned = removeTechnicalFragments(rawTitle)
    .replace(/[^A-Za-z\s:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const matchedTokens = cleaned.match(/[A-Za-z]+(?:[:-][A-Za-z]+)*/g) ?? [];
  const tokens = matchedTokens
    .map((token) => token.trim())
    .filter((token) => {
      const pieces = token
        .split(/[:-]/)
        .map(sanitizeWordToken)
        .filter(Boolean);

      if (pieces.length === 0) {
        return false;
      }

      return pieces.every((piece) => !TECHNICAL_TERMS.has(piece) && piece !== "lc");
    })
    .slice(0, 6)
    .map(toTitleCase);

  return tokens.join(" ").replace(/\s+/g, " ").trim();
};

const isWeakMarketingTitle = (title: string): boolean => {
  const words = title
    .split(/\s+/)
    .map((word) => sanitizeWordToken(word.replace(/[:-]/g, "")))
    .filter(Boolean);

  if (words.length < 2 || words.length > 6) {
    return true;
  }

  const meaningfulWords = words.filter((word) => !GENERIC_TITLE_TERMS.has(word));
  return meaningfulWords.length === 0;
};

export const resolveExistingMarketingTitle = (
  metadata: Prisma.JsonValue | Record<string, unknown> | null | undefined
): string | null => {
  if (!isJsonObject(metadata)) {
    return null;
  }

  const raw = metadata.marketingTitle;
  if (typeof raw !== "string") {
    return null;
  }

  const sanitized = sanitizeMarketingTitle(raw);
  return sanitized || null;
};

const normalizePhrase = (value: string | null | undefined): string =>
  (value ?? "")
    .replace(/[^A-Za-z\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeRarity = (value: string | null | undefined): string => {
  const normalized = normalizePhrase(value).toUpperCase();
  return RARITY_VALUES.has(normalized) ? normalized : "";
};

const buildSourceStrings = (input: CardNamingSource): string[] => [
  input.color ?? "",
  input.style ?? "",
  input.character ?? "",
  input.rarity ?? "",
  input.category ?? "",
  input.title ?? "",
  input.description ?? "",
  ...(input.tags ?? []),
  ...collectMetadataStrings(input.metadata),
];

const pickThemeValue = (
  patterns: Array<{ pattern: RegExp; values: string[] }>,
  sources: string[],
  seed: string
): string | null => {
  for (const source of sources) {
    for (const matcher of patterns) {
      if (matcher.pattern.test(source)) {
        return pickStable(matcher.values, `${seed}:${matcher.values.join("-")}`);
      }
    }
  }

  return null;
};

const resolveThemeWord = (input: CardNamingSource): string => {
  const sources = buildSourceStrings(input);
  const seed = buildStableSeed(input);

  return (
    pickThemeValue(COLOR_THEME_PATTERNS, sources, `${seed}:color`) ??
    pickThemeValue(STYLE_THEME_PATTERNS, sources, `${seed}:style`) ??
    pickStable(["Shadow", "Celestial", "Mythic"], `${seed}:fallback-theme`)
  );
};

const resolveArchetype = (input: CardNamingSource): string => {
  const sources = buildSourceStrings(input);
  const seed = buildStableSeed(input);

  for (const source of sources) {
    for (const matcher of ARCHETYPE_PATTERNS) {
      if (matcher.pattern.test(source)) {
        return pickStable(matcher.values, `${seed}:${matcher.values.join("-")}`);
      }
    }
  }

  const joined = sources.join(" ");
  if (/\bfemale\b|\bgirl\b|\bwoman\b|\blady\b/i.test(joined)) {
    return pickStable(["Queen", "Empress", "Valkyrie"], `${seed}:female`);
  }
  if (/\bmale\b|\bboy\b|\bman\b/i.test(joined)) {
    return pickStable(["Champion", "Vanguard"], `${seed}:male`);
  }
  if (/\bmecha\b|\brobot\b/i.test(joined)) {
    return pickStable(["Phantom", "Vanguard"], `${seed}:mecha`);
  }

  return pickStable(["Heroine", "Valkyrie"], `${seed}:default-archetype`);
};

export const buildFallbackMarketingTitle = (input: CardNamingSource): string => {
  const theme = resolveThemeWord(input);
  const archetype = resolveArchetype(input);
  const rarity = normalizeRarity(input.rarity);
  const words = [theme, archetype, rarity].filter(Boolean).slice(0, 6);
  return words.join(" ").trim() || "Celestial Heroine";
};

const buildPromptMessages = (payload: NamingPayload): DeepSeekMessage[] => [
  {
    role: "system",
    content:
      "You are a premium anime collectible product naming expert. " +
      'Return JSON only with this shape: {"marketingTitle":"string"}. ' +
      "Generate a short, premium, high-conversion English title for a collectible card. " +
      "Requirements: English only, 3 to 6 words, memorable, premium, collectible feeling, no numbering, " +
      "no product codes, no Shopify technical words, no quotes, no emoji, and no random filler. " +
      "Prefer rarity, color, style, and character archetype cues. " +
      "The result should sound like a real ecommerce TCG or anime collectible item name.",
  },
  {
    role: "user",
    content: JSON.stringify(payload),
  },
];

const extractRawTitle = (rawResponse: string): string => {
  try {
    const parsed = JSON.parse(extractJsonPayload(rawResponse)) as { marketingTitle?: unknown; title?: unknown };
    if (typeof parsed.marketingTitle === "string") {
      return parsed.marketingTitle;
    }
    if (typeof parsed.title === "string") {
      return parsed.title;
    }
  } catch {
    // fall through
  }

  return rawResponse.trim();
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));

const TITLE_NAMING_TIMEOUT_ERROR = "CARD_NAMING_TIMEOUT";

const buildPromptPayload = (input: CardNamingSource): NamingPayload => ({
  title: input.title ?? "",
  description: input.description ?? null,
  tags: input.tags ?? [],
  style: input.style ?? null,
  rarity: input.rarity ?? null,
  category: input.category ?? null,
  character: input.character ?? null,
  color: input.color ?? null,
  metadata: input.metadata ?? null,
  sourceId: input.sourceId ?? null,
});

export const cardNamingService = {
  async generateMarketingTitle(input: GenerateMarketingTitleInput): Promise<GenerateMarketingTitleOutput> {
    const fallbackTitle = buildFallbackMarketingTitle(input);
    const env = loadEnv();
    const payload = buildPromptPayload(input);
    const logBase = {
      sourceId: input.sourceId ?? null,
      title: input.title ?? "",
      rarity: input.rarity ?? null,
      color: input.color ?? null,
      style: input.style ?? null,
      character: input.character ?? null,
    };

    if (!env.enableNaturalLanguageSearch || !env.deepseekApiKey) {
      logger.info("[CARD NAMING SERVICE] fallback", {
        ...logBase,
        reason: env.enableNaturalLanguageSearch ? "missing_api_key" : "llm_disabled",
        marketingTitle: fallbackTitle,
      });

      return {
        marketingTitle: fallbackTitle,
        source: "fallback",
      };
    }

    const controller = new AbortController();
    let timeoutHandle: NodeJS.Timeout | undefined;

    try {
      const response = await Promise.race<
        | { ok: true; payload: DeepSeekResponse }
        | { ok: false; status: number }
      >([
        (async () => {
          const httpResponse = await fetch(`${env.deepseekBaseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${env.deepseekApiKey}`,
            },
            body: JSON.stringify({
              model: env.deepseekModel,
              temperature: 0,
              messages: buildPromptMessages(payload),
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
            reject(new Error(TITLE_NAMING_TIMEOUT_ERROR));
          }, PRODUCT_TITLE_NAMING_TIMEOUT_MS);
        }),
      ]);

      if (!response.ok) {
        logger.warn("[CARD NAMING SERVICE] fallback", {
          ...logBase,
          reason: "non_200",
          status: response.status,
          marketingTitle: fallbackTitle,
        });
        return {
          marketingTitle: fallbackTitle,
          source: "fallback",
        };
      }

      const rawTitle = response.payload.choices?.[0]?.message?.content?.trim() ?? "";
      const sanitizedTitle = sanitizeMarketingTitle(extractRawTitle(rawTitle));

      if (!sanitizedTitle || isWeakMarketingTitle(sanitizedTitle)) {
        logger.warn("[CARD NAMING SERVICE] fallback", {
          ...logBase,
          reason: "sanitize_rejected",
          rawTitle,
          marketingTitle: fallbackTitle,
        });
        return {
          marketingTitle: fallbackTitle,
          source: "fallback",
          rawTitle,
        };
      }

      logger.info("[CARD NAMING SERVICE] generated", {
        ...logBase,
        marketingTitle: sanitizedTitle,
        source: "llm",
      });

      return {
        marketingTitle: sanitizedTitle,
        source: "llm",
        rawTitle,
      };
    } catch (error) {
      const reason =
        (error instanceof Error && error.message === TITLE_NAMING_TIMEOUT_ERROR) || isAbortError(error)
          ? "timeout"
          : "network_error";

      logger.warn("[CARD NAMING SERVICE] fallback", {
        ...logBase,
        reason,
        message: error instanceof Error ? error.message : String(error),
        marketingTitle: fallbackTitle,
      });

      return {
        marketingTitle: fallbackTitle,
        source: "fallback",
      };
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  },
};
