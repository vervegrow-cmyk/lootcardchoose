import { SupportedLanguage } from "../hermes/types";
import { loadEnv } from "../config/env";
import { logger } from "../utils/logger";

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

const normalizeParsedLimit = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 10;
  }

  if (value < 1) {
    return 10;
  }

  return Math.min(Math.floor(value), 10);
};

const detectLanguage = (message: string): SupportedLanguage =>
  /[\u4e00-\u9fff]/.test(message) ? "zh" : "en";

const buildPrompt = (userMessage: string, language: SupportedLanguage): DeepSeekMessage[] => [
  {
    role: "system",
    content:
      "You are a gallery search intent parser. Convert the user's request into JSON only. Return exactly this shape: {\"language\":\"zh|en\",\"keywords\":string[],\"tags\":string[],\"rarity\":string,\"color\":string,\"character\":string,\"category\":string,\"style\":string,\"mood\":string,\"scene\":string,\"limit\":number}. Keep the language field consistent with the user's input language. Extract concise semantic keywords only. Do not include quantity words, numbers, classifiers, or generic words like cards, images, gallery, or request filler. If the user does not specify a quantity, set limit to 10. Never return 0, null, negative, NaN, or missing limit. Limit must always be an integer between 1 and 10. For 美女 include semantic intent like 女角色, female, girl, anime girl, female character, beauty when relevant. Do not explain anything.",
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

const safeJsonParse = (raw: string, fallbackLanguage: SupportedLanguage): ParsedGalleryQuery | null => {
  try {
    const parsed = JSON.parse(extractJsonPayload(raw)) as Partial<ParsedGalleryQuery>;
    return {
      ...defaultParsedQuery(fallbackLanguage),
      ...parsed,
      language: parsed.language === "zh" || parsed.language === "en" ? parsed.language : fallbackLanguage,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter((item): item is string => typeof item === "string") : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((item): item is string => typeof item === "string") : [],
      limit: normalizeParsedLimit(parsed.limit),
      rarity: typeof parsed.rarity === "string" ? parsed.rarity : "",
      color: typeof parsed.color === "string" ? parsed.color : "",
      character: typeof parsed.character === "string" ? parsed.character : "",
      category: typeof parsed.category === "string" ? parsed.category : "",
      style: typeof parsed.style === "string" ? parsed.style : "",
      mood: typeof parsed.mood === "string" ? parsed.mood : "",
      scene: typeof parsed.scene === "string" ? parsed.scene : "",
    };
  } catch {
    return null;
  }
};

const fallbackParsedQuery = (userMessage: string, language: SupportedLanguage): ParsedGalleryQuery => ({
  ...defaultParsedQuery(language),
  keywords: userMessage.match(/[\u4e00-\u9fff]+|[a-zA-Z0-9]+/g) ?? [],
  limit: 10,
});

export const parseGalleryQuery = async (
  userMessage: string,
  language?: SupportedLanguage
): Promise<ParsedGalleryQuery | null> => {
  const env = loadEnv();
  const enabled = env.enableNaturalLanguageSearch;
  logger.info("[LLM QUERY PARSER] enabled=" + enabled);

  if (!enabled) {
    return null;
  }

  const resolvedLanguage = language ?? detectLanguage(userMessage);
  const apiKey = env.deepseekApiKey;
  const baseUrl = env.deepseekBaseUrl;
  const model = env.deepseekModel;

  if (!apiKey) {
    logger.warn("[LLM QUERY PARSER] failed fallback keyword search", { reason: "missing api key" });
    return fallbackParsedQuery(userMessage, resolvedLanguage);
  }

  logger.info("[LLM QUERY PARSER] input=" + JSON.stringify(userMessage));

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
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
    });

    if (!response.ok) {
      logger.warn("[LLM QUERY PARSER] failed fallback keyword search", {
        status: response.status,
      });
      return fallbackParsedQuery(userMessage, resolvedLanguage);
    }

    const data = (await response.json()) as DeepSeekResponse;
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = safeJsonParse(content, resolvedLanguage);

    if (!parsed) {
      logger.warn("[LLM QUERY PARSER] failed fallback keyword search", { reason: "json parse failed" });
      return fallbackParsedQuery(userMessage, resolvedLanguage);
    }

    logger.info("[LLM QUERY PARSER] parsed=" + JSON.stringify(parsed));
    return parsed;
  } catch (error) {
    logger.warn("[LLM QUERY PARSER] failed fallback keyword search", {
      message: error instanceof Error ? error.message : String(error),
    });
    return fallbackParsedQuery(userMessage, resolvedLanguage);
  }
};
