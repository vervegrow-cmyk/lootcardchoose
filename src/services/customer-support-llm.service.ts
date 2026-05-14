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

const fallbackText = (language: SupportedLanguage, topic: CustomerSupportTopic): string => {
  if (language === "zh") {
    switch (topic) {
      case "shipping":
        return "我想尽量给你准确的信息。一般发货和配送时间会以现有客服说明为准；如果你愿意，我也可以继续根据你的具体问题帮你说明。";
      case "pricing":
        return "关于价格、折扣或包邮，我不想在信息不完整时随意承诺。你可以告诉我想买的卡牌类型，我会尽量按现有说明帮你判断。";
      case "payment":
        return "付款相关我可以继续帮你说明，但为了避免误导，我会只按现有客服信息来回答。";
      case "product":
        return "关于库存、定制或多张购买，我不想随意猜测。你可以告诉我你想要的卡牌方向，我会按现有说明帮你判断。";
      default:
        return "为了避免给你不准确的信息，我不想在这里随意猜测。你可以联系人工客服进一步确认，我们会更稳妥地帮你核实。";
    }
  }

  switch (topic) {
    case "shipping":
      return "I want to make sure I give you accurate information. Shipping and delivery timing should follow the current support guidance, and I can help explain it more clearly if you share your specific question.";
    case "pricing":
      return "I do not want to promise anything inaccurate about pricing, discounts, or free shipping. If you tell me what cards you want, I can help based on the current support guidance.";
    case "payment":
      return "I can help explain the payment flow, but I do not want to guess beyond the current support information.";
    case "product":
      return "I do not want to guess about stock, customization, or multi-card purchase details. If you share what you want to buy, I can help using the current support guidance.";
    default:
      return "I want to make sure I give you accurate information, so I do not want to guess here. You can contact human support and we can help confirm the details.";
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
        text: fallbackText(input.language, input.topic),
        usedFallback: true,
      };
    }

    const env = loadEnv();
    if (!env.deepseekApiKey) {
      return {
        text: fallbackText(input.language, input.topic),
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
          text: fallbackText(input.language, input.topic),
          usedFallback: true,
        };
      }

      const payload = (await response.json()) as DeepSeekResponse;
      const text = payload.choices?.[0]?.message?.content?.trim();
      if (!text) {
        return {
          text: fallbackText(input.language, input.topic),
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
        text: fallbackText(input.language, input.topic),
        usedFallback: true,
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  },
};
