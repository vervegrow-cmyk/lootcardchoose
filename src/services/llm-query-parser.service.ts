import { logger } from "../utils/logger";

export type ParsedGalleryQuery = {
  keywords: string[];
  tags: string[];
  style: string;
  rarity: string;
  category: string;
  character: string;
  color: string;
  mood: string;
  scene: string;
  language: "zh" | "en";
};

type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

const defaultParsedQuery: ParsedGalleryQuery = {
  keywords: [],
  tags: [],
  style: "",
  rarity: "",
  category: "",
  character: "",
  color: "",
  mood: "",
  scene: "",
  language: "zh",
};

const buildPrompt = (userMessage: string): DeepSeekMessage[] => {
  return [
    {
      role: "system",
      content:
        "你是图库搜索意图解析器。请将用户自然语言转成 JSON，仅输出 JSON 字符串，不要解释。字段：keywords[], tags[], style, rarity, category, character, color, mood, scene, language。language 只能是 zh 或 en。未知字段用空字符串或空数组。",
    },
    {
      role: "user",
      content: `用户消息：${userMessage}`,
    },
  ];
};

const safeJsonParse = (raw: string): ParsedGalleryQuery | null => {
  try {
    const parsed = JSON.parse(raw) as ParsedGalleryQuery;
    return {
      ...defaultParsedQuery,
      ...parsed,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      language: parsed.language === "en" ? "en" : "zh",
    };
  } catch {
    return null;
  }
};

export const parseGalleryQuery = async (userMessage: string): Promise<ParsedGalleryQuery | null> => {
  const enabled = process.env.ENABLE_NATURAL_LANGUAGE_SEARCH === "true";
  logger.info("[LLM QUERY PARSER] enabled=" + enabled);

  if (!enabled) {
    return null;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY ?? "";
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

  if (!apiKey) {
    logger.warn("[LLM QUERY PARSER] failed fallback keyword search", { reason: "missing api key" });
    return null;
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
        messages: buildPrompt(userMessage),
      }),
    });

    if (!response.ok) {
      logger.warn("[LLM QUERY PARSER] failed fallback keyword search", {
        status: response.status,
      });
      return null;
    }

    const data = (await response.json()) as DeepSeekResponse;
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = safeJsonParse(content);

    if (!parsed) {
      logger.warn("[LLM QUERY PARSER] failed fallback keyword search", { reason: "json parse failed" });
      return null;
    }

    logger.info("[LLM QUERY PARSER] parsed=" + JSON.stringify(parsed));
    return parsed;
  } catch (error) {
    logger.warn("[LLM QUERY PARSER] failed fallback keyword search", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};
