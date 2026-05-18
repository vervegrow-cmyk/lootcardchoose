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
import { parseValidationCliOptions, saveValidationArtifact } from "./validation-artifact";

const QUERY = "Show me 10 black gold SSR female cards";

type FeedbackValidationReport = {
  runAt: string;
  artifactType: "feedback_validation";
  query: string;
  normalFlow: {
    orderNumber: string;
    eventCounts: Record<string, number>;
    selectionOccurred: boolean;
    checkoutOccurred: boolean;
    paidOccurred: boolean;
    allExpectedEventsPresent: boolean;
    sessionLinked: boolean;
    orderLinked: boolean;
  };
  failureIsolation: {
    outputPath: string;
    orderNumber: string;
    mainFlowStatus: "passed";
  };
  findings: string[];
};

const ensure = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

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

const countEventTypes = (events: RecommendationFeedbackEvent[]): Record<string, number> =>
  events.reduce<Record<string, number>>((acc, event) => {
    acc[event.eventType] = (acc[event.eventType] ?? 0) + 1;
    return acc;
  }, {});

const buildReport = (
  orderNumber: string,
  events: RecommendationFeedbackEvent[],
  failureIsolation: FeedbackValidationReport["failureIsolation"]
): FeedbackValidationReport => {
  const searchEvent = findEvent(events, "search");
  const selectionEvent = findEvent(events, "selection");
  const checkoutEvent = findEvent(events, "checkout_created");
  const paidEvent = findEvent(events, "purchase_completed");
  const uniqueSessionIds = new Set(events.map((event) => event.sessionId).filter(Boolean));
  const linkedOrderEvents = events.filter((event) => event.orderNumber === orderNumber);

  const normalFlow: FeedbackValidationReport["normalFlow"] = {
    orderNumber,
    eventCounts: countEventTypes(events),
    selectionOccurred: Boolean(selectionEvent?.selectedCardId),
    checkoutOccurred: checkoutEvent?.checkoutCreated === true,
    paidOccurred: paidEvent?.purchased === true,
    allExpectedEventsPresent: Boolean(searchEvent && selectionEvent && checkoutEvent && paidEvent),
    sessionLinked: uniqueSessionIds.size === 1,
    orderLinked:
      linkedOrderEvents.some((event) => event.eventType === "checkout_created") &&
      linkedOrderEvents.some((event) => event.eventType === "purchase_completed"),
  };

  const findings: string[] = [];
  if (!normalFlow.selectionOccurred) {
    findings.push("selection event missing from validation flow");
  }
  if (!normalFlow.checkoutOccurred) {
    findings.push("checkout event missing from validation flow");
  }
  if (!normalFlow.paidOccurred) {
    findings.push("purchase_completed event missing from validation flow");
  }
  if (!normalFlow.sessionLinked) {
    findings.push("feedback events were not consistently linked by sessionId");
  }
  if (!normalFlow.orderLinked) {
    findings.push("checkout and purchase events were not consistently linked by orderNumber");
  }
  if (findings.length === 0) {
    findings.push("feedback validation flow completed with search, selection, checkout, and paid events linked");
  }

  return {
    runAt: new Date().toISOString(),
    artifactType: "feedback_validation",
    query: QUERY,
    normalFlow,
    failureIsolation,
    findings,
  };
};

const renderConsoleSummary = (report: FeedbackValidationReport): void => {
  console.log("## Feedback Validation");
  console.log(`- query: ${report.query}`);
  console.log(`- selection occurred: ${report.normalFlow.selectionOccurred}`);
  console.log(`- checkout occurred: ${report.normalFlow.checkoutOccurred}`);
  console.log(`- paid occurred: ${report.normalFlow.paidOccurred}`);
  console.log(`- all expected events present: ${report.normalFlow.allExpectedEventsPresent}`);
  console.log(`- session linked: ${report.normalFlow.sessionLinked}`);
  console.log(`- order linked: ${report.normalFlow.orderLinked}`);
  console.log(`- event counts: ${JSON.stringify(report.normalFlow.eventCounts)}`);

  console.log("");
  console.log("## Findings");
  report.findings.forEach((finding) => {
    console.log(`- ${finding}`);
  });

  console.log("");
  console.log("## Failure Isolation");
  console.log(`- output path: ${report.failureIsolation.outputPath}`);
  console.log(`- order number: ${report.failureIsolation.orderNumber}`);
  console.log(`- main flow status: ${report.failureIsolation.mainFlowStatus}`);
};

const main = async (): Promise<void> => {
  const options = parseValidationCliOptions(process.argv.slice(2));
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

    const failingOutputPath = path.join(process.cwd(), "reports", `recommendation-feedback-blocked-${Date.now()}`);
    await mkdir(failingOutputPath, { recursive: true });
    recommendationFeedbackService.setOutputPathForTesting(failingOutputPath);

    const failureIsolatedFlow = await runFlow(`fail-${Date.now()}`);
    ensure(failureIsolatedFlow.orderNumber, "Expected failure-isolated flow to complete");

    const report = buildReport(normalFlow.orderNumber, events, {
      outputPath: failingOutputPath,
      orderNumber: failureIsolatedFlow.orderNumber,
      mainFlowStatus: "passed",
    });

    if (options.json) {
      const artifactPath = await saveValidationArtifact(report, {
        outputPath: options.outputPath,
        prefix: "feedback-validation",
      });
      console.log(
        JSON.stringify(
          {
            ...report,
            artifactPath,
          },
          null,
          2
        )
      );
      return;
    }

    renderConsoleSummary(report);
  } finally {
    shopifyService.createProductFromGalleryCard = originalCreateProductFromGalleryCard;
    recommendationFeedbackService.setOutputPathForTesting(null);
  }
};

main().catch((error) => {
  console.error("[TEST RECOMMENDATION FEEDBACK] failed", error);
  process.exit(1);
});
