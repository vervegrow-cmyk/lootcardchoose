import assert from "node:assert/strict";
import crypto from "crypto";
import { Client } from "discord.js";
import dotenv from "dotenv";
import { SupportedLanguage } from "../hermes/types";
import { gallerySearchSessionRepository } from "../repositories/gallery-search-session.repository";
import { discordNotificationService } from "../services/discord-notification.service";
import { galleryService } from "../services/gallery.service";
import { orderService } from "../services/order.service";
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

type WebhookScenarioInput = {
  discordUserId: string;
  discordChannelId?: string;
  cardId: string;
  amount: string;
  preferredLanguage?: SupportedLanguage | null;
  sessionLanguage?: SupportedLanguage | null;
  sessionQuery?: string;
  expectedLanguage: SupportedLanguage;
  expectedNotificationCount: number;
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

const buildWebhookPayload = (orderNumber: string): Buffer =>
  Buffer.from(
    JSON.stringify({
      id: `test-shopify-order-${Date.now()}`,
      note: orderNumber,
      note_attributes: [{ name: "orderNumber", value: orderNumber }],
      tags: `gallery, order:${orderNumber}`,
    }),
    "utf8"
  );

const computeWebhookHmac = (rawBody: Buffer): string =>
  crypto
    .createHmac("sha256", process.env.SHOPIFY_CLIENT_SECRET ?? "")
    .update(rawBody)
    .digest("base64");

const createLanguageTaggedResults = (
  card: {
    id: string;
    title: string;
    description: string | null;
    imageUrl: string;
    price: number;
    tags: string[];
  },
  language: SupportedLanguage,
  originalQuery: string
) => [
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

const runWebhookScenario = async (
  input: WebhookScenarioInput,
  card: {
    id: string;
    title: string;
    description: string | null;
    imageUrl: string;
    price: number;
    tags: string[];
  }
): Promise<{ orderNumber: string; notifications: SentNotification[] }> => {
  if (input.discordChannelId && input.sessionLanguage && input.sessionQuery) {
    await gallerySearchSessionRepository.create({
      discordUserId: input.discordUserId,
      discordChannelId: input.discordChannelId,
      query: input.sessionQuery,
      results: createLanguageTaggedResults(card, input.sessionLanguage, input.sessionQuery),
      status: "active",
    });
  }

  const pendingOrder = await orderService.createPendingOrder({
    discordUserId: input.discordUserId,
    galleryCardId: input.cardId,
    amount: input.amount,
    preferredLanguage: input.preferredLanguage ?? null,
  });

  const checkoutCreatedOrder = await orderService.updateShopifyLink({
    orderId: pendingOrder.id,
    shopifyProductId: "test-shopify-product-id",
    shopifyCheckoutUrl: "https://example.com/test-checkout",
    shopifyProductUrl: "https://example.com/products/test-product",
    shopifyShareImageUrl: "https://example.com/share-image.jpg",
    shopifyProductHandle: "test-product",
    status: "checkout_created",
  });

  const rawBody = buildWebhookPayload(checkoutCreatedOrder.orderNumber);
  const providedHmac = computeWebhookHmac(rawBody);
  ensure(
    shopifyWebhookService.verifyOrdersPaidWebhook(rawBody, providedHmac),
    "Expected generated Shopify webhook HMAC to verify"
  );

  const beforeCount = sentNotifications.length;
  const result = await shopifyWebhookService.handleOrdersPaidWebhook(rawBody);
  const persistedOrder = await orderService.findByOrderNumber(checkoutCreatedOrder.orderNumber);
  const notifications = sentNotifications.slice(beforeCount);
  const expectedMessage = buildExpectedMessage(input.expectedLanguage, {
    orderNumber: checkoutCreatedOrder.orderNumber,
    amount: checkoutCreatedOrder.amount,
  });

  assert.equal(result.orderNumber, checkoutCreatedOrder.orderNumber);
  assert.equal(result.status, "paid");
  assert.equal(persistedOrder?.status, "paid");
  assert.equal(notifications.length, input.expectedNotificationCount);
  assert.ok(notifications.length >= 1);

  for (const notification of notifications) {
    assert.equal(notification.content, expectedMessage);
  }

  return {
    orderNumber: checkoutCreatedOrder.orderNumber,
    notifications,
  };
};

const main = async (): Promise<void> => {
  registerFakeDiscordClient();

  const searchResult = await galleryService.searchGalleryCards("girl", "en");
  ensure(searchResult.results.length > 0, "Expected at least one gallery card for webhook test");
  const firstCard = searchResult.results[0];
  const amount = firstCard.price.toFixed(2);
  const suffix = Date.now().toString();

  const englishStored = await runWebhookScenario(
    {
      discordUserId: `test-webhook-user-en-${suffix}`,
      discordChannelId: `test-webhook-channel-en-${suffix}`,
      cardId: firstCard.id,
      amount,
      preferredLanguage: "en",
      sessionLanguage: "en",
      sessionQuery: "girl",
      expectedLanguage: "en",
      expectedNotificationCount: 2,
    },
    firstCard
  );

  const chineseStored = await runWebhookScenario(
    {
      discordUserId: `test-webhook-user-zh-${suffix}`,
      discordChannelId: `test-webhook-channel-zh-${suffix}`,
      cardId: firstCard.id,
      amount,
      preferredLanguage: "zh",
      sessionLanguage: "zh",
      sessionQuery: "女孩卡牌",
      expectedLanguage: "zh",
      expectedNotificationCount: 2,
    },
    firstCard
  );

  const sessionFallback = await runWebhookScenario(
    {
      discordUserId: `test-webhook-user-session-${suffix}`,
      discordChannelId: `test-webhook-channel-session-${suffix}`,
      cardId: firstCard.id,
      amount,
      preferredLanguage: null,
      sessionLanguage: "en",
      sessionQuery: "girl",
      expectedLanguage: "en",
      expectedNotificationCount: 2,
    },
    firstCard
  );

  const defaultFallback = await runWebhookScenario(
    {
      discordUserId: `test-webhook-user-default-${suffix}`,
      cardId: firstCard.id,
      amount,
      preferredLanguage: null,
      expectedLanguage: "en",
      expectedNotificationCount: 1,
    },
    firstCard
  );

  console.log(
    `[TEST SHOPIFY WEBHOOK] summary=${JSON.stringify({
      scenarios: [
        {
          name: "stored_en",
          orderNumber: englishStored.orderNumber,
          notifications: englishStored.notifications,
        },
        {
          name: "stored_zh",
          orderNumber: chineseStored.orderNumber,
          notifications: chineseStored.notifications,
        },
        {
          name: "session_fallback_en",
          orderNumber: sessionFallback.orderNumber,
          notifications: sessionFallback.notifications,
        },
        {
          name: "default_fallback_en",
          orderNumber: defaultFallback.orderNumber,
          notifications: defaultFallback.notifications,
        },
      ],
    })}`
  );
};

main().catch((error) => {
  console.error("[TEST SHOPIFY WEBHOOK] failed", error);
  process.exit(1);
});
