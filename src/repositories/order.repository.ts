import { prisma } from "../services/prisma.service";

export type OrderStatus = "pending" | "checkout_created" | "paid" | "cancelled";

export type OrderRepositoryRecord = {
  id: string;
  orderNumber: string;
  discordUserId: string;
  galleryCardId: string;
  amount: string;
  status: OrderStatus;
  shopifyProductId: string | null;
  shopifyCheckoutUrl: string | null;
};

export type OrderRepository = {
  createPendingOrder: (input: {
    discordUserId: string;
    galleryCardId: string;
    amount: string;
  }) => Promise<OrderRepositoryRecord>;
  updateShopifyLink: (input: {
    orderId: string;
    shopifyProductId: string;
    shopifyCheckoutUrl: string;
    status: "checkout_created";
  }) => Promise<OrderRepositoryRecord>;
  updateStatus: (input: {
    orderId: string;
    status: OrderStatus;
  }) => Promise<OrderRepositoryRecord>;
  findByOrderNumber: (orderNumber: string) => Promise<OrderRepositoryRecord | null>;
};

export const orderRepository: OrderRepository = {
  async createPendingOrder(input) {
    const record = await prisma.order.create({
      data: {
        discordUserId: input.discordUserId,
        galleryCardId: input.galleryCardId,
        amount: input.amount,
        orderNumber: `LC-${Date.now()}`,
        status: "pending",
      },
    });

    return {
      id: record.id,
      orderNumber: record.orderNumber,
      discordUserId: record.discordUserId,
      galleryCardId: record.galleryCardId,
      amount: record.amount.toString(),
      status: record.status as OrderStatus,
      shopifyProductId: record.shopifyProductId,
      shopifyCheckoutUrl: record.shopifyCheckoutUrl,
    };
  },
  async updateShopifyLink(input) {
    const record = await prisma.order.update({
      where: { id: input.orderId },
      data: {
        shopifyProductId: input.shopifyProductId,
        shopifyCheckoutUrl: input.shopifyCheckoutUrl,
        status: input.status,
      },
    });

    return {
      id: record.id,
      orderNumber: record.orderNumber,
      discordUserId: record.discordUserId,
      galleryCardId: record.galleryCardId,
      amount: record.amount.toString(),
      status: record.status as OrderStatus,
      shopifyProductId: record.shopifyProductId,
      shopifyCheckoutUrl: record.shopifyCheckoutUrl,
    };
  },
  async updateStatus(input) {
    const record = await prisma.order.update({
      where: { id: input.orderId },
      data: {
        status: input.status,
      },
    });

    return {
      id: record.id,
      orderNumber: record.orderNumber,
      discordUserId: record.discordUserId,
      galleryCardId: record.galleryCardId,
      amount: record.amount.toString(),
      status: record.status as OrderStatus,
      shopifyProductId: record.shopifyProductId,
      shopifyCheckoutUrl: record.shopifyCheckoutUrl,
    };
  },
  async findByOrderNumber(orderNumber) {
    const record = await prisma.order.findFirst({
      where: { orderNumber },
    });

    if (!record) {
      return null;
    }

    return {
      id: record.id,
      orderNumber: record.orderNumber,
      discordUserId: record.discordUserId,
      galleryCardId: record.galleryCardId,
      amount: record.amount.toString(),
      status: record.status as OrderStatus,
      shopifyProductId: record.shopifyProductId,
      shopifyCheckoutUrl: record.shopifyCheckoutUrl,
    };
  },
};
