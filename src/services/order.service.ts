import { orderRepository } from "../repositories/order.repository";

export type OrderRecord = {
  id: string;
  orderNumber: string;
  discordUserId: string;
  galleryCardId: string;
  amount: string;
};

export const orderService = {
  async createOrder(input: {
    discordUserId: string;
    galleryCardId: string;
    amount: string;
  }): Promise<OrderRecord> {
    return orderRepository.create(input);
  },
};
