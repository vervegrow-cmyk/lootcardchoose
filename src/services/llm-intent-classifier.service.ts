import { IntentId, SupportedLanguage } from "../hermes/types";
import { loadEnv } from "../config/env";
import { detectPreferredLanguage } from "../utils/gallery-language";
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
  "gallery",
  "search",
  "show me",
  "card",
  "cards",
  "black gold",
  "female",
  "anime",
  "ssr",
  "给我",
  "卡牌",
  "图库",
  "黑金",
  "女角色",
  "动漫",
];

const REFRESH_KEYWORDS = [
  "can we switch to another batch",
  "show me another batch",
  "next batch",
  "more options",
  "any other options",
  "show me more",
  "more like this",
  "i don't like these",
  "not these",
  "try another style",
  "something else",
  "these are not what i want",
  "换一批",
  "再来一批",
  "还有别的吗",
  "下一批",
  "更多类似的",
  "不喜欢这些",
  "不是这种",
  "换个风格",
  "还有其他的吗",
  "这些不太对",
];

const HELP_KEYWORDS = [
  "help",
  "how to use",
  "how do i buy",
  "how do i choose",
  "buy",
  "purchase",
  "checkout",
  "payment",
  "pay",
  "shipping",
  "tracking",
  "怎么买",
  "怎么选",
  "付款",
  "支付",
  "发货",
  "物流",
  "帮助",
];

const ORDER_KEYWORDS = ["我的订单", "查询订单", "订单状态", "order status", "my order"];

const detectLanguage = (message: string): SupportedLanguage => detectPreferredLanguage(message);

const buildPrompt = (message: string, language: SupportedLanguage): DeepSeekMessage[] => [
  {
    role: "system",
    content:
      'You are the intent classifier for the LootCardChoose Discord gallery system. Return JSON only in this shape: ' +
      '{"intent":"gallery_search|gallery_select|gallery_refresh|order_status|help|ignore","language":"zh|en","confidence":0.0,"reason":"short reason"}. ' +
      "gallery_search = the user wants to browse or search cards by style, color, rarity, character, mood, scene, or recommendation. " +
      "gallery_select = the user selects one numbered result. " +
      "gallery_refresh = the user wants another batch, more options, another style, or says the current cards are not right. " +
      "order_status = the user explicitly checks an order status. " +
      "help = the user asks how to buy, how to choose, payment, shipping, tracking, or how the system works. " +
      "ignore = fully unrelated.",
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
    reason: "fallback default for natural language card requests",
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
