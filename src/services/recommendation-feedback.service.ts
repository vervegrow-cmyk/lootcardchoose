import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { OrderRecord } from "./order.service";
import { gallerySearchSessionRepository } from "../repositories/gallery-search-session.repository";
import { logger } from "../utils/logger";
import type {
  RecommendationFeedbackCapturedSnapshot,
  RecommendationFeedbackCheckoutInput,
  RecommendationFeedbackContext,
  RecommendationFeedbackDebugSummary,
  RecommendationFeedbackEvent,
  RecommendationFeedbackSearchInput,
  RecommendationFeedbackSelectionInput,
} from "../types/recommendation-feedback.types";

const FEEDBACK_ITEM_LIMIT = 10;
const DEFAULT_OUTPUT_PATH = path.join(process.cwd(), "reports", "recommendation-feedback.jsonl");

let outputPathOverride: string | null = null;
let latestSnapshot: RecommendationFeedbackCapturedSnapshot | null = null;
const sessionContextById = new Map<string, RecommendationFeedbackContext>();
const orderContextByNumber = new Map<string, RecommendationFeedbackContext>();

const getOutputPath = (): string => outputPathOverride ?? DEFAULT_OUTPUT_PATH;

const limitItems = <T>(items: T[]): T[] => items.slice(0, FEEDBACK_ITEM_LIMIT);

const normalizeSummary = (
  summary: RecommendationFeedbackDebugSummary | null | undefined
): RecommendationFeedbackDebugSummary | null => {
  if (!summary) {
    return null;
  }

  return {
    parsedOldFields: {
      ...summary.parsedOldFields,
      keywords: [...summary.parsedOldFields.keywords],
      tags: [...summary.parsedOldFields.tags],
    },
    intelligenceQuery: {
      visualStyle: [...summary.intelligenceQuery.visualStyle],
      moodTags: [...summary.intelligenceQuery.moodTags],
      toneTags: [...summary.intelligenceQuery.toneTags],
      characterTypes: [...summary.intelligenceQuery.characterTypes],
      archetypeTags: [...summary.intelligenceQuery.archetypeTags],
      settingTags: [...summary.intelligenceQuery.settingTags],
      genreTags: [...summary.intelligenceQuery.genreTags],
      colorHints: [...summary.intelligenceQuery.colorHints],
      rarityHints: [...summary.intelligenceQuery.rarityHints],
      commerceIntent: [...summary.intelligenceQuery.commerceIntent],
      safetyIntent: summary.intelligenceQuery.safetyIntent,
    },
    candidateCount: summary.candidateCount,
    usedFallback: summary.usedFallback,
    rerankHappened: summary.rerankHappened,
    parserOutcome: summary.parserOutcome,
    parserTimedOut: summary.parserTimedOut,
    parserUsedFallback: summary.parserUsedFallback,
    parserFallbackReason: summary.parserFallbackReason ?? null,
    top10BeforeRerank: limitItems(summary.top10BeforeRerank).map((item) => ({
      id: item.id,
      title: item.title,
      scoreTotal: item.scoreTotal,
      scoreReasons: [...item.scoreReasons],
    })),
    top10AfterRerank: limitItems(summary.top10AfterRerank).map((item) => ({
      id: item.id,
      title: item.title,
      scoreTotal: item.scoreTotal,
      scoreReasons: [...item.scoreReasons],
    })),
  };
};

const rememberSessionContext = (sessionId: string | null, context: RecommendationFeedbackContext): void => {
  if (!sessionId) {
    return;
  }
  sessionContextById.set(sessionId, {
    ...context,
    recommendationDebugSummary: normalizeSummary(context.recommendationDebugSummary),
  });
};

const rememberOrderContext = (orderNumber: string, context: RecommendationFeedbackContext): void => {
  orderContextByNumber.set(orderNumber, {
    ...context,
    recommendationDebugSummary: normalizeSummary(context.recommendationDebugSummary),
  });
};

