import { Prisma } from "@prisma/client";
import { loadEnv } from "../config/env";
import { GalleryCardRecord, galleryRepository } from "../repositories/gallery.repository";
import { logger } from "../utils/logger";

export const PRODUCT_TITLE_NAMING_TIMEOUT_MS = 6000;

export type GenerateMarketingTitleInput = {
  galleryCardId: string;
  orderNumber: string;
};

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
  id: string;
  title: string;
  description: string | null;
  tags: string[];
  style: string | null;
  rarity: string | null;
  category: string | null;
  character: string | null;
  color: string | null;
  metadata: Prisma.JsonValue | null;
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
  "collectible",
]);

const ARCHETYPE_PATTERNS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /\bempress\b/i, value: "Empress" },
  { pattern: /\bqueen\b/i, value: "Queen" },
  { pattern: /\bvalkyrie\b/i, value: "Valkyrie" },
  { pattern: /\bprincess\b/i, value: "Princess" },
  { pattern: /\bsorceress\b/i, value: "Sorceress" },
  { pattern: /\bwitch\b/i, value: "Witch" },
  { pattern: /\bangel\b/i, value: "Angel" },
  { pattern: /\bdemon\b/i, value: "Demon" },
  { pattern: /\bgoddess\b/i, value: "Goddess" },
  { pattern: /\bwarrior\b/i, value: "Warrior" },
  { pattern: /\bmaiden\b/i, value: "Maiden" },
  { pattern: /\bphantom\b/i, value: "Phantom" },
  { pattern: /\bheroine\b/i, value: "Heroine" },
];

const THEME_PATTERNS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /\bcherry blossom\b|\bsakura\b|\bpink roses?\b|\bfloral\b/i, value: "Sakura" },
  { pattern: /\bcelestial\b|\bstarlit\b|\bstarry\b/i, value: "Celestial" },
  { pattern: /\bphantom\b|\bshadow\b/i, value: "Phantom" },
  { pattern: /\bmidnight\b|\bblack\b/i, value: "Midnight" },
  { pattern: /\bcrimson\b|\bscarlet\b|\bred\b/i, value: "Crimson" },
  { pattern: /\bneon\b/i, value: "Neon" },
  { pattern: /\bgolden\b|\bgold\b/i, value: "Golden" },
  { pattern: /\bemerald\b|\bgreen\b/i, value: "Emerald" },
  { pattern: /\bsapphire\b|\bblue\b/i, value: "Sapphire" },
  { pattern: /\bviolet\b|\bpurple\b/i, value: "Purple" },
  { pattern: /\bivory\b|\bwhite\b/i, value: "Ivory" },
  { pattern: /\bobsidian\b/i, value: "Obsidian" },
  { pattern: /\blunar\b|\bmoon\b/i, value: "Lunar" },
  { pattern: /\bsolar\b|\bsun\b|\bsunset\b/i, value: "Solar" },
  { pattern: /\bvelvet\b|\blace\b/i, value: "Velvet" },
  { pattern: /\bmythic\b|\bmystic\b|\bmagical\b/i, value: "Mystic" },
  { pattern: /\bfantasy\b/i, value: "Fantasy" },
];

const RARITY_TO_THEME: Record<string, string> = {
  SSR: "Mythic",
  UR: "Ultimate",
  SR: "Radiant",
  R: "Elite",
  N: "Classic",
};

const collectMetadataStrings = (value: Prisma.JsonValue | null, result: string[] = []): string[] => {
  if (typeof value === "string") {
    result.push(value);
    return result;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectMetadataStrings(item, result);
    }
    return result;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectMetadataStrings(item as Prisma.JsonValue, result);
    }
  }

  return result;
};

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

