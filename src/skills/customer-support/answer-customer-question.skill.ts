import { CustomerSupportQaEntry, CustomerSupportTopic } from "../../agents/customer-support/customer-support.types";
import { SkillContext, SkillHandler } from "../../hermes/types";
import { customerSupportLlmService } from "../../services/customer-support-llm.service";

export type AnswerCustomerQuestionInput = {
  message: string;
  topic: CustomerSupportTopic;
  qaEntries: CustomerSupportQaEntry[];
  styleRulesText: string;
  fallbackRulesText: string;
};

export type AnswerCustomerQuestionOutput = {
  language: SkillContext["language"];
  text: string;
  usedFallback: boolean;
};

export const answerCustomerQuestionSkill: SkillHandler<
  AnswerCustomerQuestionInput,
  AnswerCustomerQuestionOutput
> = async (input, context) => {
  const response = await customerSupportLlmService.answerQuestion({
    message: input.message,
    language: context.language,
    topic: input.topic,
    qaEntries: input.qaEntries,
    styleRulesText: input.styleRulesText,
    fallbackRulesText: input.fallbackRulesText,
  });

  return {
    language: context.language,
    text: response.text,
    usedFallback: response.usedFallback,
  };
};
