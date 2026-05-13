import { SkillContext, SkillHandler } from "../../hermes/types";
import { galleryService } from "../../services/gallery.service";
import { cardPricingService } from "../../services/card-pricing.service";
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

const buildFallbackPricingInput = (selectedCard: ShopifyGalleryCardInput) => ({
  galleryPrice: selectedCard.price,
  metadataPrice: null,
  title: selectedCard.title,
  description: selectedCard.description,
  tags: selectedCard.tags,
  style: null,
  rarity: null,
  category: null,
  character: null,
  color: null,
  marketingTitle: null,
});

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
    const pricingInput =
      (await galleryService.getGalleryCardPricingInput(selectedCard.galleryCardId)) ??
      buildFallbackPricingInput(selectedCard);
    const pricing = cardPricingService.calculate(pricingInput);
    const finalPrice = pricing.finalPrice.toFixed(2);
    const pricedSelectedCard: ShopifyGalleryCardInput = {
      ...selectedCard,
      price: finalPrice,
    };

    logger.info("[CARD PRICING]", {
      galleryCardId: selectedCard.galleryCardId,
      base: pricing.basePrice.toFixed(2),
      adjustment: pricing.adjustment.toFixed(2),
      final: finalPrice,
      tier: pricing.pricingTier,
    });

    const result = await shopifyService.createProductFromGalleryCard(pricedSelectedCard, input.order);
    const updatedOrder = await orderService.updateShopifyLink({
      orderId: input.order.id,
      shopifyProductId: result.shopifyProductId,
      shopifyCheckoutUrl: result.purchaseUrl,
      shopifyProductUrl: result.productUrl,
      shopifyShareImageUrl: result.shareImageUrl,
      shopifyProductHandle: result.productHandle,
      amount: finalPrice,
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
      selectedCard: pricedSelectedCard,
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
