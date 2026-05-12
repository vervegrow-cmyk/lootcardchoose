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
  title: string;
};

export const orderService = {
  async createOrder(input: {
    discordUserId: string;
    galleryCardId: string;
    amount: string;
  }): Promise<OrderRecord> {
    return orderRepository.create(input);
  },
  async updateShopifyLink(input: {
    orderId: string;
    shopifyProductId: string;
    shopifyCheckoutUrl: string;
    status: "checkout_created";
  }): Promise<OrderRecord> {
    return orderRepository.updateShopifyLink(input);
  },
  async findByShopifyProductId(shopifyProductId: string): Promise<OrderRecord | null> {
    return orderRepository.findByShopifyProductId(shopifyProductId);
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
