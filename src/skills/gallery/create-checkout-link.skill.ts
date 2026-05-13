import { SkillContext, SkillHandler } from "../../hermes/types";
import { orderService } from "../../services/order.service";
import { ShopifyGalleryCardInput, ShopifyOrderInput, shopifyService } from "../../services/shopify.service";
import { t } from "../../utils/i18n";
import { logger } from "../../utils/logger";
import { UserFacingError, isUserFacingError } from "../../utils/user-facing-error";

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
    shopifyProductUrl: string | null;
    shopifyShareImageUrl: string | null;
    shopifyProductHandle: string | null;
  };
  productTitle: string;
  productCode: string;
  productUrl: string;
  purchaseUrl: string;
  shareImageUrl: string;
  productHandle: string;
  sku: string;
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
  logger.info("[CREATE CHECKOUT LINK SKILL] start", {
    orderNumber: input.order.orderNumber,
    galleryCardId: selectedCard.galleryCardId,
    title: selectedCard.title,
  });

  try {
    const result = await shopifyService.createProductFromGalleryCard(selectedCard, input.order);
    const updatedOrder = await orderService.updateShopifyLink({
      orderId: input.order.id,
      shopifyProductId: result.shopifyProductId,
      shopifyCheckoutUrl: result.purchaseUrl,
      shopifyProductUrl: result.productUrl,
      shopifyShareImageUrl: result.shareImageUrl,
      shopifyProductHandle: result.productHandle,
      status: "checkout_created",
    });

      logger.info("[CREATE CHECKOUT LINK SKILL] success", {
      orderNumber: updatedOrder.orderNumber,
      galleryCardId: result.galleryCardId,
      shopifyProductId: result.shopifyProductId,
      productTitle: result.productTitle,
      productCode: result.productCode,
      productHandle: result.productHandle,
      sku: result.sku,
      productUrl: result.productUrl,
      purchaseUrl: result.purchaseUrl,
      shareImageUrl: result.shareImageUrl,
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
        shopifyProductUrl: updatedOrder.shopifyProductUrl,
        shopifyShareImageUrl: updatedOrder.shopifyShareImageUrl,
        shopifyProductHandle: updatedOrder.shopifyProductHandle,
      },
      productTitle: result.productTitle,
      productCode: result.productCode,
      productUrl: result.productUrl,
      purchaseUrl: result.purchaseUrl,
      shareImageUrl: result.shareImageUrl,
      productHandle: result.productHandle,
      sku: result.sku,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("[CREATE CHECKOUT LINK SKILL] failed", {
      orderNumber: input.order.orderNumber,
      galleryCardId: selectedCard.galleryCardId,
      message,
    });
    if (isUserFacingError(error)) {
      throw error;
    }
    throw new UserFacingError(t(context.language, "checkout.failed"), {
      code: "checkout.failed",
      stage: "checkout",
      metadata: {
        orderNumber: input.order.orderNumber,
        galleryCardId: selectedCard.galleryCardId,
        message,
      },
    });
  }
};

export const CreateCheckoutLinkSkill = {
  handle: createCheckoutLink,
};

export const createCheckoutLinkSkill = createCheckoutLink;
