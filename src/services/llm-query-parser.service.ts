import { SupportedLanguage } from "../hermes/types";
import { loadEnv } from "../config/env";
import {
  canonicalizeGalleryTerm,
  detectPreferredLanguage,
  normalizeGalleryKeywordsToEnglish,
  normalizeGalleryLimit,
} from "../utils/gallery-language";
import { logger } from "../utils/logger";

export const QUERY_PARSER_TIMEOUT_MS = 6000;

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
};

type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

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
});

const detectLanguage = (message: string): SupportedLanguage => detectPreferredLanguage(message);

const buildPrompt = (userMessage: string, language: SupportedLanguage): DeepSeekMessage[] => [
  {
    role: "system",
    content:
      "You are a gallery search parser for LootCardChoose. Return JSON only. Use exactly this shape: " +
      '{"language":"zh|en","keywords":string[],"tags":string[],"rarity":string,"color":string,' +
      '"character":string,"category":string,"style":string,"mood":string,"scene":string,"limit":number}. ' +
      'The language field must reflect the user\'s original input language. If language is unclear, use "en". ' +
      "All searchable fields should prefer concise English terms even when the user writes in Chinese. " +
      'Example: 给我10张黑金SSR女角色卡牌 -> keywords ["black gold","SSR","female character","anime"], ' +
      'color "black gold", rarity "SSR", character "female character". ' +
      "Do not include quantity words, numbers, classifiers, or generic filler like cards, images, gallery, give me, show me. " +
      "If quantity is missing or invalid, use limit 10. Limit must always be an integer between 1 and 10. " +
      "Do not explain anything.",
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

const normalizeRarity = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim().toUpperCase();
  return ["N", "R", "SR", "SSR", "UR"].includes(normalized) ? normalized : value.trim();
};

const normalizeEnglishField = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }

  return canonicalizeGalleryTerm(value);
};

const normalizeKeywords = (value: unknown): string[] =>
  Array.isArray(value)
    ? normalizeGalleryKeywordsToEnglish(value.filter((item): item is string => typeof item === "string"))
    : [];

const buildFallbackKeywordSeeds = (userMessage: string): string[] => {
  const seeds = [userMessage];

  if (/[女婦妇]角色|女性角色|女孩|女生|少女|美女/.test(userMessage)) {
    seeds.push("female character");
  }

  if (/美女/.test(userMessage)) {
    seeds.push("beauty");
  }

  if (/动漫|二次元/i.test(userMessage)) {
    seeds.push("anime");
  }

  if (/黑金|black gold/i.test(userMessage)) {
    seeds.push("black gold");
  }

  if (/SSR/i.test(userMessage)) {
    seeds.push("SSR");
  }

  return seeds;
};

const safeJsonParse = (raw: string, fallbackLanguage: SupportedLanguage): ParsedGalleryQuery | null => {
  try {
    const parsed = JSON.parse(extractJsonPayload(raw)) as Partial<ParsedGalleryQuery>;
    const tags = normalizeKeywords(parsed.tags);
    const color = normalizeEnglishField(parsed.color);
    const character = normalizeEnglishField(parsed.character);
    const category = normalizeEnglishField(parsed.category);
    const style = normalizeEnglishField(parsed.style);
    const mood = normalizeEnglishField(parsed.mood);
    const scene = normalizeEnglishField(parsed.scene);
    const rarity = normalizeRarity(parsed.rarity);
    const keywords = normalizeGalleryKeywordsToEnglish([
      ...normalizeKeywords(parsed.keywords),
      ...tags,
      color,
      character,
      category,
      style,
      mood,
      scene,
      rarity,
    ]);

    return {
      ...defaultParsedQuery(fallbackLanguage),
      ...parsed,
      language: parsed.language === "zh" || parsed.language === "en" ? parsed.language : fallbackLanguage,
      keywords,
      tags,
      limit: normalizeGalleryLimit(parsed.limit, 10),
      rarity,
      color,
      character,
      category,
      style,
      mood,
      scene,
    };
  } catch {
    return null;
  }
};

const fallbackParsedQuery = (userMessage: string, language: SupportedLanguage): ParsedGalleryQuery => ({
  ...defaultParsedQuery(language),
  keywords: normalizeGalleryKeywordsToEnglish(buildFallbackKeywordSeeds(userMessage)),
  limit: 10,
});

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
  });
  return fallback;
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));

const QUERY_PARSER_TIMEOUT_ERROR = "LLM_QUERY_PARSER_TIMEOUT";

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
      | {
          ok: true;
          payload: DeepSeekResponse;
        }
      | {
          ok: false;
          status: number;
        }
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
          return {
            ok: false as const,
            status: httpResponse.status,
          };
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
    const parsed = safeJsonParse(content, resolvedLanguage);

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
