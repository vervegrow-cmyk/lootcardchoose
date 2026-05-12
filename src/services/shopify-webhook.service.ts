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
  const left = Buffer.from(digest, "utf8");
  const right = Buffer.from(providedHmac, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
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
    const payload = JSON.parse(rawBody.toString("utf8")) as ShopifyOrdersPaidWebhookPayload;
    const orderNumber = extractOrderNumber(payload);
    if (!orderNumber) {
      throw new Error("Shopify orders/paid webhook missing orderNumber");
    }

    const order = await orderService.markPaid({ orderNumber });
    await discordNotificationService.notifyOrderPaid({
      discordUserId: order.discordUserId,
      orderNumber: order.orderNumber,
      amount: order.amount,
    });

    return {
      orderNumber: order.orderNumber,
      status: order.status,
    };
  },
};
