import { SupportedLanguage } from "../hermes/types";
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

const detectLanguage = (message: string): SupportedLanguage =>
  /[\u4e00-\u9fff]/.test(message) ? "zh" : "en";

const buildPrompt = (userMessage: string, language: SupportedLanguage): DeepSeekMessage[] => {
  return [
    {
      role: "system",
      content:
        "You are a gallery search intent parser. Convert the user's request into JSON only. Return exactly this shape: {\"language\":\"zh|en\",\"keywords\":string[],\"tags\":string[],\"rarity\":string,\"color\":string,\"character\":string,\"category\":string,\"style\":string,\"limit\":number}. Keep the language field consistent with the user's input language. Do not explain anything.",
    },
    {
      role: "user",
      content: `Input language: ${language}\nUser message: ${userMessage}`,
    },
  ];
};

const safeJsonParse = (raw: string, fallbackLanguage: SupportedLanguage): ParsedGalleryQuery | null => {
  try {
    const parsed = JSON.parse(raw) as Partial<ParsedGalleryQuery>;
    return {
      ...defaultParsedQuery(fallbackLanguage),
      ...parsed,
      language: parsed.language === "zh" || parsed.language === "en" ? parsed.language : fallbackLanguage,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      limit: typeof parsed.limit === "number" && Number.isFinite(parsed.limit) ? parsed.limit : 10,
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

export const parseGalleryQuery = async (
  userMessage: string,
  language?: SupportedLanguage
): Promise<ParsedGalleryQuery | null> => {
  const enabled = process.env.ENABLE_NATURAL_LANGUAGE_SEARCH === "true";
  logger.info("[LLM QUERY PARSER] enabled=" + enabled);

  if (!enabled) {
    return null;
  }

  const resolvedLanguage = language ?? detectLanguage(userMessage);
  const apiKey = process.env.DEEPSEEK_API_KEY ?? "";
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

  if (!apiKey) {
    logger.warn("[LLM QUERY PARSER] failed fallback keyword search", { reason: "missing api key" });
    return {
      ...defaultParsedQuery(resolvedLanguage),
      keywords: userMessage.match(/[\u4e00-\u9fff]+|[a-zA-Z0-9]+/g)?.map((token) => token.toLowerCase()) ?? [],
    };
  }

  logger.info("[LLM QUERY PARSER] input=" + userMessage);

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
      return {
        ...defaultParsedQuery(resolvedLanguage),
        keywords: userMessage.match(/[\u4e00-\u9fff]+|[a-zA-Z0-9]+/g)?.map((token) => token.toLowerCase()) ?? [],
      };
    }

    const data = (await response.json()) as DeepSeekResponse;
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = safeJsonParse(content, resolvedLanguage);

    if (!parsed) {
      logger.warn("[LLM QUERY PARSER] failed fallback keyword search", { reason: "json parse failed" });
      return {
        ...defaultParsedQuery(resolvedLanguage),
        keywords: userMessage.match(/[\u4e00-\u9fff]+|[a-zA-Z0-9]+/g)?.map((token) => token.toLowerCase()) ?? [],
      };
    }

    logger.info("[LLM QUERY PARSER] parsed=" + JSON.stringify(parsed));
    return parsed;
  } catch (error) {
    logger.warn("[LLM QUERY PARSER] failed fallback keyword search", {
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      ...defaultParsedQuery(resolvedLanguage),
      keywords: userMessage.match(/[\u4e00-\u9fff]+|[a-zA-Z0-9]+/g)?.map((token) => token.toLowerCase()) ?? [],
    };
  }
};