const resolveSummaryForQuery = (query: string | null): RecommendationFeedbackDebugSummary | null => {
  if (!query || !latestSnapshot || latestSnapshot.query !== query) {
    return null;
  }
  return normalizeSummary(latestSnapshot.summary);
};

const buildEvent = (input: {
  eventType: RecommendationFeedbackEvent["eventType"];
  sessionId: string | null;
  orderNumber?: string | null;
  query?: string | null;
  selectedCardId?: string | null;
  checkoutCreated: boolean;
  purchased: boolean;
  orphan: boolean;
  recommendationDebugSummary: RecommendationFeedbackDebugSummary | null;
}): RecommendationFeedbackEvent => ({
  timestamp: new Date().toISOString(),
  eventType: input.eventType,
  sessionId: input.sessionId,
  orderNumber: input.orderNumber ?? null,
  query: input.query ?? null,
  selectedCardId: input.selectedCardId ?? null,
  checkoutCreated: input.checkoutCreated,
  purchased: input.purchased,
  orphan: input.orphan,
  parserOutcome: input.recommendationDebugSummary?.parserOutcome,
  parserTimedOut: input.recommendationDebugSummary?.parserTimedOut,
  parserUsedFallback: input.recommendationDebugSummary?.parserUsedFallback,
  parserFallbackReason: input.recommendationDebugSummary?.parserFallbackReason ?? null,
  rerankHappened: input.recommendationDebugSummary?.rerankHappened,
  recommendationDebugSummary: normalizeSummary(input.recommendationDebugSummary),
});

