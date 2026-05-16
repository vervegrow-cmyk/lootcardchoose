import { Prisma } from "@prisma/client";
import { prisma } from "../services/prisma.service";
import { logger } from "../utils/logger";

export type ShopifyWebhookEventStatus =
  | "received"
  | "duplicate_skipped"
  | "resolved"
  | "processed"
  | "unresolved"
  | "failed";

export type ShopifyWebhookResolvedMethod =
  | "orderNumber"
  | "productCode"
  | "shopifyProductId"
  | "titleRegex"
  | "duplicate";

export type ShopifyWebhookEventRecord = {
  id: string;
  topic: string;
  shopifyWebhookId: string | null;
  shopifyOrderId: string | null;
  payload: Prisma.JsonValue;
  resolvedOrderNumber: string | null;
  resolvedMethod: ShopifyWebhookResolvedMethod | null;
  status: ShopifyWebhookEventStatus;
  failureReason: string | null;
  processedAt: Date | null;
  createdAt: Date;
};

export type ShopifyWebhookEventRepository = {
  create: (input: {
    topic: string;
    shopifyWebhookId?: string | null;
    shopifyOrderId?: string | null;
    payload: Prisma.JsonValue;
    status: ShopifyWebhookEventStatus;
  }) => Promise<ShopifyWebhookEventRecord>;
  update: (input: {
    id: string;
    status: ShopifyWebhookEventStatus;
    resolvedOrderNumber?: string | null;
    resolvedMethod?: ShopifyWebhookResolvedMethod | null;
    failureReason?: string | null;
    processedAt?: Date | null;
  }) => Promise<ShopifyWebhookEventRecord>;
  findPriorByWebhookId: (input: {
    shopifyWebhookId: string;
    excludeId: string;
  }) => Promise<ShopifyWebhookEventRecord | null>;
  findByWebhookId: (shopifyWebhookId: string) => Promise<ShopifyWebhookEventRecord[]>;
  listRetryable: (input: {
    statuses: ShopifyWebhookEventStatus[];
    limit: number;
    shopifyWebhookIds?: string[];
  }) => Promise<ShopifyWebhookEventRecord[]>;
};

let ensureShopifyWebhookEventTablePromise: Promise<void> | null = null;

const mapRecord = (record: {
  id: string;
  topic: string;
  shopifyWebhookId: string | null;
  shopifyOrderId: string | null;
  payload: Prisma.JsonValue;
  resolvedOrderNumber: string | null;
  resolvedMethod: string | null;
  status: string;
  failureReason: string | null;
  processedAt: Date | null;
  createdAt: Date;
}): ShopifyWebhookEventRecord => ({
  id: record.id,
  topic: record.topic,
  shopifyWebhookId: record.shopifyWebhookId,
  shopifyOrderId: record.shopifyOrderId,
  payload: record.payload,
  resolvedOrderNumber: record.resolvedOrderNumber,
  resolvedMethod: record.resolvedMethod as ShopifyWebhookResolvedMethod | null,
  status: record.status as ShopifyWebhookEventStatus,
  failureReason: record.failureReason,
  processedAt: record.processedAt,
  createdAt: record.createdAt,
});

const ensureShopifyWebhookEventTable = async (): Promise<void> => {
  if (!ensureShopifyWebhookEventTablePromise) {
    ensureShopifyWebhookEventTablePromise = (async () => {
      try {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS "ShopifyWebhookEvent" (
            "id" TEXT PRIMARY KEY,
            "topic" TEXT NOT NULL,
            "shopifyWebhookId" TEXT,
            "shopifyOrderId" TEXT,
            "payload" JSONB NOT NULL,
            "resolvedOrderNumber" TEXT,
            "resolvedMethod" TEXT,
            "status" TEXT NOT NULL,
            "failureReason" TEXT,
            "processedAt" TIMESTAMP(3),
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await prisma.$executeRawUnsafe(
          'CREATE INDEX IF NOT EXISTS "ShopifyWebhookEvent_shopifyWebhookId_idx" ON "ShopifyWebhookEvent" ("shopifyWebhookId")'
        );
        await prisma.$executeRawUnsafe(
          'CREATE INDEX IF NOT EXISTS "ShopifyWebhookEvent_status_createdAt_idx" ON "ShopifyWebhookEvent" ("status", "createdAt")'
        );
      } catch (error) {
        logger.warn("[SHOPIFY WEBHOOK EVENT REPOSITORY] ensure table failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    })();
  }

  return ensureShopifyWebhookEventTablePromise;
};

export const shopifyWebhookEventRepository: ShopifyWebhookEventRepository = {
  async create(input) {
    await ensureShopifyWebhookEventTable();
    const record = await prisma.shopifyWebhookEvent.create({
      data: {
        topic: input.topic,
        shopifyWebhookId: input.shopifyWebhookId ?? null,
        shopifyOrderId: input.shopifyOrderId ?? null,
        payload: input.payload as Prisma.InputJsonValue,
        status: input.status,
      },
    });

    return mapRecord(record);
  },
  async update(input) {
    await ensureShopifyWebhookEventTable();
    const record = await prisma.shopifyWebhookEvent.update({
      where: { id: input.id },
      data: {
        status: input.status,
        resolvedOrderNumber: input.resolvedOrderNumber,
        resolvedMethod: input.resolvedMethod,
        failureReason: input.failureReason,
        processedAt: input.processedAt,
      },
    });

    return mapRecord(record);
  },
  async findPriorByWebhookId(input) {
    await ensureShopifyWebhookEventTable();
    const record = await prisma.shopifyWebhookEvent.findFirst({
      where: {
        shopifyWebhookId: input.shopifyWebhookId,
        id: { not: input.excludeId },
      },
      orderBy: { createdAt: "asc" },
    });

    if (!record) {
      return null;
    }

    return mapRecord(record);
  },
  async findByWebhookId(shopifyWebhookId) {
    await ensureShopifyWebhookEventTable();
    const records = await prisma.shopifyWebhookEvent.findMany({
      where: { shopifyWebhookId },
      orderBy: { createdAt: "asc" },
    });

    return records.map(mapRecord);
  },
  async listRetryable(input) {
    await ensureShopifyWebhookEventTable();
    const records = await prisma.shopifyWebhookEvent.findMany({
      where: {
        status: {
          in: input.statuses,
        },
        ...(input.shopifyWebhookIds?.length
          ? {
              shopifyWebhookId: {
                in: input.shopifyWebhookIds,
              },
            }
          : {}),
      },
      orderBy: { createdAt: "asc" },
      take: input.limit,
    });

    return records.map(mapRecord);
  },
};
