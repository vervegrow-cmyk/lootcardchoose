import assert from "node:assert/strict";
import crypto from "crypto";
import os from "node:os";
import path from "node:path";
import { Client } from "discord.js";
import dotenv from "dotenv";
import { SupportedLanguage } from "../hermes/types";
import { shopifyWebhookEventRepository } from "../repositories/shopify-webhook-event.repository";
import { gallerySearchSessionRepository } from "../repositories/gallery-search-session.repository";
import { discordNotificationService } from "../services/discord-notification.service";
import { galleryService } from "../services/gallery.service";
import { orderService } from "../services/order.service";
import { recommendationFeedbackService } from "../services/recommendation-feedback.service";
import { shopifyWebhookService } from "../services/shopify-webhook.service";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });
process.env.SHOPIFY_CLIENT_SECRET ||= "test-shopify-client-secret";

const ensure = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

type SentNotification = {
  target: "dm" | "channel";
  userId?: string;
  channelId?: string;
  content: string;
};

type TestCard = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string;
  price: number;
  tags: string[];
};

type WebhookPayloadInput = {
  shopifyOrderId: string;
  orderNumber?: string | null;
  note?: string | null;
  noteAttributes?: Array<{ name: string; value: string }>;
  tags?: string;
  lineItems?: Array<{
    productId?: string | null;
    sku?: string | null;
    title?: string | null;
  }>;
};

const sentNotifications: SentNotification[] = [];

const registerFakeDiscordClient = (): void => {
  const fakeClient = {
    users: {
      fetch: async (userId: string) => ({
        createDM: async () => ({
          send: async (content: string) => {
            sentNotifications.push({
              target: "dm",
              userId,
              content,
            });
          },
        }),
      }),
    },
    channels: {
      fetch: async (channelId: string) => ({
        isTextBased: () => true,
        send: async (content: string) => {
          sentNotifications.push({
            target: "channel",
            channelId,
            content,
          });
        },
      }),
    },
  } as unknown as Client;

  discordNotificationService.registerClient(fakeClient);
};

const buildWebhookPayload = (input: WebhookPayloadInput): Buffer =>
  Buffer.from(
    JSON.stringify({
      id: input.shopifyOrderId,
      note: input.note ?? input.orderNumber ?? null,
      note_attributes:
        input.noteAttributes ?? (input.orderNumber ? [{ name: "orderNumber", value: input.orderNumber }] : []),
      tags: input.tags ?? (input.orderNumber ? `gallery, order:${input.orderNumber}` : "gallery"),
      line_items: (input.lineItems ?? []).map((item) => ({
        product_id: item.productId ?? null,
        sku: item.sku ?? null,
        title: item.title ?? null,
      })),
    }),
    "utf8"
  );

const computeWebhookHmac = (rawBody: Buffer): string =>
  crypto
    .createHmac("sha256", process.env.SHOPIFY_CLIENT_SECRET ?? "")
    .update(rawBody)
    .digest("base64");

const createLanguageTaggedResults = (card: TestCard, language: SupportedLanguage, originalQuery: string) => [
  {
    id: card.id,
    title: card.title,
    description: card.description,
    imageUrl: card.imageUrl,
    price: card.price,
    tags: card.tags,
    language,
    batchIndex: 1,
    originalQuery,
  },
];

const buildExpectedMessage = (
  language: SupportedLanguage,
  input: {
    orderNumber: string;
    amount: string;
  }
): string =>
  language === "zh"
    ? `✅ 用户订单已支付\n\n订单号：${input.orderNumber}\n金额：$${input.amount}`
    : `✅ Your order has been paid\n\nOrder number: ${input.orderNumber}\nAmount: $${input.amount}`;

const countPurchaseCompletedEvents = async (orderNumber: string): Promise<number> => {
  const events = await recommendationFeedbackService.readEventsForTesting();
  return events.filter((event) => event.eventType === "purchase_completed" && event.orderNumber === orderNumber).length;
};

