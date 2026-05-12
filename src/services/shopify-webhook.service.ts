import crypto from "crypto";
import { loadEnv } from "../config/env";
import { orderService } from "./order.service";
import { discordNotificationService } from "./discord-notification.service";

type ShopifyWebhookNoteAttribute = {
  name?: string;
  value?: string;
};

type ShopifyWebhookLineItemProperty = {
  name?: string;
  value?: string;
};

type ShopifyWebhookLineItem = {
  properties?: ShopifyWebhookLineItemProperty[];
};

type ShopifyOrdersPaidWebhookPayload = {
  id?: number | string;
  name?: string;
  order_number?: number | string;
  note?: string | null;
  note_attributes?: ShopifyWebhookNoteAttribute[];
  tags?: string;
  line_items?: ShopifyWebhookLineItem[];
};

const previewDigest = (value: string): string => `${value.slice(0, 12)}...`;

const computeWebhookDigest = (rawBody: Buffer): string => {
  const env = loadEnv();
  const secret = env.shopifyWebhookSecret || env.shopifyClientSecret;
  if (!secret) {
    throw new Error("Missing SHOPIFY_WEBHOOK_SECRET");
  }
  return crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
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

  const lineItemProperty = payload.line_items
    ?.flatMap((lineItem) => lineItem.properties ?? [])
    .find((property) => {
      const name = property.name?.trim().toLowerCase();
      return name === "ordernumber" || name === "order_number";
    });

  if (lineItemProperty?.value) {
    return lineItemProperty.value.trim();
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
  async handleOrdersPaidWebhook(input: {
    rawBody: Buffer;
    hmac: string;
    topic: string;
  }): Promise<{ handled: boolean; orderNumber: string | null; status: string }> {
    console.log("[SHOPIFY WEBHOOK] verify start", {
      topic: input.topic,
      hmacExists: Boolean(input.hmac),
      rawBodyLength: input.rawBody.length,
    });

    const expectedDigest = computeWebhookDigest(input.rawBody);
    const left = Buffer.from(expectedDigest, "utf8");
    const right = Buffer.from(input.hmac, "utf8");
    const valid = left.length === right.length && crypto.timingSafeEqual(left, right);
    if (!valid) {
      console.warn("[SHOPIFY WEBHOOK] hmac failed", {
        expectedDigest: previewDigest(expectedDigest),
        receivedDigest: previewDigest(input.hmac),
      });
      throw new Error("Invalid Shopify webhook hmac");
    }

    console.log("[SHOPIFY WEBHOOK] hmac verified");
    console.log("[SHOPIFY WEBHOOK] parsing payload");

    const payload = JSON.parse(input.rawBody.toString("utf8")) as ShopifyOrdersPaidWebhookPayload;
    const orderNumber = extractOrderNumber(payload);
    console.log("[SHOPIFY WEBHOOK] payload parsed", {
      payloadId: payload.id ?? null,
      payloadName: payload.name ?? null,
      payloadOrderNumber: payload.order_number ?? null,
      note: payload.note ?? null,
      tags: payload.tags ?? null,
      noteAttributes:
        payload.note_attributes?.map((attribute) => ({
          name: attribute.name ?? null,
          value: attribute.value ?? null,
        })) ?? [],
      lineItemProperties:
        payload.line_items?.map((lineItem) =>
          (lineItem.properties ?? []).map((property) => ({
            name: property.name ?? null,
            value: property.value ?? null,
          }))
        ) ?? [],
      extractedOrderNumber: orderNumber,
    });

    if (!orderNumber) {
      console.warn("[SHOPIFY WEBHOOK] orderNumber missing, ignored");
      return {
        handled: true,
        orderNumber: null,
        status: "ignored",
      };
    }

    console.log("[SHOPIFY WEBHOOK] mark paid start", { orderNumber });
    let order;
    try {
      order = await orderService.markPaid({ orderNumber });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === `Order not found for orderNumber=${orderNumber}`) {
        console.warn("[SHOPIFY WEBHOOK] local order not found, ignored", {
          orderNumber,
        });
        return {
          handled: true,
          orderNumber,
          status: "ignored",
        };
      }
      throw error;
    }
    console.log("[SHOPIFY WEBHOOK] mark paid success", { orderNumber: order.orderNumber });
    console.log("[SHOPIFY WEBHOOK] discord notify start", { orderNumber: order.orderNumber });

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
      handled: true,
      orderNumber: order.orderNumber,
      status: order.status,
    };
  },
};
