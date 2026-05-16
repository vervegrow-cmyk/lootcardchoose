import { SupportedLanguage } from "../hermes/types";
import { OrderRepositoryRecord, OrderStatus, orderRepository } from "../repositories/order.repository";
import { recommendationFeedbackService } from "./recommendation-feedback.service";

export type OrderRecord = {
  id: string;
  orderNumber: string;
  discordUserId: string;
  galleryCardId: string;
  preferredLanguage: SupportedLanguage | null;
  amount: string;
  status: OrderStatus;
  shopifyProductId: string | null;
  productCode: string | null;
  shopifyCheckoutUrl: string | null;
  shopifyProductUrl: string | null;
  shopifyShareImageUrl: string | null;
  shopifyProductHandle: string | null;
};

export const orderService = {
  async createPendingOrder(input: {
    discordUserId: string;
    galleryCardId: string;
    amount: string;
    preferredLanguage?: SupportedLanguage | null;
  }): Promise<OrderRecord> {
    return orderRepository.createPendingOrder(input);
  },
  async updateShopifyLink(input: {
    orderId: string;
    shopifyProductId: string;
    productCode: string;
    shopifyCheckoutUrl: string;
    shopifyProductUrl: string;
    shopifyShareImageUrl: string;
    shopifyProductHandle: string;
    amount?: string;
    status: "checkout_created";
  }): Promise<OrderRecord> {
    return orderRepository.updateShopifyLink(input);
  },
  async markPaidWithResult(input: { orderNumber: string }): Promise<{
    order: OrderRecord;
    wasAlreadyPaid: boolean;
  }> {
    const order = await orderRepository.findByOrderNumber(input.orderNumber);
    if (!order) {
      throw new Error(`Order not found for orderNumber=${input.orderNumber}`);
    }

    if (order.status === "paid") {
      return {
        order,
        wasAlreadyPaid: true,
      };
    }

    const updatedOrder = await orderRepository.updateStatus({
      orderId: order.id,
      status: "paid",
    });

    await recommendationFeedbackService.recordPurchaseCompleted({
      order: updatedOrder,
    });

    return {
      order: updatedOrder,
      wasAlreadyPaid: false,
    };
  },
  async markPaid(input: { orderNumber: string }): Promise<OrderRecord> {
    const result = await this.markPaidWithResult(input);
    return result.order;
  },
  async findByOrderNumber(orderNumber: string): Promise<OrderRecord | null> {
    return orderRepository.findByOrderNumber(orderNumber);
  },
  async findByShopifyProductId(shopifyProductId: string): Promise<OrderRecord | null> {
    return orderRepository.findByShopifyProductId(shopifyProductId);
  },
  async findByProductCode(productCode: string): Promise<OrderRecord | null> {
    return orderRepository.findByProductCode(productCode);
  },
};