const removeTechnicalFragments = (rawTitle: string): string =>
  rawTitle
    .replace(/gid:\/\/[^\s]+/gi, " ")
    .replace(/\bLC-[A-Z0-9-]+\b/gi, " ")
    .replace(/\b(?:shopify|variant|product|order|sku|handle)\b/gi, " ")
    .replace(/[“”"'`]+/g, " ")
    .replace(/\d+/g, " ")
    .replace(/[^\x00-\x7F]+/g, " ");

const sanitizeMarketingTitle = (rawTitle: string): string => {
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

const buildPromptMessages = (payload: NamingPayload): DeepSeekMessage[] => [
  {
    role: "system",
    content:
      "You are a premium anime collectible product naming expert for Shopify. " +
      'Return JSON only with this shape: {"marketingTitle":"string"}. ' +
      "Generate a short, premium, high-conversion English title for an anime collectible card. " +
      "Requirements: English only, 3 to 6 words, memorable, premium, collectible feeling, no numbering, " +
      "no product codes, no Shopify technical words, no quotes, no emoji, and no random filler. " +
      "The title should sound like a real ecommerce collectible item name, not a catalog ID.",
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
    // fall through to raw content
  }

  return rawResponse.trim();
};

const titleCasePhrase = (value: string): string =>
  value
    .split(/\s+/)
    .map((word) => toTitleCase(word))
    .join(" ")
    .trim();

const normalizePhrase = (value: string | null | undefined): string =>
  (value ?? "")
    .replace(/[^A-Za-z\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const truncatePhraseWords = (value: string, maxWords: number): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ");

const buildSourceStrings = (card: GalleryCardRecord): string[] => [
  card.color ?? "",
  card.style ?? "",
  card.character ?? "",
  card.rarity ?? "",
  card.category ?? "",
  card.title,
  card.description ?? "",
  ...card.tags,
  ...collectMetadataStrings(card.metadata),
];

const resolveThemeDescriptor = (card: GalleryCardRecord): string | null => {
  const sources = [card.style ?? "", card.title, card.description ?? "", ...card.tags, ...collectMetadataStrings(card.metadata)];
  for (const source of sources) {
    for (const matcher of THEME_PATTERNS) {
      if (matcher.pattern.test(source)) {
        return matcher.value;
      }
    }
  }

  return null;
};

const resolveColorDescriptor = (card: GalleryCardRecord): string | null => {
  const normalizedColor = normalizePhrase(card.color);
  if (normalizedColor) {
    return titleCasePhrase(truncatePhraseWords(normalizedColor, 2));
  }

  const sources = [card.title, card.description ?? "", ...card.tags, ...collectMetadataStrings(card.metadata)];
  for (const source of sources) {
    for (const matcher of THEME_PATTERNS) {
      if (
        ["Golden", "Crimson", "Purple", "Emerald", "Sapphire", "Ivory", "Midnight", "Obsidian"].includes(
          matcher.value
        ) &&
        matcher.pattern.test(source)
      ) {
        return matcher.value;
      }
    }
  }

  return null;
};

const resolveRarityDescriptor = (card: GalleryCardRecord): string | null => {
  const rarity = normalizePhrase(card.rarity).toUpperCase();
  if (rarity && RARITY_TO_THEME[rarity]) {
    return RARITY_TO_THEME[rarity];
  }

  const sources = [card.rarity ?? "", ...card.tags, ...collectMetadataStrings(card.metadata)];
  for (const source of sources) {
    if (/\bSSR\b/i.test(source)) {
      return RARITY_TO_THEME.SSR;
    }
    if (/\bUR\b/i.test(source)) {
      return RARITY_TO_THEME.UR;
    }
    if (/\bSR\b/i.test(source)) {
      return RARITY_TO_THEME.SR;
    }
  }

  return null;
};

const resolveArchetype = (card: GalleryCardRecord): string => {
  const sources = buildSourceStrings(card);
  for (const source of sources) {
    for (const matcher of ARCHETYPE_PATTERNS) {
      if (matcher.pattern.test(source)) {
        return matcher.value;
      }
    }
  }

  const joined = sources.join(" ");
  if (/\bfemale\b|\bgirl\b|\bwoman\b|\blady\b/i.test(joined)) {
    return "Heroine";
  }
  if (/\bmale\b|\bboy\b|\bman\b/i.test(joined)) {
    return "Champion";
  }

  return "Heroine";
};

const resolveFallbackDescriptorWords = (card: GalleryCardRecord): string[] => {
  const descriptors: string[] = [];
  const colorDescriptor = resolveColorDescriptor(card);
  const themeDescriptor = resolveThemeDescriptor(card);
  const rarityDescriptor = resolveRarityDescriptor(card);

  for (const candidate of [colorDescriptor, themeDescriptor, rarityDescriptor]) {
    const normalized = sanitizeWordToken((candidate ?? "").replace(/\s+/g, " "));
    if (!candidate || !normalized) {
      continue;
    }
    if (descriptors.some((existing) => sanitizeWordToken(existing) === normalized)) {
      continue;
    }
    descriptors.push(candidate);
  }

  if (descriptors.length >= 2) {
    return descriptors.slice(0, 2);
  }

  const extraSources = [card.title, ...card.tags, card.description ?? "", ...collectMetadataStrings(card.metadata)];
  for (const source of extraSources) {
    const normalized = normalizePhrase(source);
    if (!normalized) {
      continue;
    }

    const words = normalized
      .split(/\s+/)
      .map(sanitizeWordToken)
      .filter((word) => word.length > 2 && !DESCRIPTOR_STOPWORDS.has(word));

    for (const word of words) {
      const descriptor = toTitleCase(word);
      if (descriptors.some((existing) => sanitizeWordToken(existing) === sanitizeWordToken(descriptor))) {
        continue;
      }
      descriptors.push(descriptor);
      if (descriptors.length >= 2) {
        return descriptors.slice(0, 2);
      }
    }
  }

  return descriptors.slice(0, 2);
};

const buildFallbackMarketingTitle = (card: GalleryCardRecord): string => {
  const descriptors = resolveFallbackDescriptorWords(card);
  const archetype = resolveArchetype(card);
  const words = [...descriptors, archetype]
    .join(" ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);

  const fallbackTitle = words.join(" ").trim();
  if (fallbackTitle) {
    return fallbackTitle;
  }

  return "Celestial Heroine";
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));

const TITLE_NAMING_TIMEOUT_ERROR = "CARD_NAMING_TIMEOUT";

export const cardNamingService = {
  async generateMarketingTitle(input: GenerateMarketingTitleInput): Promise<GenerateMarketingTitleOutput> {
    const card = await galleryRepository.findById(input.galleryCardId);
    if (!card) {
      throw new Error(`Gallery card not found for naming: ${input.galleryCardId}`);
    }

    const fallbackTitle = buildFallbackMarketingTitle(card);
    const env = loadEnv();
    const payload: NamingPayload = {
      id: card.id,
      title: card.title,
      description: card.description,
      tags: card.tags,
      style: card.style,
      rarity: card.rarity,
      category: card.category,
      character: card.character,
      color: card.color,
      metadata: card.metadata,
    };

    if (!env.enableNaturalLanguageSearch || !env.deepseekApiKey) {
      logger.info("[CARD NAMING SERVICE] fallback", {
        galleryCardId: input.galleryCardId,
        orderNumber: input.orderNumber,
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
          galleryCardId: input.galleryCardId,
          orderNumber: input.orderNumber,
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
          galleryCardId: input.galleryCardId,
          orderNumber: input.orderNumber,
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
        galleryCardId: input.galleryCardId,
        orderNumber: input.orderNumber,
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
        galleryCardId: input.galleryCardId,
        orderNumber: input.orderNumber,
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
