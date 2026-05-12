import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import { gallerySearchSessionRepository } from "../repositories/gallery-search-session.repository";
import { orderService } from "../services/order.service";
import { shopifyService } from "../services/shopify.service";
import { createCheckoutLinkSkill } from "../skills/gallery/create-checkout-link.skill";
import { searchGallerySkill } from "../skills/gallery/search-gallery.skill";
import { selectCardSkill } from "../skills/gallery/select-card.skill";

const discordUserId = "test-user";
const discordChannelId = "test-channel";
const query = "给我10张黑金SSR女角色卡牌";

const ensure = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async (): Promise<void> => {
  const searchResult = await searchGallerySkill(
    {
      query,
      discordUserId,
      discordChannelId,
    },
    {
      requestId: `${Date.now()}`,
      language: "zh",
      userId: discordUserId,
      channelId: discordChannelId,
      skillId: "gallery.search",
    }
  );

  ensure(searchResult.results.length > 0, "Expected gallery search results for select test");

  const session = await gallerySearchSessionRepository.findLatest({
    discordUserId,
    discordChannelId,
  });
  ensure(session, "Expected gallery search session to be created");
  if (!session) {
    throw new Error("Expected gallery search session to be created");
  }
  ensure(Array.isArray(session.results), "Expected gallery search session results to be an array");

  const originalCreateProductFromGalleryCard = shopifyService.createProductFromGalleryCard;
  shopifyService.createProductFromGalleryCard = async () => ({
    shopifyProductId: "mock-shopify-product-id",
    checkoutUrl: "https://example.com/mock-checkout",
  });

  try {
    const selectResult = await selectCardSkill(
      {
        discordUserId,
        discordChannelId,
        selectedIndex: 1,
      },
      {
        requestId: `${Date.now()}`,
        language: "zh",
        userId: discordUserId,
        channelId: discordChannelId,
        skillId: "gallery.selectCard",
      }
    );

    ensure(selectResult.selectedCard.galleryCardId, "Expected selected card id to exist");
    ensure(selectResult.order.status === "pending", "Expected selected order to start as pending");

    const checkoutResult = await createCheckoutLinkSkill(selectResult, {
      requestId: `${Date.now()}`,
      language: "zh",
      userId: discordUserId,
      channelId: discordChannelId,
      skillId: "gallery.createCheckoutLink",
    });

    const persistedOrder = await orderService.findByOrderNumber(checkoutResult.order.orderNumber);
    ensure(checkoutResult.checkoutUrl, "Expected checkoutUrl to be returned");
    ensure(persistedOrder, "Expected created order to be persisted");
    if (!persistedOrder) {
      throw new Error("Expected created order to be persisted");
    }
    ensure(persistedOrder.status === "checkout_created", "Expected order status to become checkout_created");

    console.log(`[TEST GALLERY SELECT] selectedCard.title=${checkoutResult.selectedCard.title}`);
    console.log(`[TEST GALLERY SELECT] order.orderNumber=${checkoutResult.order.orderNumber}`);
    console.log(`[TEST GALLERY SELECT] order.status=${checkoutResult.order.status}`);
    console.log(`[TEST GALLERY SELECT] checkoutUrl=${checkoutResult.checkoutUrl}`);
    console.log(
      `[TEST GALLERY SELECT] persistedOrder=${JSON.stringify({
        orderNumber: persistedOrder.orderNumber,
        status: persistedOrder.status,
        shopifyProductId: persistedOrder.shopifyProductId,
        shopifyCheckoutUrl: persistedOrder.shopifyCheckoutUrl,
      })}`
    );
  } finally {
    shopifyService.createProductFromGalleryCard = originalCreateProductFromGalleryCard;
  }
};

main().catch((error) => {
  console.error("[TEST GALLERY SELECT] failed", error);
  process.exit(1);
});