const createOrderForWebhook = async (input: {
  discordUserId: string;
  discordChannelId?: string;
  card: TestCard;
  amount: string;
  preferredLanguage?: SupportedLanguage | null;
  sessionLanguage?: SupportedLanguage | null;
  sessionQuery?: string;
  productCode: string;
  shopifyProductId: string;
  shopifyProductHandle: string;
}): Promise<Awaited<ReturnType<typeof orderService.updateShopifyLink>>> => {
  if (input.discordChannelId && input.sessionLanguage && input.sessionQuery) {
    await gallerySearchSessionRepository.create({
      discordUserId: input.discordUserId,
      discordChannelId: input.discordChannelId,
      query: input.sessionQuery,
      results: createLanguageTaggedResults(input.card, input.sessionLanguage, input.sessionQuery),
      status: "active",
    });
  }

  const pendingOrder = await orderService.createPendingOrder({
    discordUserId: input.discordUserId,
    galleryCardId: input.card.id,
    amount: input.amount,
    preferredLanguage: input.preferredLanguage ?? null,
  });

  return orderService.updateShopifyLink({
    orderId: pendingOrder.id,
    shopifyProductId: input.shopifyProductId,
    productCode: input.productCode,
    shopifyCheckoutUrl: "https://example.com/test-checkout",
    shopifyProductUrl: "https://example.com/products/test-product",
    shopifyShareImageUrl: "https://example.com/share-image.jpg",
    shopifyProductHandle: input.shopifyProductHandle,
    amount: input.amount,
    status: "checkout_created",
  });
};

const runPrimaryProcessingScenario = async (card: TestCard, amount: string, suffix: string): Promise<void> => {
  const order = await createOrderForWebhook({
    discordUserId: `test-webhook-user-en-${suffix}`,
    discordChannelId: `test-webhook-channel-en-${suffix}`,
    card,
    amount,
    preferredLanguage: "en",
    sessionLanguage: "en",
    sessionQuery: "girl",
    productCode: `LC-${suffix.slice(-6)}-AEN1`,
    shopifyProductId: `test-shopify-product-id-en-${suffix}`,
    shopifyProductHandle: `test-product-en-${suffix}`,
  });

  const rawBody = buildWebhookPayload({
    shopifyOrderId: `test-shopify-order-${suffix}`,
    orderNumber: order.orderNumber,
  });
  const webhookId = `test-webhook-id-${suffix}`;
  const providedHmac = computeWebhookHmac(rawBody);

  ensure(
    shopifyWebhookService.verifyOrdersPaidWebhook(rawBody, providedHmac),
    "Expected generated Shopify webhook HMAC to verify"
  );

  const beforeCount = sentNotifications.length;
  const result = await shopifyWebhookService.handleOrdersPaidWebhook(rawBody, {
    topic: "orders/paid",
    shopifyWebhookId: webhookId,
  });
  const persistedOrder = await orderService.findByOrderNumber(order.orderNumber);
  const notifications = sentNotifications.slice(beforeCount);
  const webhookEvents = await shopifyWebhookEventRepository.findByWebhookId(webhookId);

  assert.equal(result.orderNumber, order.orderNumber);
  assert.equal(result.status, "paid");
  assert.equal(persistedOrder?.status, "paid");
  assert.equal(notifications.length, 2);
  assert.equal(
    notifications[0]?.content,
    buildExpectedMessage("en", {
      orderNumber: order.orderNumber,
      amount: order.amount,
    })
  );
  assert.equal(await countPurchaseCompletedEvents(order.orderNumber), 1);
  assert.equal(webhookEvents.length, 1);
  assert.equal(webhookEvents[0]?.status, "processed");
  assert.equal(webhookEvents[0]?.resolvedMethod, "orderNumber");

  const duplicateBeforeCount = sentNotifications.length;
  const duplicateResult = await shopifyWebhookService.handleOrdersPaidWebhook(rawBody, {
    topic: "orders/paid",
    shopifyWebhookId: webhookId,
  });
  const duplicateNotifications = sentNotifications.slice(duplicateBeforeCount);
  const duplicateEvents = await shopifyWebhookEventRepository.findByWebhookId(webhookId);

  assert.equal(duplicateResult.status, "duplicate_skipped");
  assert.equal(duplicateNotifications.length, 0);
  assert.equal(await countPurchaseCompletedEvents(order.orderNumber), 1);
  assert.equal(duplicateEvents.length, 2);
  assert.equal(duplicateEvents[1]?.status, "duplicate_skipped");
  assert.equal(duplicateEvents[1]?.resolvedMethod, "duplicate");
};

