import { SkillContext, SkillHandler } from "../../hermes/types";
import { orderService } from "../../services/order.service";
import { shopifyService } from "../../services/shopify.service";
import { t } from "../../utils/i18n";

export type CreateCheckoutLinkInput = {
  orderId: string;
  title: string;
  description: string | null;
  imageUrl: string;
  price: string;
  tags: string[];
  orderNumber: string;
};

export type CreateCheckoutLinkOutput = {
  productUrl: string;
};

export const createCheckoutLinkSkill: SkillHandler<
  CreateCheckoutLinkInput,
  CreateCheckoutLinkOutput
> = async (input: CreateCheckoutLinkInput, context: SkillContext) => {
  void t(context.language, "checkout.creating");
  try {
    const result = await shopifyService.createProductFromGalleryCard({
      title: input.title,
      description: input.description,
      imageUrl: input.imageUrl,
      price: input.price,
      tags: input.tags,
      orderNumber: input.orderNumber,
    });
    await orderService.updateShopifyLink({
      orderId: input.orderId,
      shopifyProductId: result.shopifyProductId,
      shopifyCheckoutUrl: result.checkoutUrl,
      status: "checkout_created",
    });
    return { productUrl: result.productUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Shopify installation not found")) {
      throw new Error(t(context.language, "checkout.failed"));
    }
    throw error;
  }
};
