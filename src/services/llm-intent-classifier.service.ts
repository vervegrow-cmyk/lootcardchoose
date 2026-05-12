import { IntentId, SupportedLanguage } from "../hermes/types";
import { loadEnv } from "../config/env";
import { logger } from "../utils/logger";

export type IntentClassificationResult = {
  intent: IntentId;
  language: SupportedLanguage;
  confidence: number;
  reason: string;
};

type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

const SEARCH_KEYWORDS = [
  "搜索图库",
  "图库",
  "搜索卡牌",
  "找卡牌",
  "找图",
  "找卡",
  "卡牌",
  "给我",
  "我要",
  "黑金",
  "女角色",
  "赛博朋克",
  "机甲",
  "ssr",
  "black gold",
  "female",
  "card",
  "cards",
  "gallery",
  "search",
  "show me",
  "cyberpunk",
  "mecha",
  "anime",
];

const REFRESH_KEYWORDS = ["换一批", "再来一组", "更多结果", "more", "next", "more like this"];

const HELP_KEYWORDS = ["help", "帮助", "怎么用", "how to use"];

const ORDER_KEYWORDS = ["我的订单", "查询订单", "订单状态", "order", "my order", "order status"];

const detectLanguage = (message: string): SupportedLanguage =>
  /[\u4e00-\u9fff]/.test(message) ? "zh" : "en";

const buildPrompt = (message: string, language: SupportedLanguage): DeepSeekMessage[] => [
  {
    role: "system",
    content:
      'You are the intent classifier for the LootCardChoose Discord gallery system. Return JSON only in this shape: {"intent":"gallery_search|gallery_select|gallery_refresh|order_status|help|ignore","language":"zh|en","confidence":0.0,"reason":"short reason"}. Intent definitions: gallery_search = user wants to browse, search, recommend, describe style, character, color, rarity, mood, premium feeling, cool feeling, collectible feeling, or any card preference. gallery_select = user selects one result from the current list. gallery_refresh = user wants another batch, more results, next batch, or dislikes current results. order_status = user checks orders. help = user asks how to use. ignore = fully unrelated. If the user expresses aesthetic preference without saying search explicitly, classify as gallery_search.',
  },
  {
    role: "user",
    content: `Language: ${language}\nMessage: ${message}`,
  },
];

const normalizeIntent = (value: unknown): IntentId => {
  switch (value) {
    case "gallery_search":
    case "gallery_select":
    case "gallery_refresh":
    case "order_status":
    case "help":
    case "ignore":
      return value;
    default:
      return "ignore";
  }
};

const safeJsonParse = (raw: string, fallbackLanguage: SupportedLanguage): IntentClassificationResult | null => {
  try {
    const parsed = JSON.parse(raw) as Partial<IntentClassificationResult>;
    return {
      intent: normalizeIntent(parsed.intent),
      language: parsed.language === "zh" || parsed.language === "en" ? parsed.language : fallbackLanguage,
      confidence:
        typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence) ? parsed.confidence : 0,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch {
    return null;
  }
};

const fallbackIntentClassification = (message: string): IntentClassificationResult => {
  const normalized = message.trim().toLowerCase();
  const language = detectLanguage(message);

  if (!normalized) {
    return { intent: "ignore", language, confidence: 1, reason: "empty message" };
  }

  if (HELP_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return { intent: "help", language, confidence: 0.95, reason: "matched help fallback keyword" };
  }

  if (ORDER_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return { intent: "order_status", language, confidence: 0.95, reason: "matched order fallback keyword" };
  }

  if (REFRESH_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return { intent: "gallery_refresh", language, confidence: 0.9, reason: "matched refresh fallback keyword" };
  }

  if (SEARCH_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return { intent: "gallery_search", language, confidence: 0.85, reason: "matched search fallback keyword" };
  }

  return {
    intent: "gallery_search",
    language,
    confidence: 0.4,
    reason: "fallback default for lootcardchoose natural language",
  };
};

export const llmIntentClassifierService = {
  async classify(message: string): Promise<IntentClassificationResult> {
    const env = loadEnv();
    const language = detectLanguage(message);
    const apiKey = env.deepseekApiKey;
    const baseUrl = env.deepseekBaseUrl;
    const model = env.deepseekModel;

    if (!apiKey) {
      logger.warn("[LLM INTENT CLASSIFIER] using fallback", { reason: "missing api key" });
      return fallbackIntentClassification(message);
    }

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
          messages: buildPrompt(message, language),
        }),
      });

      if (!response.ok) {
        logger.warn("[LLM INTENT CLASSIFIER] using fallback", {
          reason: "non-200 response",
          status: response.status,
        });
        return fallbackIntentClassification(message);
      }

      const data = (await response.json()) as DeepSeekResponse;
      const content = data.choices?.[0]?.message?.content?.trim() ?? "";
      const parsed = safeJsonParse(content, language);

      if (!parsed) {
        logger.warn("[LLM INTENT CLASSIFIER] using fallback", { reason: "json parse failed" });
        return fallbackIntentClassification(message);
      }

      logger.info("[LLM INTENT CLASSIFIER] parsed=" + JSON.stringify(parsed));
      return parsed;
    } catch (error) {
      logger.warn("[LLM INTENT CLASSIFIER] using fallback", {
        message: error instanceof Error ? error.message : String(error),
      });
      return fallbackIntentClassification(message);
    }
  },
};
