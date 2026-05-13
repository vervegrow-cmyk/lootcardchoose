import crypto from "crypto";
import { loadEnv } from "../config/env";
import { orderService } from "./order.service";
import { discordNotificationService } from "./discord-notification.service";
import { logger } from "../utils/logger";

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
  logger.info("[SHOPIFY WEBHOOK] verify start", {
    topic: WEBHOOK_TOPIC,
    hmacExists: Boolean(providedHmac),
    rawBodyLength: rawBody.length,
  });

  const left = Buffer.from(digest, "utf8");
  const right = Buffer.from(providedHmac, "utf8");
  if (left.length !== right.length) {
    logger.warn("[SHOPIFY WEBHOOK] hmac failed", {
      expectedDigest: previewDigest(digest),
      receivedDigest: previewDigest(providedHmac),
    });
    return false;
  }

  const valid = crypto.timingSafeEqual(left, right);
  if (!valid) {
    logger.warn("[SHOPIFY WEBHOOK] hmac failed", {
      expectedDigest: previewDigest(digest),
      receivedDigest: previewDigest(providedHmac),
    });
    return false;
  }

  logger.info("[SHOPIFY WEBHOOK] hmac verified", {
    topic: WEBHOOK_TOPIC,
    rawBodyLength: rawBody.length,
  });
  return true;
};

const extractOrderNumber = (
  payload: ShopifyOrdersPaidWebhookPayload
): { orderNumber: string | null; source: "note_attributes" | "note" | "tags" | "missing" } => {
  const noteAttributeMatch = payload.note_attributes?.find((attribute) => {
    const name = attribute.name?.trim().toLowerCase();
    return name === "ordernumber" || name === "order_number";
  });

  if (noteAttributeMatch?.value) {
    return {
      orderNumber: noteAttributeMatch.value.trim(),
      source: "note_attributes",
    };
  }

  if (payload.note?.trim()) {
    return {
      orderNumber: payload.note.trim(),
      source: "note",
    };
  }

  const tags = payload.tags ?? "";
  const orderTag = tags
    .split(",")
    .map((tag) => tag.trim())
    .find((tag) => tag.startsWith("order:"));

  if (orderTag) {
    return {
      orderNumber: orderTag.slice("order:".length).trim(),
      source: "tags",
    };
  }

  return {
    orderNumber: null,
    source: "missing",
  };
};

export const shopifyWebhookService = {
  verifyOrdersPaidWebhook(rawBody: Buffer, providedHmac: string): boolean {
    return isValidWebhookHmac(rawBody, providedHmac);
  },
  async handleOrdersPaidWebhook(rawBody: Buffer): Promise<{
    orderNumber: string;
    status: string;
  }> {
    logger.info("[SHOPIFY WEBHOOK] parsing payload", {
      rawBodyLength: rawBody.length,
    });
    const payload = JSON.parse(rawBody.toString("utf8")) as ShopifyOrdersPaidWebhookPayload;
    const { orderNumber, source } = extractOrderNumber(payload);
    logger.info("[SHOPIFY WEBHOOK] extracted order number", {
      orderNumber,
      orderNumberSource: source,
    });
    if (!orderNumber) {
      throw new Error("Shopify orders/paid webhook missing orderNumber");
    }

    logger.info("[SHOPIFY WEBHOOK] mark paid start", {
      orderNumber,
    });
    const order = await orderService.markPaid({ orderNumber });
    logger.info("[SHOPIFY WEBHOOK] mark paid success", {
      orderNumber: order.orderNumber,
    });

    logger.info("[SHOPIFY WEBHOOK] discord notify start", {
      orderNumber: order.orderNumber,
    });
    await discordNotificationService.notifyOrderPaid({
      discordUserId: order.discordUserId,
      orderNumber: order.orderNumber,
      amount: order.amount,
    });

    logger.info("[SHOPIFY WEBHOOK] completed", {
      status: 200,
      orderNumber: order.orderNumber,
    });

    return {
      orderNumber: order.orderNumber,
      status: order.status,
    };
  },
};
