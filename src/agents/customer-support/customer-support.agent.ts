import {
  CustomerSupportAnswerResult,
  CustomerSupportConversationContext,
  CustomerSupportMessageMode,
  CustomerSupportTopic,
} from "./customer-support.types";
import { AgentContext, AgentDefinition, HermesInput, HermesOutput } from "../../hermes/types";
import { answerCustomerQuestionSkill } from "../../skills/customer-support/answer-customer-question.skill";
import { loadCustomerSupportQaSkill } from "../../skills/customer-support/load-customer-support-qa.skill";
import { logger } from "../../utils/logger";

const SUPPORT_CONTEXT_TTL_MS = 30 * 60 * 1000;
const SUPPORT_CONTEXT_MAX_USER_MESSAGES = 3;
const supportContextStore = new Map<string, CustomerSupportConversationContext>();

const inferSupportTopic = (message: string): CustomerSupportTopic | null => {
  const normalized = message.trim().toLowerCase();

  if (
    /\b(ship|shipping|delivery|deliver|carrier|ups|usps|fedex|tracking|track|package|order status|where(?:'s| is) my order|wrong address|address)\b/i.test(
      normalized
    )
  ) {
    return "shipping";
  }

  if (/\b(discount|free shipping|bulk discount|better price|buy more|price)\b/i.test(normalized)) {
    return "pricing";
  }

  if (/\b(pay|payment|checkout|refund|return|cancel)\b/i.test(normalized)) {
    return "payment";
  }

  if (/\b(stock|multiple cards|customize|custom|item)\b/i.test(normalized)) {
    return "product";
  }

  return null;
};

const buildSupportContextKey = (context: AgentContext): string => {
  const userId = context.userId ?? "unknown-user";
  const channelId = context.channelId ?? "unknown-channel";
  return `${userId}::${channelId}`;
};

const getSupportContext = (context: AgentContext): CustomerSupportConversationContext | null => {
  const key = buildSupportContextKey(context);
  const existing = supportContextStore.get(key);
  if (!existing) {
    return null;
  }

  if (Date.now() - existing.updatedAt > SUPPORT_CONTEXT_TTL_MS) {
    supportContextStore.delete(key);
    return null;
  }

  return existing;
};

const updateSupportContext = (
  context: AgentContext,
  topic: CustomerSupportTopic,
  message: string,
  reply: string
): void => {
  const key = buildSupportContextKey(context);
  const previous = getSupportContext(context);
  const recentUserMessages = [...(previous?.recentUserMessages ?? []), message]
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(-SUPPORT_CONTEXT_MAX_USER_MESSAGES);

  supportContextStore.set(key, {
    recentUserMessages,
    lastAssistantReply: reply.trim().slice(0, 240),
    lastTopic: topic,
    language: context.language,
    updatedAt: Date.now(),
  });
};

const inferMessageMode = (message: string, explicitTopic: CustomerSupportTopic | null): CustomerSupportMessageMode => {
  const normalized = message.trim().toLowerCase();
  const isGreeting = /^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(normalized);
  const isHelpRequest = /\b(help|support|assist)\b/.test(normalized);
  const hasQuestionSignal = /[?？]/.test(message) || normalized.split(/\s+/).length > 3;

  if ((isGreeting || isHelpRequest) && !explicitTopic && !hasQuestionSignal) {
    return "welcome";
  }

  if ((isGreeting || isHelpRequest) && !explicitTopic) {
    return "help";
  }

  return "question";
};

const resolveTopic = (message: string, priorContext: CustomerSupportConversationContext | null): CustomerSupportTopic => {
  const explicitTopic = inferSupportTopic(message);
  if (explicitTopic) {
    return explicitTopic;
  }

  const normalized = message.trim().toLowerCase();
  const isFollowUp =
    normalized.length <= 40 ||
    /\b(what about|how about|and if|what if|that|those|them|it|also|too)\b/.test(normalized);

  if (isFollowUp && priorContext) {
    return priorContext.lastTopic;
  }

  return "pre_sale";
};

const buildMetadata = (
  topic: CustomerSupportTopic,
  messageMode: CustomerSupportMessageMode,
  usedPriorContext: boolean,
  qaEntryCount: number,
  result: CustomerSupportAnswerResult
) => ({
  topic,
  messageMode,
  usedPriorContext,
  qaEntryCount,
  usedFallback: result.usedFallback,
});

export const CustomerSupportAgent: AgentDefinition = {
  id: "customer-support",
  name: "CustomerSupportAgent",
  description: "Read-only customer support and sales support agent",
  async handler(input: HermesInput, context: AgentContext): Promise<HermesOutput> {
    logger.info("[CUSTOMER SUPPORT AGENT] handling customer_support", {
      userId: context.userId ?? "",
      channelId: context.channelId ?? "",
      message: input.text,
    });

    const priorContext = getSupportContext(context);
    const explicitTopic = inferSupportTopic(input.text);
    const topic = resolveTopic(input.text, priorContext);
    const messageMode = inferMessageMode(input.text, explicitTopic);
    const qaResult = await loadCustomerSupportQaSkill(
      {},
      { ...context, skillId: "customerSupport.loadQa" }
    );

    const answerResult = await answerCustomerQuestionSkill(
      {
        message: input.text,
        topic,
        messageMode,
        priorContext,
        qaEntries: qaResult.entries,
        styleRulesText: qaResult.styleRulesText,
        fallbackRulesText: qaResult.fallbackRulesText,
      },
      { ...context, skillId: "customerSupport.answer" }
    );

    updateSupportContext(context, topic, input.text, answerResult.text);

    return {
      type: "text",
      language: answerResult.language,
      text: answerResult.text,
      metadata: buildMetadata(topic, messageMode, priorContext != null, qaResult.entries.length, answerResult),
    };
  },
};
