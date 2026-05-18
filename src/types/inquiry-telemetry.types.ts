import type { AgentId, IntentId, HermesOutput } from "../hermes/types";

export type InquiryTelemetryResponseType = HermesOutput["type"] | "error_fallback";

export type InquiryTelemetryEvent = {
  timestamp: string;
  logVersion: 1;
  requestId: string | null;
  userId: string;
  channelId: string;
  discordGuildId: string | null;
  isDM: boolean;
  normalizedContent: string;
  intent: IntentId | null;
  agentId: AgentId | null;
  responseType: InquiryTelemetryResponseType;
  replySuccess: boolean;
  replyText: string;
  usedBusinessFallback: boolean | null;
  usedDeliveryFallback: boolean;
  sessionId: string | null;
  orderNumber: string | null;
  selectedCardId: string | null;
  query: string | null;
};

export type RecordInquiryTelemetryInput = Omit<InquiryTelemetryEvent, "timestamp" | "logVersion" | "replyText"> & {
  replyText: string | null;
};
