import { SkillContext, SkillHandler } from "../../hermes/types";
import { orderService } from "../../services/order.service";
import { ShopifyGalleryCardInput, ShopifyOrderInput, shopifyService } from "../../services/shopify.service";
import { t } from "../../utils/i18n";

export type CreateCheckoutLinkInput = ShopifyGalleryCardInput & {
  order: ShopifyOrderInput;
  selectedCard?: ShopifyGalleryCardInput;
};

export type CreateCheckoutLinkOutput = {
  selectedCard: ShopifyGalleryCardInput;
  order: {
    id: string;
    orderNumber: string;
    amount: string;
    status: string;
    shopifyProductId: string | null;
    shopifyCheckoutUrl: string | null;
  };
  checkoutUrl: string;
};

const normalizeSelectedCard = (input: CreateCheckoutLinkInput): ShopifyGalleryCardInput =>
  input.selectedCard ?? {
    galleryCardId: input.galleryCardId,
    title: input.title,
    description: input.description,
    imageUrl: input.imageUrl,
    price: input.price,
    tags: input.tags,
  };

export const createCheckoutLink: SkillHandler<CreateCheckoutLinkInput, CreateCheckoutLinkOutput> = async (
  input,
  context: SkillContext
) => {
  void t(context.language, "checkout.creating");
  const selectedCard = normalizeSelectedCard(input);

  try {
    const result = await shopifyService.createProductFromGalleryCard(selectedCard, input.order);
    const updatedOrder = await orderService.updateShopifyLink({
      orderId: input.order.id,
      shopifyProductId: result.shopifyProductId,
      shopifyCheckoutUrl: result.checkoutUrl,
      status: "checkout_created",
    });

    return {
      selectedCard,
      order: {
        id: updatedOrder.id,
        orderNumber: updatedOrder.orderNumber,
        amount: updatedOrder.amount,
        status: updatedOrder.status,
        shopifyProductId: updatedOrder.shopifyProductId,
        shopifyCheckoutUrl: updatedOrder.shopifyCheckoutUrl,
      },
      checkoutUrl: result.checkoutUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Shopify installation not found")) {
      throw new Error(t(context.language, "checkout.failed"));
    }
    throw error;
  }
};

export const CreateCheckoutLinkSkill = {
  handle: createCheckoutLink,
};

export const createCheckoutLinkSkill = createCheckoutLink;
