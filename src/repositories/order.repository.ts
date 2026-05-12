import { prisma } from "../services/prisma.service";

export type OrderStatus = "pending" | "checkout_created" | "paid" | "cancelled";

export type OrderRepository = {
  create: (input: {
    discordUserId: string;
    galleryCardId: string;
    amount: string;
  }) => Promise<{
    id: string;
    orderNumber: string;
    discordUserId: string;
    galleryCardId: string;
    amount: string;
    status: OrderStatus;
    shopifyProductId: string | null;
    shopifyCheckoutUrl: string | null;
    title: string;
  }>;
  findByOrderNumber: (orderNumber: string) => Promise<{
    id: string;
    orderNumber: string;
    discordUserId: string;
    galleryCardId: string;
    amount: string;
    status: OrderStatus;
    shopifyProductId: string | null;
    shopifyCheckoutUrl: string | null;
    title: string;
  } | null>;
  findByShopifyProductId: (shopifyProductId: string) => Promise<{
    id: string;
    orderNumber: string;
    discordUserId: string;
    galleryCardId: string;
    amount: string;
    status: OrderStatus;
    shopifyProductId: string | null;
    shopifyCheckoutUrl: string | null;
    title: string;
  } | null>;
  updateShopifyLink: (input: {
    orderId: string;
    shopifyProductId: string;
    shopifyCheckoutUrl: string;
    status: OrderStatus;
  }) => Promise<{
    id: string;
    orderNumber: string;
    discordUserId: string;
    galleryCardId: string;
    amount: string;
    status: OrderStatus;
    shopifyProductId: string | null;
    shopifyCheckoutUrl: string | null;
    title: string;
  }>;
  updateStatus: (input: { orderId: string; status: OrderStatus }) => Promise<{
    id: string;
    orderNumber: string;
    discordUserId: string;
    galleryCardId: string;
    amount: string;
    status: OrderStatus;
    shopifyProductId: string | null;
    shopifyCheckoutUrl: string | null;
    title: string;
  }>;
};

const toOrderRecord = (
  record: Awaited<ReturnType<typeof prisma.order.create>> & { galleryCard?: { title: string } }
) => ({
  id: record.id,
  orderNumber: record.orderNumber,
  discordUserId: record.discordUserId,
  galleryCardId: record.galleryCardId,
  amount: record.amount.toString(),
  status: record.status as OrderStatus,
  shopifyProductId: record.shopifyProductId,
  shopifyCheckoutUrl: record.shopifyCheckoutUrl,
  title: record.galleryCard?.title ?? "",
});

export const orderRepository: OrderRepository = {
  async create(input) {
    const record = await prisma.order.create({
      data: {
        discordUserId: input.discordUserId,
        galleryCardId: input.galleryCardId,
        amount: input.amount,
        orderNumber: `LC-${Date.now()}`,
        status: "pending",
      },
      include: {
        galleryCard: {
          select: {
            title: true,
          },
        },
      },
    });

    return toOrderRecord(record);
  },
  async findByOrderNumber(orderNumber) {
    const record = await prisma.order.findFirst({
      where: { orderNumber },
      include: {
        galleryCard: {
          select: {
            title: true,
          },
        },
      },
    });

    if (!record) {
      return null;
    }

    return toOrderRecord(record);
  },
  async findByShopifyProductId(shopifyProductId) {
    const record = await prisma.order.findFirst({
      where: { shopifyProductId },
      include: {
        galleryCard: {
          select: {
            title: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!record) {
      return null;
    }

    return toOrderRecord(record);
  },
  async updateShopifyLink(input) {
    const record = await prisma.order.update({
      where: { id: input.orderId },
      data: {
        shopifyProductId: input.shopifyProductId,
        shopifyCheckoutUrl: input.shopifyCheckoutUrl,
        status: input.status,
      },
      include: {
        galleryCard: {
          select: {
            title: true,
          },
        },
      },
    });

    return toOrderRecord(record);
  },
  async updateStatus(input) {
    const record = await prisma.order.update({
      where: { id: input.orderId },
      data: {
        status: input.status,
      },
      include: {
        galleryCard: {
          select: {
            title: true,
          },
        },
      },
    });

    return toOrderRecord(record);
  },
};
