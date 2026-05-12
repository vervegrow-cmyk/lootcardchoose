import { OrderRepositoryRecord, OrderStatus, orderRepository } from "../repositories/order.repository";

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
  async createPendingOrder(input: {
    discordUserId: string;
    galleryCardId: string;
    amount: string;
  }): Promise<OrderRecord> {
    return orderRepository.createPendingOrder(input);
  },
  async updateShopifyLink(input: {
    orderId: string;
    shopifyProductId: string;
    shopifyCheckoutUrl: string;
    status: "checkout_created";
  }): Promise<OrderRecord> {
    return orderRepository.updateShopifyLink(input);
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
  async findByOrderNumber(orderNumber: string): Promise<OrderRecord | null> {
    return orderRepository.findByOrderNumber(orderNumber);
  },
};
