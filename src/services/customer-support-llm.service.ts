import { CustomerSupportQaEntry, CustomerSupportTopic } from "../agents/customer-support/customer-support.types";
import { SupportedLanguage } from "../hermes/types";
import { loadEnv } from "../config/env";
import { logger } from "../utils/logger";

type DeepSeekMessage = {
  role: "system" | "user";
  content: string;
};

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

const LLM_TIMEOUT_MS = 7000;

const fallbackText = (language: SupportedLanguage, topic: CustomerSupportTopic, message: string): string => {
  const normalized = message.trim().toLowerCase();

  if (/\b(ups|usps|fedex|carrier|shipping|ship|delivery)\b/i.test(normalized)) {
    return "Yes, we can help with shipping questions. If you prefer UPS or USPS, please tell us before checkout or share your order number after purchase. Available shipping options may depend on checkout and order details.";
  }

  if (/\b(tracking|track|package|where(?:'s| is) my order|order status)\b/i.test(normalized)) {
    return "Please send your order number and we'll help check the tracking or shipping status.";
  }

  if (/\b(payment|pay|checkout)\b/i.test(normalized)) {
    return "You can pay through the checkout link after selecting a card. If you run into a payment issue, please send your order number or a screenshot of the issue.";
  }

  if (/\b(refund|return|cancel)\b/i.test(normalized)) {
    return "Please send your order number and a short description of the issue. We'll review the order and help with the next step.";
  }

  switch (topic) {
    case "shipping":
      return language === "zh"
        ? "Please share your shipping question and we will help based on the current support guidance."
        : "I want to make sure I give you accurate information. Shipping and delivery timing should follow the current support guidance, and I can help explain it more clearly if you share your specific question.";
    case "pricing":
      return language === "zh"
        ? "Please share your pricing question and we will help based on the current support guidance."
        : "I do not want to promise anything inaccurate about pricing, discounts, or free shipping. If you tell me what cards you want, I can help based on the current support guidance.";
    case "payment":
      return language === "zh"
        ? "Please share your payment question and we will help based on the current support guidance."
        : "I can help explain the payment flow, but I do not want to guess beyond the current support information.";
    case "product":
      return language === "zh"
        ? "Please share the product details you need and we will help based on the current support guidance."
        : "I do not want to guess about stock, customization, or multi-card purchase details. If you share what you want to buy, I can help using the current support guidance.";
    default:
      return language === "zh"
        ? "Please share a bit more detail and we will help based on the current support guidance."
        : "I want to make sure I give you accurate information, so I do not want to guess here. You can contact human support and we can help confirm the details.";
  }
};

const formatQaContext = (entries: CustomerSupportQaEntry[]): string =>
  entries
    .map((entry, index) => {
      const title = entry.title ? `Title: ${entry.title}\n` : "";
      return `Entry ${index + 1}\nSource: ${entry.sourceFile}\n${title}Q: ${entry.question}\nA: ${entry.answer}`;
    })
    .join("\n\n");

const buildPrompt = (input: {
  message: string;
  language: SupportedLanguage;
  topic: CustomerSupportTopic;
  qaEntries: CustomerSupportQaEntry[];
  styleRulesText: string;
  fallbackRulesText: string;
}): DeepSeekMessage[] => [
  {
    role: "system",
    content:
      `You are the customer support and sales support assistant for LootCardChoose. Reply in ${
        input.language === "zh" ? "Simplified Chinese" : "English"
      } only. ` +
      (input.styleRulesText ? `Follow these customer support style rules:\n${input.styleRulesText}\n\n` : "") +
      (input.fallbackRulesText ? `Follow these fallback rules when needed:\n${input.fallbackRulesText}\n\n` : "") +
      "Use only the QA context provided below as the source of truth. " +
      "Do not invent policies, discounts, stock facts, shipping promises, free shipping rules, customization rules, or backend/order checks. " +
      "If the QA context does not clearly answer the question, briefly say you do not want to guess and suggest human support. " +
      "Keep the answer short, friendly, human, and helpful. For pre-sale questions, be lightly sales-oriented without overpromising.",
  },
  {
    role: "user",
    content: `Support topic: ${input.topic}\nUser question: ${input.message}\n\nQA context:\n${formatQaContext(input.qaEntries)}`,
  },
];

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));

export const customerSupportLlmService = {
  async answerQuestion(input: {
    message: string;
    language: SupportedLanguage;
    topic: CustomerSupportTopic;
    qaEntries: CustomerSupportQaEntry[];
    styleRulesText: string;
    fallbackRulesText: string;
  }): Promise<{ text: string; usedFallback: boolean }> {
    if (input.qaEntries.length === 0) {
      return {
        text: fallbackText(input.language, input.topic, input.message),
        usedFallback: true,
      };
    }

    const env = loadEnv();
    if (!env.deepseekApiKey) {
      return {
        text: fallbackText(input.language, input.topic, input.message),
        usedFallback: true,
      };
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    try {
      const response = await fetch(`${env.deepseekBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.deepseekApiKey}`,
        },
        body: JSON.stringify({
          model: env.deepseekModel,
          temperature: 0.2,
          messages: buildPrompt(input),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        logger.warn("[CUSTOMER SUPPORT LLM] fallback", {
          status: response.status,
          topic: input.topic,
        });
        return {
          text: fallbackText(input.language, input.topic, input.message),
          usedFallback: true,
        };
      }

      const payload = (await response.json()) as DeepSeekResponse;
      const text = payload.choices?.[0]?.message?.content?.trim();
      if (!text) {
        return {
          text: fallbackText(input.language, input.topic, input.message),
          usedFallback: true,
        };
      }

      return {
        text,
        usedFallback: false,
      };
    } catch (error) {
      logger.warn("[CUSTOMER SUPPORT LLM] fallback", {
        topic: input.topic,
        reason: isAbortError(error) ? "timeout" : "network_error",
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        text: fallbackText(input.language, input.topic, input.message),
        usedFallback: true,
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  },
};