const appendEvent = async (event: RecommendationFeedbackEvent): Promise<void> => {
  const filePath = getOutputPath();
  const dirPath = path.dirname(filePath);

  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    logger.warn("[RECOMMENDATION FEEDBACK] mkdir failed", {
      filePath,
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  try {
    await appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
  } catch (error) {
    logger.warn("[RECOMMENDATION FEEDBACK] append failed", {
      filePath,
      eventType: event.eventType,
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  logger.info("[RECOMMENDATION FEEDBACK] event", {
    eventType: event.eventType,
    sessionId: event.sessionId,
    orderNumber: event.orderNumber,
    selectedCardId: event.selectedCardId,
    checkoutCreated: event.checkoutCreated,
    purchased: event.purchased,
    orphan: event.orphan,
  });
};

export const recommendationFeedbackService = {
  captureLatestSearchSnapshot(snapshot: RecommendationFeedbackCapturedSnapshot): void {
    latestSnapshot = {
      query: snapshot.query,
      summary: normalizeSummary(snapshot.summary) ?? snapshot.summary,
    };
  },

  async recordEvent(event: RecommendationFeedbackEvent): Promise<void> {
    try {
      await appendEvent(event);
    } catch (error) {
      logger.warn("[RECOMMENDATION FEEDBACK] recordEvent failed", {
        eventType: event.eventType,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async recordSearch(input: RecommendationFeedbackSearchInput): Promise<void> {
    try {
      const recommendationDebugSummary = resolveSummaryForQuery(input.query);
      rememberSessionContext(input.sessionId, {
        sessionId: input.sessionId,
        query: input.query,
        selectedCardId: null,
        discordUserId: null,
        recommendationDebugSummary,
      });

      await this.recordEvent(
        buildEvent({
          eventType: "search",
          sessionId: input.sessionId,
          query: input.query,
          checkoutCreated: false,
          purchased: false,
          orphan: input.sessionId == null,
          recommendationDebugSummary,
        })
      );
    } catch (error) {
      logger.warn("[RECOMMENDATION FEEDBACK] recordSearch failed", {
        sessionId: input.sessionId,
        query: input.query,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async recordSelection(input: RecommendationFeedbackSelectionInput): Promise<void> {
    try {
      const existingContext = input.sessionId ? sessionContextById.get(input.sessionId) ?? null : null;
      const recommendationDebugSummary =
        normalizeSummary(existingContext?.recommendationDebugSummary) ?? resolveSummaryForQuery(input.query);

      rememberSessionContext(input.sessionId, {
        sessionId: input.sessionId,
        query: input.query,
        selectedCardId: input.selectedCardId,
        discordUserId: existingContext?.discordUserId ?? null,
        recommendationDebugSummary,
      });

      await this.recordEvent(
        buildEvent({
          eventType: "selection",
          sessionId: input.sessionId,
          query: input.query,
          selectedCardId: input.selectedCardId,
          checkoutCreated: false,
          purchased: false,
          orphan: input.sessionId == null,
          recommendationDebugSummary,
        })
      );
    } catch (error) {
      logger.warn("[RECOMMENDATION FEEDBACK] recordSelection failed", {
        sessionId: input.sessionId,
        selectedCardId: input.selectedCardId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async recordCheckoutCreated(input: RecommendationFeedbackCheckoutInput): Promise<void> {
    try {
      const existingContext = input.sessionId ? sessionContextById.get(input.sessionId) ?? null : null;
      const recommendationDebugSummary =
        normalizeSummary(existingContext?.recommendationDebugSummary) ?? resolveSummaryForQuery(input.query);

      const context: RecommendationFeedbackContext = {
        sessionId: input.sessionId,
        query: input.query,
        selectedCardId: input.selectedCardId,
        discordUserId: input.discordUserId,
        recommendationDebugSummary,
      };

      rememberSessionContext(input.sessionId, context);
      rememberOrderContext(input.orderNumber, context);

      await this.recordEvent(
        buildEvent({
          eventType: "checkout_created",
          sessionId: input.sessionId,
          orderNumber: input.orderNumber,
          query: input.query,
          selectedCardId: input.selectedCardId,
          checkoutCreated: true,
          purchased: false,
          orphan: input.sessionId == null,
          recommendationDebugSummary,
        })
      );
    } catch (error) {
      logger.warn("[RECOMMENDATION FEEDBACK] recordCheckoutCreated failed", {
        sessionId: input.sessionId,
        orderNumber: input.orderNumber,
        selectedCardId: input.selectedCardId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async recordPurchaseCompleted(input: { order: OrderRecord }): Promise<void> {
    try {
      let context = orderContextByNumber.get(input.order.orderNumber) ?? null;

      if (!context && input.order.discordUserId) {
        const latestSession = await gallerySearchSessionRepository.findLatestByUserId(input.order.discordUserId);
        if (latestSession) {
          context = {
            sessionId: latestSession.id,
            query: latestSession.query,
            selectedCardId: input.order.galleryCardId,
            discordUserId: input.order.discordUserId,
            recommendationDebugSummary: null,
          };
          rememberSessionContext(latestSession.id, context);
          rememberOrderContext(input.order.orderNumber, context);
        }
      }

      const event = buildEvent({
        eventType: "purchase_completed",
        sessionId: context?.sessionId ?? null,
        orderNumber: input.order.orderNumber,
        query: context?.query ?? null,
        selectedCardId: context?.selectedCardId ?? input.order.galleryCardId,
        checkoutCreated: true,
        purchased: true,
        orphan: context?.sessionId == null,
        recommendationDebugSummary: normalizeSummary(context?.recommendationDebugSummary) ?? null,
      });

      await this.recordEvent(event);
    } catch (error) {
      logger.warn("[RECOMMENDATION FEEDBACK] recordPurchaseCompleted failed", {
        orderNumber: input.order.orderNumber,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },

  setOutputPathForTesting(filePath: string | null): void {
    outputPathOverride = filePath;
  },

  async readEventsForTesting(): Promise<RecommendationFeedbackEvent[]> {
    const filePath = getOutputPath();
    try {
      const content = await readFile(filePath, "utf8");
      return content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RecommendationFeedbackEvent);
    } catch {
      return [];
    }
  },

  async resetForTesting(): Promise<void> {
    latestSnapshot = null;
    sessionContextById.clear();
    orderContextByNumber.clear();

    const filePath = getOutputPath();
    try {
      await rm(filePath, { force: true });
    } catch {
      // ignore
    }
  },
};
