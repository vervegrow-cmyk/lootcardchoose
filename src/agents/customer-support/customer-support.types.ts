import { SupportedLanguage } from "../../hermes/types";

export type CustomerSupportTopic =
  | "shipping"
  | "pricing"
  | "payment"
  | "product"
  | "pre_sale"
  | "general";

export type CustomerSupportQaEntry = {
  topic: CustomerSupportTopic;
  title: string;
  question: string;
  answer: string;
  sourceFile: string;
};

export type CustomerSupportMessageMode = "welcome" | "help" | "question";

export type CustomerSupportConversationContext = {
  recentUserMessages: string[];
  lastAssistantReply: string;
  lastTopic: CustomerSupportTopic;
  language: SupportedLanguage;
  updatedAt: number;
};

export type CustomerSupportKnowledgeBundle = {
  entries: CustomerSupportQaEntry[];
  styleRulesText: string;
  fallbackRulesText: string;
};

export type CustomerSupportAnswerResult = {
  language: SupportedLanguage;
  text: string;
  usedFallback: boolean;
};
