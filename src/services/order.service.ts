import { OrderStatus, orderRepository } from "../repositories/order.repository";

export type OrderRecord = {
  id: string;
  orderNumber: string;
  discordUserId: string;
  galleryCardId: string;
  amount: string;
  status: OrderStatus;
  shopifyProductId: string | null;
  shopifyCheckoutUrl: string | null;
};

export const orderService = {
  async createOrder(input: {
    discordUserId: string;
    galleryCardId: string;
    amount: string;
  }): Promise<OrderRecord> {
    return orderRepository.create(input);
  },
  async markPaid(input: { orderNumber: string }): Promise<OrderRecord> {
    const order = await orderRepository.findByOrderNumber(input.orderNumber);
    if (!order) {
      throw new Error(`Order not found for orderNumber=${input.orderNumber}`);
    }

    if (order.status === "paid") {
      return order;
    }

    return orderRepository.updateStatus({
      orderId: order.id,
      status: "paid",
    });
  },
};
