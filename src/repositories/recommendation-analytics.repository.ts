import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import path from "node:path";
import { prisma } from "../services/prisma.service";
import type { RecommendationFeedbackEvent } from "../types/recommendation-feedback.types";
import { logger } from "../utils/logger";

export type RecommendationAnalyticsGalleryRecord = {
  id: string;
  title: string;
  description: string | null;
  tags: string[];
  rarity: string | null;
  style: string | null;
  character: string | null;
  color: string | null;
  price: number;
  metadata: Prisma.JsonValue | null;
  isActive: boolean;
};

export type RecommendationAnalyticsOrderRecord = {
  orderNumber: string;
  galleryCardId: string;
  amount: string;
};

export type RecommendationAnalyticsDailyWrite = {
  dateKey: string;
  timezone: string;
  sourceFile: string;
  sourceWindowStart: Date | null;
  sourceWindowEnd: Date | null;
  searchCount: number;
  impressions: number;
  selections: number;
  checkoutCreated: number;
  purchases: number;
  selectionRate: number;
  checkoutRate: number;
  purchaseRate: number;
  reportPayload: Prisma.InputJsonValue;
  generatedAt: Date;
};

export type RecommendationAnalyticsSnapshotWrite = {
  sourceFile: string;
  timezone: string;
  sourceWindowStart: Date | null;
  sourceWindowEnd: Date | null;
  summaryPayload: Prisma.InputJsonValue;
  generatedAt: Date;
};

export type RecommendationAnalyticsRepository = {
  resolveSourceFile: (requestedFile?: string | null) => Promise<string | null>;
  readFeedbackEventsFromFile: (filePath: string) => Promise<{
    content: string;
    parsedEvents: RecommendationFeedbackEvent[];
    totalLines: number;
    invalidLineCount: number;
  }>;
  findGalleryCardsByIds: (cardIds: string[]) => Promise<Map<string, RecommendationAnalyticsGalleryRecord>>;
  findActiveGalleryCardsForCoverage: () => Promise<RecommendationAnalyticsGalleryRecord[]>;
  findOrdersByOrderNumbers: (orderNumbers: string[]) => Promise<Map<string, RecommendationAnalyticsOrderRecord>>;
  upsertDailyAnalytics: (input: RecommendationAnalyticsDailyWrite) => Promise<void>;
  createSnapshot: (input: RecommendationAnalyticsSnapshotWrite) => Promise<void>;
};

const DEFAULT_FEEDBACK_FILE = path.join(process.cwd(), "reports", "recommendation-feedback.jsonl");

let ensureAnalyticsTablesPromise: Promise<void> | null = null;

const parseFeedbackLines = (content: string): {
  parsedEvents: RecommendationFeedbackEvent[];
  totalLines: number;
  invalidLineCount: number;
} => {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parsedEvents: RecommendationFeedbackEvent[] = [];
  let invalidLineCount = 0;

  for (const line of lines) {
    try {
      parsedEvents.push(JSON.parse(line) as RecommendationFeedbackEvent);
    } catch {
      invalidLineCount += 1;
    }
  }

  return {
    parsedEvents,
    totalLines: lines.length,
    invalidLineCount,
  };
};

