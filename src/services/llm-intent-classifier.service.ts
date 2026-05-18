import { IntentId, SupportedLanguage } from "../hermes/types";
import { loadEnv } from "../config/env";
import {
  detectPreferredLanguage,
  isGalleryRefreshMessage,
  isGallerySelectMessage,
} from "../utils/gallery-language";
import { logger } from "../utils/logger";

export const INTENT_CLASSIFIER_TIMEOUT_MS = 5000;

export type IntentClassifierFallbackReason =
  | "timeout"
  | "non_200"
  | "json_parse_failed"
  | "network_error"
  | "missing_api_key"
  | "keyword";

export type IntentClassificationResult = {
  intent: IntentId;
  language: SupportedLanguage;
  confidence: number;
  reason: string;
  source: "llm" | "fallback";
  fallbackReason?: IntentClassifierFallbackReason;
};

type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

type IntentClassifierOutcome =
  | "llm_success"
  | "missing_api_key_fallback"
  | "timeout_fallback"
  | "non_200_fallback"
  | "json_parse_failed_fallback"
  | "network_error_fallback";

const SEARCH_KEYWORDS = [
  "gallery",
  "search",
  "cards",
  "card",
  "recommend",
  "dragon",
  "cyberpunk",
  "red",
  "one piece",
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
  "搜索",
  "查找",
  "找卡",
];

const CUSTOMER_SUPPORT_KEYWORDS = [
  "discount",
  "free shipping",
  "delivery",
  "ship",
  "shipping",
  "pay",
  "payment",
  "bulk discount",
  "better price",
  "buy more",
  "multiple cards",
  "customize",
  "customise",
  "wrong address",
  "stock",
  "in stock",
  "折扣",
  "包邮",
  "付款",
  "支付",
  "发货",
  "物流",
  "多张",
  "定制",
  "地址",
  "库存",
];

const HELP_KEYWORDS = [
  "help",
  "help me",
  "hi",
  "hello",
  "good morning",
  "shopping",
  "browse",
  "looking",
  "i want to shop",
  "how to use",
  "how do i buy",
  "how do i choose",
  "怎么",
  "如何",
  "付款",
  "支付",
  "发货",
  "物流",
  "帮助",
  "怎么买",
  "怎么退",
];

const ORDER_KEYWORDS = ["我的订单", "查询订单", "订单状态", "order status", "my order"];

const detectLanguage = (message: string): SupportedLanguage => detectPreferredLanguage(message);

const buildPrompt = (message: string, language: SupportedLanguage): DeepSeekMessage[] => [
  {
    role: "system",
    content:
      'You are the intent classifier for the LootCardChoose Discord gallery system. Return JSON only in this shape: ' +
      '{"intent":"gallery_search|gallery_select|gallery_refresh|order_status|customer_support|help|ignore","language":"zh|en","confidence":0.0,"reason":"short reason"}. ' +
      "gallery_search = the user wants to browse or search cards by style, color, rarity, character, mood, scene, or recommendation. " +
      "gallery_select = the user selects one numbered result. " +
      "gallery_refresh = the user wants another batch, more options, another style, or says the current cards are not right. " +
      "order_status = the user explicitly checks an order status. " +
      "customer_support = the user asks an explicit support or policy question about discounts, shipping policy, delivery timing, payment, stock availability, buying multiple cards, customization, or wrong address guidance. " +
      "help = the user sends a greeting, asks for lightweight onboarding, or expresses vague shopping or browsing intent without a specific card search or support policy question. " +
      "Examples of help include hi, hello, good morning, shopping, browse, looking, help me, and I want to shop. " +
      "Do not classify vague commerce or browsing words such as shopping, browse, looking, or buy cards as customer_support unless there is a clear support question. " +
      "If the user is browsing cards, describing card preferences, or asking for styles, themes, colors, characters, or recommendations, prefer gallery_search. " +
      "If the message is only a meaningless or random string with no usable intent, prefer ignore. " +
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
    case "customer_support":
    case "help":
    case "ignore":
      return value;
    default:
      return "ignore";
  }
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

const safeJsonParse = (raw: string, fallbackLanguage: SupportedLanguage): IntentClassificationResult | null => {
  try {
    const parsed = JSON.parse(extractJsonPayload(raw)) as Partial<IntentClassificationResult>;
    return {
      intent: normalizeIntent(parsed.intent),
      language: parsed.language === "zh" || parsed.language === "en" ? parsed.language : fallbackLanguage,
      confidence:
        typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence) ? parsed.confidence : 0,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      source: "llm",
    };
  } catch {
    return null;
  }
};

