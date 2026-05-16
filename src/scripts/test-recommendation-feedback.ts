import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { buildHermesRegistry } from "../hermes/registry";
import { HermesRouter } from "../hermes/router";
import { recommendationFeedbackService } from "../services/recommendation-feedback.service";
import { orderService } from "../services/order.service";
import { shopifyService } from "../services/shopify.service";
import type { RecommendationFeedbackEvent } from "../types/recommendation-feedback.types";

const ensure = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const QUERY = "Show me 10 black gold SSR female cards";

const buildMockCheckout = (imageUrl: string, orderNumber: string) => ({
  orderNumber,
  galleryCardId: "mock-gallery-card-id",
  shopifyProductId: "mock-shopify-product-id",
  productTitle: "Crimson Neon Valkyrie | LC-000001-BUEZ",
  productCode: "LC-000001-BUEZ",
  productHandle: "crimson-neon-valkyrie-lc-000001-buez",
  sku: "LC-000001-BUEZ",
  productUrl: "https://example.com/products/crimson-neon-valkyrie-lc-000001-buez",
  purchaseUrl: "https://example.com/cart/mock-variant:1?note=mock-order",
  shareImageUrl: imageUrl,
});

const runFlow = async (suffix: string): Promise<{ orderNumber: string }> => {
  const registry = buildHermesRegistry();
  const router = new HermesRouter(registry);
  const discordUserId = `test-feedback-user-${suffix}`;
  const discordChannelId = `test-feedback-channel-${suffix}`;

  const searchResponse = await router.handle({
    text: QUERY,
    userId: discordUserId,
    channelId: discordChannelId,
  });

  assert.equal(searchResponse.type, "gallery_search_results");
  ensure(searchResponse.cards.length > 0, "Expected gallery search results");

  const checkoutResponse = await router.handle({
    text: "1",
    userId: discordUserId,
    channelId: discordChannelId,
  });

  assert.equal(checkoutResponse.type, "gallery_checkout_created");
  ensure(checkoutResponse.orderNumber, "Expected checkout order number");

  const paidOrder = await orderService.markPaid({
    orderNumber: checkoutResponse.orderNumber,
  });

  assert.equal(paidOrder.status, "paid");

  return {
    orderNumber: checkoutResponse.orderNumber,
  };
};

const findEvent = (
  events: RecommendationFeedbackEvent[],
  eventType: RecommendationFeedbackEvent["eventType"]
): RecommendationFeedbackEvent | undefined => events.find((event) => event.eventType === eventType);

const main = async (): Promise<void> => {
  const originalCreateProductFromGalleryCard = shopifyService.createProductFromGalleryCard;
  const testLogPath = path.join(process.cwd(), "reports", `recommendation-feedback-test-${Date.now()}.jsonl`);

  recommendationFeedbackService.setOutputPathForTesting(testLogPath);
  await recommendationFeedbackService.resetForTesting();

  shopifyService.createProductFromGalleryCard = async (selectedCard, order) =>
    buildMockCheckout(selectedCard.imageUrl, order.orderNumber);

  try {
    const normalFlow = await runFlow(`ok-${Date.now()}`);
    const events = await recommendationFeedbackService.readEventsForTesting();

    const searchEvent = findEvent(events, "search");
    const selectionEvent = findEvent(events, "selection");
    const checkoutEvent = findEvent(events, "checkout_created");
    const paidEvent = findEvent(events, "purchase_completed");

    ensure(events.length >= 4, "Expected at least 4 feedback events");
    ensure(searchEvent, "Expected search feedback event");
    ensure(selectionEvent, "Expected selection feedback event");
    ensure(checkoutEvent, "Expected checkout_created feedback event");
    ensure(paidEvent, "Expected purchase_completed feedback event");

    assert.equal(checkoutEvent?.checkoutCreated, true);
    assert.equal(checkoutEvent?.purchased, false);
    assert.equal(checkoutEvent?.orderNumber, normalFlow.orderNumber);
    assert.equal(paidEvent?.purchased, true);
    assert.equal(paidEvent?.orderNumber, normalFlow.orderNumber);
    ensure(searchEvent?.recommendationDebugSummary, "Expected recommendation summary on search event");
    ensure(
      (searchEvent?.recommendationDebugSummary?.top10BeforeRerank.length ?? 0) <= 10,
      "Expected top10BeforeRerank <= 10"
    );
    ensure(
      (searchEvent?.recommendationDebugSummary?.top10AfterRerank.length ?? 0) <= 10,
      "Expected top10AfterRerank <= 10"
    );

    console.log(
      JSON.stringify(
        {
          normalFlow: {
            orderNumber: normalFlow.orderNumber,
            eventTypes: events.map((event) => event.eventType),
            searchEvent,
            selectionEvent,
            checkoutEvent,
            paidEvent,
          },
        },
        null,
        2
      )
    );

    const failingOutputPath = path.join(process.cwd(), "reports", `recommendation-feedback-blocked-${Date.now()}`);
    await mkdir(failingOutputPath, { recursive: true });
    recommendationFeedbackService.setOutputPathForTesting(failingOutputPath);

    const failureIsolatedFlow = await runFlow(`fail-${Date.now()}`);
    ensure(failureIsolatedFlow.orderNumber, "Expected failure-isolated flow to complete");

    console.log(
      JSON.stringify(
        {
          failureIsolation: {
            outputPath: failingOutputPath,
            orderNumber: failureIsolatedFlow.orderNumber,
            mainFlowStatus: "passed",
          },
        },
        null,
        2
      )
    );
  } finally {
    shopifyService.createProductFromGalleryCard = originalCreateProductFromGalleryCard;
    recommendationFeedbackService.setOutputPathForTesting(null);
  }
};

main().catch((error) => {
  console.error("[TEST RECOMMENDATION FEEDBACK] failed", error);
  process.exit(1);
});
