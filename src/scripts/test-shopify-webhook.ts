import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });
process.env.SHOPIFY_CLIENT_SECRET ||= "test-shopify-client-secret";

import { galleryService } from "../services/gallery.service";
import { discordNotificationService } from "../services/discord-notification.service";
import { orderService } from "../services/order.service";
import { shopifyWebhookService } from "../services/shopify-webhook.service";

const TEST_USER_ID = "test-webhook-user";
const SEARCH_QUERY = "给我10张黑金SSR女角色卡牌";

const ensure = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async (): Promise<void> => {
  const secret = process.env.SHOPIFY_CLIENT_SECRET ?? "";
  ensure(secret, "SHOPIFY_CLIENT_SECRET is required for shopify:webhook:test");

  const searchResult = await galleryService.searchGalleryCards(SEARCH_QUERY, "zh");
  ensure(searchResult.results.length > 0, "Expected at least one gallery card for webhook test");

  const firstCard = searchResult.results[0];
  const pendingOrder = await orderService.createPendingOrder({
    discordUserId: TEST_USER_ID,
    galleryCardId: firstCard.id,
    amount: firstCard.price.toFixed(2),
  });

  const checkoutCreatedOrder = await orderService.updateShopifyLink({
    orderId: pendingOrder.id,
    shopifyProductId: "test-shopify-product-id",
    shopifyCheckoutUrl: "https://example.com/test-checkout",
    status: "checkout_created",
  });

  const payload = {
    id: `test-shopify-order-${Date.now()}`,
    note: checkoutCreatedOrder.orderNumber,
    note_attributes: [{ name: "orderNumber", value: checkoutCreatedOrder.orderNumber }],
    tags: `gallery, order:${checkoutCreatedOrder.orderNumber}`,
  };

  const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
  const providedHmac = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  ensure(
    shopifyWebhookService.verifyOrdersPaidWebhook(rawBody, providedHmac),
    "Expected generated Shopify webhook HMAC to verify"
  );

  const originalNotifyOrderPaid = discordNotificationService.notifyOrderPaid;
  const notifications: Array<{ discordUserId: string; orderNumber: string; amount: string }> = [];
  discordNotificationService.notifyOrderPaid = async (input) => {
    notifications.push(input);
  };

  try {
    const result = await shopifyWebhookService.handleOrdersPaidWebhook(rawBody);
    const persistedOrder = await orderService.findByOrderNumber(checkoutCreatedOrder.orderNumber);

    ensure(result.orderNumber === checkoutCreatedOrder.orderNumber, "Expected webhook result to use target orderNumber");
    ensure(result.status === "paid", "Expected webhook handler result status to be paid");
    ensure(persistedOrder?.status === "paid", "Expected persisted order status to be paid after webhook");
    ensure(notifications.length === 1, "Expected one Discord notification after webhook");

    console.log(
      `[TEST SHOPIFY WEBHOOK] summary=${JSON.stringify({
        orderNumber: checkoutCreatedOrder.orderNumber,
        initialStatus: checkoutCreatedOrder.status,
        finalStatus: persistedOrder?.status ?? null,
        hmacVerified: true,
        notifications,
      })}`
    );
  } finally {
    discordNotificationService.notifyOrderPaid = originalNotifyOrderPaid;
  }
};

main().catch((error) => {
  console.error("[TEST SHOPIFY WEBHOOK] failed", error);
  process.exit(1);
});
