import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import assert from "node:assert/strict";
import { buildHermesRegistry } from "../hermes/registry";
import { HermesRouter } from "../hermes/router";
import { gallerySearchSessionRepository } from "../repositories/gallery-search-session.repository";
import { orderService } from "../services/order.service";
import { shopifyService } from "../services/shopify.service";
import { awaitPendingSearchSessionWrite } from "../skills/gallery/search-gallery.skill";

const ensure = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const createSessionResultCard = (card: {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string;
  price: number;
  tags: string[];
}) => ({
  id: card.id,
  title: card.title,
  description: card.description,
  imageUrl: card.imageUrl,
  price: card.price,
  tags: card.tags,
  language: "en" as const,
});

const main = async (): Promise<void> => {
  const registry = buildHermesRegistry();
  const router = new HermesRouter(registry);
  const suffix = `${Date.now()}`;
  const discordUserId = `test-select-user-${suffix}`;
  const discordChannelId = `test-select-channel-${suffix}`;
  const query = "Show me 10 black gold SSR female cards";

  const searchResult = await router.handle({
    text: query,
    userId: discordUserId,
    channelId: discordChannelId,
  });

  assert.equal(searchResult.type, "gallery_search_results");
  ensure(searchResult.cards.length > 0, "Expected gallery search results for select test");

  await awaitPendingSearchSessionWrite({
    discordUserId,
    discordChannelId,
    timeoutMs: 5000,
  });

  const activeSessionsAfterSearch = await gallerySearchSessionRepository.findRecentByUserId({
    discordUserId,
    discordChannelId,
    status: "active",
  });
  assert.equal(activeSessionsAfterSearch.length, 1);

  const originalCreateProductFromGalleryCard = shopifyService.createProductFromGalleryCard;
  let capturedCheckoutPrice: string | null = null;
  shopifyService.createProductFromGalleryCard = async (selectedCard, order) => {
    capturedCheckoutPrice = selectedCard.price;
    return {
      orderNumber: order.orderNumber,
      galleryCardId: selectedCard.galleryCardId,
      shopifyProductId: "mock-shopify-product-id",
      productTitle: "Crimson Neon Valkyrie | LC-000001-BUEZ",
      productCode: "LC-000001-BUEZ",
      productHandle: "crimson-neon-valkyrie-lc-000001-buez",
      sku: "LC-000001-BUEZ",
      productUrl: "https://example.com/products/crimson-neon-valkyrie-lc-000001-buez",
      purchaseUrl: "https://example.com/cart/mock-variant:1?note=mock-order",
      shareImageUrl: selectedCard.imageUrl,
    };
  };

  try {
    const checkoutResponse = await router.handle({
      text: "1",
      userId: discordUserId,
      channelId: discordChannelId,
    });

    assert.equal(checkoutResponse.type, "gallery_checkout_created");
    assert.equal(checkoutResponse.title, "Crimson Neon Valkyrie | LC-000001-BUEZ");
    assert.equal(checkoutResponse.productUrl, "https://example.com/products/crimson-neon-valkyrie-lc-000001-buez");
    assert.equal(checkoutResponse.purchaseUrl, "https://example.com/cart/mock-variant:1?note=mock-order");
    assert.equal(checkoutResponse.productHandle, "crimson-neon-valkyrie-lc-000001-buez");
    assert.ok(checkoutResponse.shareImageUrl);
    assert.equal(checkoutResponse.metadata?.productCode, "LC-000001-BUEZ");

    const persistedOrder = await orderService.findByOrderNumber(checkoutResponse.orderNumber);
    ensure(persistedOrder, "Expected created order to be persisted");
    if (!persistedOrder) {
      throw new Error("Expected created order to be persisted");
    }
    assert.equal(persistedOrder.status, "checkout_created");
    assert.equal(persistedOrder.shopifyProductId, "mock-shopify-product-id");
    assert.equal(persistedOrder.shopifyCheckoutUrl, checkoutResponse.purchaseUrl);
    assert.equal(persistedOrder.shopifyProductUrl, checkoutResponse.productUrl);
    assert.equal(persistedOrder.shopifyShareImageUrl, checkoutResponse.shareImageUrl);
    assert.equal(persistedOrder.shopifyProductHandle, checkoutResponse.productHandle);
    assert.equal(persistedOrder.preferredLanguage, "en");
    assert.equal(persistedOrder.amount, capturedCheckoutPrice);
    assert.equal(checkoutResponse.price, capturedCheckoutPrice);

    console.log(`[TEST GALLERY SELECT] productUrl=${checkoutResponse.productUrl}`);
    console.log(`[TEST GALLERY SELECT] purchaseUrl=${checkoutResponse.purchaseUrl}`);
    console.log(`[TEST GALLERY SELECT] shareImageUrl=${checkoutResponse.shareImageUrl}`);

    await gallerySearchSessionRepository.archiveActiveSessions({
      discordUserId,
      discordChannelId,
    });
    await gallerySearchSessionRepository.create({
      discordUserId,
      discordChannelId,
      query,
      results: searchResult.cards.slice(0, 3).map(createSessionResultCard),
      status: "active",
    });

    const outOfRangeResponse = await router.handle({
      text: "5",
      userId: discordUserId,
      channelId: discordChannelId,
    });
    assert.equal(outOfRangeResponse.type, "text");
    assert.equal(outOfRangeResponse.text, "Please choose a number from 1 to 3.");

    shopifyService.createProductFromGalleryCard = async () => {
      throw new Error("Simulated Shopify creation failure");
    };

    const checkoutFailureResponse = await router.handle({
      text: "1",
      userId: discordUserId,
      channelId: discordChannelId,
    });
    assert.equal(checkoutFailureResponse.type, "text");
    assert.equal(
      checkoutFailureResponse.text,
      "Unable to create a product link right now. Please try again later."
    );

    const activeSessionsAfterFailure = await gallerySearchSessionRepository.findRecentByUserId({
      discordUserId,
      discordChannelId,
      status: "active",
    });
    assert.equal(activeSessionsAfterFailure.length, 1);
  } finally {
    shopifyService.createProductFromGalleryCard = originalCreateProductFromGalleryCard;
  }
};

main().catch((error) => {
  console.error("[TEST GALLERY SELECT] failed", error);
  process.exit(1);
});
