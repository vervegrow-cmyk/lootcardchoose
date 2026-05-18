import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { InquiryTelemetryEvent, RecordInquiryTelemetryInput } from "../types/inquiry-telemetry.types";
import { logger } from "../utils/logger";

const DEFAULT_OUTPUT_PATH = path.join(process.cwd(), "reports", "inquiry-telemetry.jsonl");
const MAX_REPLY_TEXT_LENGTH = 400;

let outputPathOverride: string | null = null;

const getOutputPath = (): string => outputPathOverride ?? DEFAULT_OUTPUT_PATH;

const truncateReplyText = (value: string | null): string => {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return "";
  }

  if (normalized.length <= MAX_REPLY_TEXT_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_REPLY_TEXT_LENGTH - 3)}...`;
};

const buildEvent = (input: RecordInquiryTelemetryInput): InquiryTelemetryEvent => ({
  timestamp: new Date().toISOString(),
  logVersion: 1,
  requestId: input.requestId,
  userId: input.userId,
  channelId: input.channelId,
  discordGuildId: input.discordGuildId,
  isDM: input.isDM,
  normalizedContent: input.normalizedContent,
  intent: input.intent,
  agentId: input.agentId,
  responseType: input.responseType,
  replySuccess: input.replySuccess,
  replyText: truncateReplyText(input.replyText),
  usedBusinessFallback: input.usedBusinessFallback,
  usedDeliveryFallback: input.usedDeliveryFallback,
  sessionId: input.sessionId,
  orderNumber: input.orderNumber,
  selectedCardId: input.selectedCardId,
  query: input.query,
});

const appendEvent = async (event: InquiryTelemetryEvent): Promise<void> => {
  const filePath = getOutputPath();
  const dirPath = path.dirname(filePath);

  try {
    await mkdir(dirPath, { recursive: true });
    await appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
  } catch (error) {
    logger.warn("[INQUIRY TELEMETRY] append failed", {
      filePath,
      requestId: event.requestId,
      responseType: event.responseType,
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  logger.info("[INQUIRY TELEMETRY] event", {
    requestId: event.requestId,
    userId: event.userId,
    channelId: event.channelId,
    intent: event.intent,
    agentId: event.agentId,
    responseType: event.responseType,
    replySuccess: event.replySuccess,
    usedBusinessFallback: event.usedBusinessFallback,
    usedDeliveryFallback: event.usedDeliveryFallback,
    sessionId: event.sessionId,
    orderNumber: event.orderNumber,
  });
};

export const inquiryTelemetryService = {
  async recordEvent(input: RecordInquiryTelemetryInput): Promise<void> {
    try {
      await appendEvent(buildEvent(input));
    } catch (error) {
      logger.warn("[INQUIRY TELEMETRY] recordEvent failed", {
        requestId: input.requestId,
        responseType: input.responseType,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },

  setOutputPathForTesting(filePath: string | null): void {
    outputPathOverride = filePath;
  },

  async readEventsForTesting(): Promise<InquiryTelemetryEvent[]> {
    const filePath = getOutputPath();
    try {
      const content = await readFile(filePath, "utf8");
      return content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as InquiryTelemetryEvent);
    } catch {
      return [];
    }
  },

  async resetForTesting(): Promise<void> {
    const filePath = getOutputPath();
    try {
      await rm(filePath, { force: true });
    } catch {
      // ignore
    }
  },
};
