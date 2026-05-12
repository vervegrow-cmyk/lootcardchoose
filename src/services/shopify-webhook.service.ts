import crypto from "crypto";
import { loadEnv } from "../config/env";
import { orderService } from "./order.service";
import { discordNotificationService } from "./discord-notification.service";

type ShopifyWebhookNoteAttribute = {
  name?: string;
  value?: string;
};

type ShopifyOrdersPaidWebhookPayload = {
  id?: number | string;
  note?: string | null;
  note_attributes?: ShopifyWebhookNoteAttribute[];
  tags?: string;
};

const WEBHOOK_TOPIC = "orders/paid";

const previewDigest = (value: string): string => `${value.slice(0, 12)}...`;

const computeWebhookDigest = (rawBody: Buffer): string => {
  const env = loadEnv();
  const secret = env.shopifyClientSecret;
  if (!secret) {
    throw new Error("Missing SHOPIFY_CLIENT_SECRET");
  }
  return crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
};

const isValidWebhookHmac = (rawBody: Buffer, providedHmac: string): boolean => {
  const digest = computeWebhookDigest(rawBody);
  console.log("[SHOPIFY WEBHOOK] verify start", {
    topic: WEBHOOK_TOPIC,
    hmacExists: Boolean(providedHmac),
    rawBodyLength: rawBody.length,
  });

  const left = Buffer.from(digest, "utf8");
  const right = Buffer.from(providedHmac, "utf8");
  if (left.length !== right.length) {
    console.warn("[SHOPIFY WEBHOOK] hmac failed", {
      expectedDigest: previewDigest(digest),
      receivedDigest: previewDigest(providedHmac),
    });
    return false;
  }

  const valid = crypto.timingSafeEqual(left, right);
  if (!valid) {
    console.warn("[SHOPIFY WEBHOOK] hmac failed", {
      expectedDigest: previewDigest(digest),
      receivedDigest: previewDigest(providedHmac),
    });
    return false;
  }

  console.log("[SHOPIFY WEBHOOK] hmac verified");
  return true;
};

const extractOrderNumber = (payload: ShopifyOrdersPaidWebhookPayload): string | null => {
  const noteAttributeMatch = payload.note_attributes?.find((attribute) => {
    const name = attribute.name?.trim().toLowerCase();
    return name === "ordernumber" || name === "order_number";
  });

  if (noteAttributeMatch?.value) {
    return noteAttributeMatch.value.trim();
  }

  if (payload.note?.trim()) {
    return payload.note.trim();
  }

  const tags = payload.tags ?? "";
  const orderTag = tags
    .split(",")
    .map((tag) => tag.trim())
    .find((tag) => tag.startsWith("order:"));

  if (orderTag) {
    return orderTag.slice("order:".length).trim();
  }

  return null;
};

export const shopifyWebhookService = {
  verifyOrdersPaidWebhook(rawBody: Buffer, providedHmac: string): boolean {
    return isValidWebhookHmac(rawBody, providedHmac);
  },
  async handleOrdersPaidWebhook(rawBody: Buffer): Promise<{
    orderNumber: string;
    status: string;
  }> {
    console.log("[SHOPIFY WEBHOOK] parsing payload");
    const payload = JSON.parse(rawBody.toString("utf8")) as ShopifyOrdersPaidWebhookPayload;
    const orderNumber = extractOrderNumber(payload);
    if (!orderNumber) {
      throw new Error("Shopify orders/paid webhook missing orderNumber");
    }

    console.log("[SHOPIFY WEBHOOK] mark paid start", {
      orderNumber,
    });
    const order = await orderService.markPaid({ orderNumber });
    console.log("[SHOPIFY WEBHOOK] mark paid success", {
      orderNumber: order.orderNumber,
    });

    console.log("[SHOPIFY WEBHOOK] discord notify start", {
      orderNumber: order.orderNumber,
    });
    await discordNotificationService.notifyOrderPaid({
      discordUserId: order.discordUserId,
      orderNumber: order.orderNumber,
      amount: order.amount,
    });

    console.log("[SHOPIFY WEBHOOK] completed", {
      status: 200,
      orderNumber: order.orderNumber,
    });

    return {
      orderNumber: order.orderNumber,
      status: order.status,
    };
  },
};
