import { prisma } from "../services/prisma.service";
import { logger } from "../utils/logger";
import { SupportedLanguage } from "../hermes/types";

export type OrderStatus = "pending" | "checkout_created" | "paid" | "cancelled";

export type OrderRepositoryRecord = {
  id: string;
  orderNumber: string;
  discordUserId: string;
  galleryCardId: string;
  preferredLanguage: SupportedLanguage | null;
  amount: string;
  status: OrderStatus;
  shopifyProductId: string | null;
  shopifyCheckoutUrl: string | null;
  shopifyProductUrl: string | null;
  shopifyShareImageUrl: string | null;
  shopifyProductHandle: string | null;
};

export type OrderRepository = {
  createPendingOrder: (input: {
    discordUserId: string;
    galleryCardId: string;
    amount: string;
    preferredLanguage?: SupportedLanguage | null;
  }) => Promise<OrderRepositoryRecord>;
  updateShopifyLink: (input: {
    orderId: string;
    shopifyProductId: string;
    shopifyCheckoutUrl: string;
    shopifyProductUrl: string;
    shopifyShareImageUrl: string;
    shopifyProductHandle: string;
    amount?: string;
    status: "checkout_created";
  }) => Promise<OrderRepositoryRecord>;
  updateStatus: (input: {
    orderId: string;
    status: OrderStatus;
  }) => Promise<OrderRepositoryRecord>;
  findByOrderNumber: (orderNumber: string) => Promise<OrderRepositoryRecord | null>;
};

let ensureOrderColumnsPromise: Promise<void> | null = null;

const formatAmount = (value: { toString(): string } | number | string): string => {
  const numeric = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(numeric) ? numeric.toFixed(2) : "0.00";
};

const mapOrderRecord = (record: {
  id: string;
  orderNumber: string;
  discordUserId: string;
  galleryCardId: string;
  preferredLanguage: string | null;
  amount: { toString(): string } | number | string;
  status: string;
  shopifyProductId: string | null;
  shopifyCheckoutUrl: string | null;
  shopifyProductUrl: string | null;
  shopifyShareImageUrl: string | null;
  shopifyProductHandle: string | null;
}): OrderRepositoryRecord => ({
  id: record.id,
  orderNumber: record.orderNumber,
  discordUserId: record.discordUserId,
  galleryCardId: record.galleryCardId,
  preferredLanguage: record.preferredLanguage as SupportedLanguage | null,
  amount: formatAmount(record.amount),
  status: record.status as OrderStatus,
  shopifyProductId: record.shopifyProductId,
  shopifyCheckoutUrl: record.shopifyCheckoutUrl,
  shopifyProductUrl: record.shopifyProductUrl,
  shopifyShareImageUrl: record.shopifyShareImageUrl,
  shopifyProductHandle: record.shopifyProductHandle,
});

const ensureOrderColumns = async (): Promise<void> => {
  if (!ensureOrderColumnsPromise) {
    ensureOrderColumnsPromise = (async () => {
      try {
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shopifyProductUrl" TEXT'
        );
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shopifyShareImageUrl" TEXT'
        );
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shopifyProductHandle" TEXT'
        );
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "preferredLanguage" TEXT'
        );
      } catch (error) {
        logger.warn("[ORDER REPOSITORY] ensure order columns failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    })();
  }

  return ensureOrderColumnsPromise;
};

export const orderRepository: OrderRepository = {
  async createPendingOrder(input) {
    await ensureOrderColumns();
    const record = await prisma.order.create({
      data: {
        discordUserId: input.discordUserId,
        galleryCardId: input.galleryCardId,
        preferredLanguage: input.preferredLanguage ?? null,
        amount: input.amount,
        orderNumber: `LC-${Date.now()}`,
        status: "pending",
      },
    });

    return mapOrderRecord(record);
  },
  async updateShopifyLink(input) {
    await ensureOrderColumns();
    const record = await prisma.order.update({
      where: { id: input.orderId },
      data: {
        shopifyProductId: input.shopifyProductId,
        shopifyCheckoutUrl: input.shopifyCheckoutUrl,
        shopifyProductUrl: input.shopifyProductUrl,
        shopifyShareImageUrl: input.shopifyShareImageUrl,
        shopifyProductHandle: input.shopifyProductHandle,
        ...(input.amount ? { amount: input.amount } : {}),
        status: input.status,
      },
    });

    return mapOrderRecord(record);
  },
  async updateStatus(input) {
    await ensureOrderColumns();
    const record = await prisma.order.update({
      where: { id: input.orderId },
      data: {
        status: input.status,
      },
    });

    return mapOrderRecord(record);
  },
  async findByOrderNumber(orderNumber) {
    await ensureOrderColumns();
    const record = await prisma.order.findFirst({
      where: { orderNumber },
    });

    if (!record) {
      return null;
    }

    return mapOrderRecord(record);
  },
};