export const fallbackIntentClassification = (
  message: string,
  options?: {
    hasActiveGallerySession?: boolean;
  },
  fallbackReason: IntentClassifierFallbackReason = "keyword"
): IntentClassificationResult => {
  const normalized = message.trim().toLowerCase();
  const language = detectLanguage(message);

  if (!normalized) {
    return {
      intent: "ignore",
      language,
      confidence: 1,
      reason: "empty message",
      source: "fallback",
      fallbackReason,
    };
  }

  if (isGallerySelectMessage(message, { hasActiveSession: options?.hasActiveGallerySession })) {
    return {
      intent: "gallery_select",
      language,
      confidence: 0.99,
      reason: "matched select fallback keyword",
      source: "fallback",
      fallbackReason,
    };
  }

  if (isGalleryRefreshMessage(message)) {
    return {
      intent: "gallery_refresh",
      language,
      confidence: 0.98,
      reason: "matched refresh fallback keyword",
      source: "fallback",
      fallbackReason,
    };
  }

  if (ORDER_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return {
      intent: "order_status",
      language,
      confidence: 0.95,
      reason: "matched order fallback keyword",
      source: "fallback",
      fallbackReason,
    };
  }

  if (CUSTOMER_SUPPORT_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return {
      intent: "customer_support",
      language,
      confidence: 0.88,
      reason: "matched customer support fallback keyword",
      source: "fallback",
      fallbackReason,
    };
  }

  if (HELP_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return {
      intent: "help",
      language,
      confidence: 0.8,
      reason: "matched help fallback keyword",
      source: "fallback",
      fallbackReason,
    };
  }

  if (SEARCH_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return {
      intent: "gallery_search",
      language,
      confidence: 0.92,
      reason: "matched search fallback keyword",
      source: "fallback",
      fallbackReason,
    };
  }

  return {
    intent: "ignore",
    language,
    confidence: 0.3,
    reason: "fallback default ignore",
    source: "fallback",
    fallbackReason,
  };
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));

const INTENT_TIMEOUT_ERROR = "LLM_INTENT_TIMEOUT";

const logClassificationResult = (input: {
  message: string;
  language: SupportedLanguage;
  hasActiveGallerySession: boolean;
  result: IntentClassificationResult;
  outcome: IntentClassifierOutcome;
  latencyMs: number;
}): void => {
  logger.info("[LLM INTENT CLASSIFIER] completed", {
    messageLength: input.message.length,
    language: input.language,
    hasActiveGallerySession: input.hasActiveGallerySession,
    intent: input.result.intent,
    outcome: input.outcome,
    usedFallback: input.result.source === "fallback",
    latencyMs: input.latencyMs,
  });
};

export const llmIntentClassifierService = {
  async classify(
    message: string,
    options?: {
      hasActiveGallerySession?: boolean;
    }
  ): Promise<IntentClassificationResult> {
    const startedAt = Date.now();
    const env = loadEnv();
    const language = detectLanguage(message);
    const hasActiveGallerySession = Boolean(options?.hasActiveGallerySession);
    const apiKey = env.deepseekApiKey;
    const baseUrl = env.deepseekBaseUrl;
    const model = env.deepseekModel;

    if (!apiKey) {
      logger.warn("[LLM INTENT CLASSIFIER] fallback", {
        message,
        reason: "missing_api_key",
      });
      const result = fallbackIntentClassification(message, options, "missing_api_key");
      logClassificationResult({
        message,
        language,
        hasActiveGallerySession,
        result,
        outcome: "missing_api_key_fallback",
        latencyMs: Date.now() - startedAt,
      });
      return result;
    }

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
              messages: buildPrompt(message, language),
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
            reject(new Error(INTENT_TIMEOUT_ERROR));
          }, INTENT_CLASSIFIER_TIMEOUT_MS);
        }),
      ]);

      if (!response.ok) {
        logger.warn("[LLM INTENT CLASSIFIER] fallback", {
          message,
          reason: "non_200",
          status: response.status,
        });
        const result = fallbackIntentClassification(message, options, "non_200");
        logClassificationResult({
          message,
          language,
          hasActiveGallerySession,
          result,
          outcome: "non_200_fallback",
          latencyMs: Date.now() - startedAt,
        });
        return result;
      }

      const content = response.payload.choices?.[0]?.message?.content?.trim() ?? "";
      const parsed = safeJsonParse(content, language);

      if (!parsed) {
        logger.warn("[LLM INTENT CLASSIFIER] fallback", {
          message,
          reason: "json_parse_failed",
        });
        const result = fallbackIntentClassification(message, options, "json_parse_failed");
        logClassificationResult({
          message,
          language,
          hasActiveGallerySession,
          result,
          outcome: "json_parse_failed_fallback",
          latencyMs: Date.now() - startedAt,
        });
        return result;
      }

      logger.info("[LLM INTENT CLASSIFIER] parsed", parsed);
      logClassificationResult({
        message,
        language,
        hasActiveGallerySession,
        result: parsed,
        outcome: "llm_success",
        latencyMs: Date.now() - startedAt,
      });
      return parsed;
    } catch (error) {
      if ((error instanceof Error && error.message === INTENT_TIMEOUT_ERROR) || isAbortError(error)) {
        logger.warn("[LLM INTENT CLASSIFIER] timeout", {
          message,
          timeoutMs: INTENT_CLASSIFIER_TIMEOUT_MS,
        });
        const result = fallbackIntentClassification(message, options, "timeout");
        logClassificationResult({
          message,
          language,
          hasActiveGallerySession,
          result,
          outcome: "timeout_fallback",
          latencyMs: Date.now() - startedAt,
        });
        return result;
      }

      logger.warn("[LLM INTENT CLASSIFIER] fallback", {
        message,
        reason: "network_error",
        error: error instanceof Error ? error.message : String(error),
      });
      const result = fallbackIntentClassification(message, options, "network_error");
      logClassificationResult({
        message,
        language,
        hasActiveGallerySession,
        result,
        outcome: "network_error_fallback",
        latencyMs: Date.now() - startedAt,
      });
      return result;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  },
};