const ensureAnalyticsTables = async (): Promise<void> => {
  if (!ensureAnalyticsTablesPromise) {
    ensureAnalyticsTablesPromise = (async () => {
      try {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS "RecommendationAnalyticsDaily" (
            "id" TEXT PRIMARY KEY,
            "dateKey" TEXT NOT NULL,
            "timezone" TEXT NOT NULL,
            "sourceFile" TEXT NOT NULL,
            "sourceWindowStart" TIMESTAMP(3),
            "sourceWindowEnd" TIMESTAMP(3),
            "searchCount" INTEGER NOT NULL,
            "impressions" INTEGER NOT NULL,
            "selections" INTEGER NOT NULL,
            "checkoutCreated" INTEGER NOT NULL,
            "purchases" INTEGER NOT NULL,
            "selectionRate" DOUBLE PRECISION NOT NULL,
            "checkoutRate" DOUBLE PRECISION NOT NULL,
            "purchaseRate" DOUBLE PRECISION NOT NULL,
            "reportPayload" JSONB NOT NULL,
            "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await prisma.$executeRawUnsafe(
          'CREATE UNIQUE INDEX IF NOT EXISTS "RecommendationAnalyticsDaily_dateKey_timezone_sourceFile_key" ON "RecommendationAnalyticsDaily" ("dateKey", "timezone", "sourceFile")'
        );
        await prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS "RecommendationAnalyticsSnapshot" (
            "id" TEXT PRIMARY KEY,
            "sourceFile" TEXT NOT NULL,
            "timezone" TEXT NOT NULL,
            "sourceWindowStart" TIMESTAMP(3),
            "sourceWindowEnd" TIMESTAMP(3),
            "summaryPayload" JSONB NOT NULL,
            "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
      } catch (error) {
        logger.warn("[RECOMMENDATION ANALYTICS REPOSITORY] ensure tables failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    })();
  }

  return ensureAnalyticsTablesPromise;
};

export const recommendationAnalyticsRepository: RecommendationAnalyticsRepository = {
  async resolveSourceFile(requestedFile) {
    const filePath = requestedFile ? path.resolve(requestedFile) : DEFAULT_FEEDBACK_FILE;
    try {
      await access(filePath);
      return filePath;
    } catch {
      return null;
    }
  },
  async readFeedbackEventsFromFile(filePath) {
    const content = await readFile(filePath, "utf8");
    const parsed = parseFeedbackLines(content);
    return {
      content,
      ...parsed,
    };
  },
  async findGalleryCardsByIds(cardIds) {
    if (cardIds.length === 0) {
      return new Map<string, RecommendationAnalyticsGalleryRecord>();
    }

    const records = await prisma.galleryCard.findMany({
      where: {
        id: {
          in: cardIds,
        },
      },
      select: {
        id: true,
        title: true,
        description: true,
        tags: true,
        rarity: true,
        style: true,
        character: true,
        color: true,
        price: true,
        metadata: true,
        isActive: true,
      },
    });

    return new Map(
      records.map((record) => [
        record.id,
        {
          id: record.id,
          title: record.title,
          description: record.description,
          tags: record.tags,
          rarity: record.rarity,
          style: record.style,
          character: record.character,
          color: record.color,
          price: Number(record.price),
          metadata: record.metadata,
          isActive: record.isActive,
        },
      ])
    );
  },
  async findActiveGalleryCardsForCoverage() {
    const records = await prisma.galleryCard.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        title: true,
        description: true,
        tags: true,
        rarity: true,
        style: true,
        character: true,
        color: true,
        price: true,
        metadata: true,
        isActive: true,
      },
    });

    return records.map((record) => ({
      id: record.id,
      title: record.title,
      description: record.description,
      tags: record.tags,
      rarity: record.rarity,
      style: record.style,
      character: record.character,
      color: record.color,
      price: Number(record.price),
      metadata: record.metadata,
      isActive: record.isActive,
    }));
  },
  async findOrdersByOrderNumbers(orderNumbers) {
    if (orderNumbers.length === 0) {
      return new Map<string, RecommendationAnalyticsOrderRecord>();
    }

    const records = await prisma.order.findMany({
      where: {
        orderNumber: {
          in: orderNumbers,
        },
      },
      select: {
        orderNumber: true,
        galleryCardId: true,
        amount: true,
      },
    });

    return new Map(
      records.map((record) => [
        record.orderNumber,
        {
          orderNumber: record.orderNumber,
          galleryCardId: record.galleryCardId,
          amount: record.amount.toString(),
        },
      ])
    );
  },
  async upsertDailyAnalytics(input) {
    await ensureAnalyticsTables();
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO "RecommendationAnalyticsDaily" (
          "id",
          "dateKey",
          "timezone",
          "sourceFile",
          "sourceWindowStart",
          "sourceWindowEnd",
          "searchCount",
          "impressions",
          "selections",
          "checkoutCreated",
          "purchases",
          "selectionRate",
          "checkoutRate",
          "purchaseRate",
          "reportPayload",
          "generatedAt"
        )
        VALUES (
          $16,
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14::jsonb,
          $15
        )
        ON CONFLICT ("dateKey", "timezone", "sourceFile")
        DO UPDATE SET
          "sourceWindowStart" = EXCLUDED."sourceWindowStart",
          "sourceWindowEnd" = EXCLUDED."sourceWindowEnd",
          "searchCount" = EXCLUDED."searchCount",
          "impressions" = EXCLUDED."impressions",
          "selections" = EXCLUDED."selections",
          "checkoutCreated" = EXCLUDED."checkoutCreated",
          "purchases" = EXCLUDED."purchases",
          "selectionRate" = EXCLUDED."selectionRate",
          "checkoutRate" = EXCLUDED."checkoutRate",
          "purchaseRate" = EXCLUDED."purchaseRate",
          "reportPayload" = EXCLUDED."reportPayload",
          "generatedAt" = EXCLUDED."generatedAt"
      `,
      input.dateKey,
      input.timezone,
      input.sourceFile,
      input.sourceWindowStart,
      input.sourceWindowEnd,
      input.searchCount,
      input.impressions,
      input.selections,
      input.checkoutCreated,
      input.purchases,
      input.selectionRate,
      input.checkoutRate,
      input.purchaseRate,
      JSON.stringify(input.reportPayload),
      input.generatedAt,
      randomUUID()
    );
  },
  async createSnapshot(input) {
    await ensureAnalyticsTables();
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO "RecommendationAnalyticsSnapshot" (
          "id",
          "sourceFile",
          "timezone",
          "sourceWindowStart",
          "sourceWindowEnd",
          "summaryPayload",
          "generatedAt"
        )
        VALUES (
          $7,
          $1,
          $2,
          $3,
          $4,
          $5::jsonb,
          $6
        )
      `,
      input.sourceFile,
      input.timezone,
      input.sourceWindowStart,
      input.sourceWindowEnd,
      JSON.stringify(input.summaryPayload),
      input.generatedAt,
      randomUUID()
    );
  },
};
