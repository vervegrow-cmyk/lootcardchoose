import { prisma } from "../services/prisma.service";

export type OrderRepository = {
  create: (input: {
    discordUserId: string;
    galleryCardId: string;
    amount: string;
  }) => Promise<{ id: string; orderNumber: string; discordUserId: string; galleryCardId: string; amount: string }>;
};

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
    });

    return {
      id: record.id,
      orderNumber: record.orderNumber,
      discordUserId: record.discordUserId,
      galleryCardId: record.galleryCardId,
      amount: record.amount.toString(),
    };
  },
};