const runUnresolvedAndRetryScenario = async (card: TestCard, amount: string, suffix: string): Promise<void> => {
  const unresolvedProductCode = `LC-${suffix.slice(-6)}-RTY1`;
  const unresolvedWebhookId = `test-webhook-id-unresolved-${suffix}`;
  const unresolvedRawBody = buildWebhookPayload({
    shopifyOrderId: `test-shopify-order-unresolved-${suffix}`,
    note: null,
    noteAttributes: [],
    tags: "gallery",
    lineItems: [
      {
        sku: unresolvedProductCode,
        productId: `test-shopify-product-id-retry-${suffix}`,
        title: `LootCard ${unresolvedProductCode}`,
      },
    ],
  });

  const unresolvedResult = await shopifyWebhookService.handleOrdersPaidWebhook(unresolvedRawBody, {
    topic: "orders/paid",
    shopifyWebhookId: unresolvedWebhookId,
  });
  const unresolvedEvents = await shopifyWebhookEventRepository.findByWebhookId(unresolvedWebhookId);

  assert.equal(unresolvedResult.status, "unresolved");
  assert.equal(unresolvedEvents.length, 1);
  assert.equal(unresolvedEvents[0]?.status, "unresolved");
  assert.equal(unresolvedEvents[0]?.shopifyOrderId, `test-shopify-order-unresolved-${suffix}`);
  assert.match(unresolvedEvents[0]?.failureReason ?? "", /No local order matched|did not contain/i);

  const retryOrder = await createOrderForWebhook({
    discordUserId: `test-webhook-user-retry-${suffix}`,
    discordChannelId: `test-webhook-channel-retry-${suffix}`,
    card,
    amount,
    preferredLanguage: "en",
    sessionLanguage: "en",
    sessionQuery: "girl",
    productCode: unresolvedProductCode,
    shopifyProductId: `retry-product-${suffix}`,
    shopifyProductHandle: `retry-product-${suffix}`,
  });

  const retryBeforeCount = sentNotifications.length;
  const retrySummary = await shopifyWebhookService.retryPendingWebhookEvents({
    statuses: ["unresolved"],
    limit: 10,
    shopifyWebhookIds: [unresolvedWebhookId],
  });
  const retryNotifications = sentNotifications.slice(retryBeforeCount);
  const retryEvents = await shopifyWebhookEventRepository.findByWebhookId(unresolvedWebhookId);
  const persistedOrder = await orderService.findByOrderNumber(retryOrder.orderNumber);

  assert.equal(retrySummary.scanned >= 1, true);
  assert.equal(retrySummary.processed >= 1, true);
  assert.equal(persistedOrder?.status, "paid");
  assert.equal(retryNotifications.length, 2);
  assert.equal(await countPurchaseCompletedEvents(retryOrder.orderNumber), 1);
  assert.equal(retryEvents[0]?.status, "processed");
  assert.equal(retryEvents[0]?.resolvedMethod, "productCode");
  assert.equal(retryEvents[0]?.resolvedOrderNumber, retryOrder.orderNumber);

  const secondRetrySummary = await shopifyWebhookService.retryPendingWebhookEvents({
    statuses: ["unresolved"],
    limit: 10,
    shopifyWebhookIds: [unresolvedWebhookId],
  });
  assert.equal(secondRetrySummary.scanned, 0);
};

const main = async (): Promise<void> => {
  registerFakeDiscordClient();
  recommendationFeedbackService.setOutputPathForTesting(
    path.join(os.tmpdir(), `lootcard-webhook-feedback-${Date.now()}.jsonl`)
  );
  await recommendationFeedbackService.resetForTesting();

  const searchResult = await galleryService.searchGalleryCards("girl", "en");
  ensure(searchResult.results.length > 0, "Expected at least one gallery card for webhook test");
  const firstCard = searchResult.results[0];
  const amount = firstCard.price.toFixed(2);
  const suffix = Date.now().toString();

  await runPrimaryProcessingScenario(firstCard, amount, suffix);
  await runUnresolvedAndRetryScenario(firstCard, amount, suffix);

  console.log(
    `[TEST SHOPIFY WEBHOOK] summary=${JSON.stringify({
      notificationsSent: sentNotifications.length,
      feedbackEvents: (await recommendationFeedbackService.readEventsForTesting()).length,
    })}`
  );
};

main().catch((error) => {
  console.error("[TEST SHOPIFY WEBHOOK] failed", error);
  process.exit(1);
});
