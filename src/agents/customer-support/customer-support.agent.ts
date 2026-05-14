import {
  CustomerSupportAnswerResult,
  CustomerSupportTopic,
} from "./customer-support.types";
import { AgentContext, AgentDefinition, HermesInput, HermesOutput } from "../../hermes/types";
import { answerCustomerQuestionSkill } from "../../skills/customer-support/answer-customer-question.skill";
import { loadCustomerSupportQaSkill } from "../../skills/customer-support/load-customer-support-qa.skill";
import { logger } from "../../utils/logger";

const inferSupportTopic = (message: string): CustomerSupportTopic => {
  const normalized = message.trim().toLowerCase();

  if (
    /\b(ship|shipping|delivery|deliver|wrong address|address)\b/i.test(normalized) ||
    /发货|物流|地址/.test(message)
  ) {
    return "shipping";
  }

  if (
    /\b(discount|free shipping|bulk discount|better price|buy more|price)\b/i.test(normalized) ||
    /折扣|包邮|优惠|价格/.test(message)
  ) {
    return "pricing";
  }

  if (/\b(pay|payment|checkout)\b/i.test(normalized) || /付款|支付|结账/.test(message)) {
    return "payment";
  }

  if (
    /\b(stock|multiple cards|customize|custom|item)\b/i.test(normalized) ||
    /库存|多张|定制/.test(message)
  ) {
    return "product";
  }

  return "pre_sale";
};

const buildMetadata = (
  topic: CustomerSupportTopic,
  qaEntryCount: number,
  result: CustomerSupportAnswerResult
) => ({
  topic,
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

    const topic = inferSupportTopic(input.text);
    const qaResult = await loadCustomerSupportQaSkill(
      {},
      { ...context, skillId: "customerSupport.loadQa" }
    );

    const answerResult = await answerCustomerQuestionSkill(
      {
        message: input.text,
        topic,
        qaEntries: qaResult.entries,
        styleRulesText: qaResult.styleRulesText,
        fallbackRulesText: qaResult.fallbackRulesText,
      },
      { ...context, skillId: "customerSupport.answer" }
    );

    return {
      type: "text",
      language: answerResult.language,
      text: answerResult.text,
      metadata: buildMetadata(topic, qaResult.entries.length, answerResult),
    };
  },
};
