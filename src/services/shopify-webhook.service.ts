import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { loadEnv } from "../config/env";
import {
  ShopifyWebhookEventRecord,
  ShopifyWebhookEventStatus,
  ShopifyWebhookResolvedMethod,
  shopifyWebhookEventRepository,
} from "../repositories/shopify-webhook-event.repository";
import { OrderRecord, orderService } from "./order.service";
import { discordNotificationService } from "./discord-notification.service";
import { logger } from "../utils/logger";

type ShopifyWebhookNoteAttribute = {
  name?: string;
  value?: string;
};

type ShopifyWebhookLineItem = {
  product_id?: number | string | null;
  sku?: string | null;
  title?: string | null;
  name?: string | null;
  product_title?: string | null;
};

type ShopifyOrdersPaidWebhookPayload = {
  id?: number | string;
  note?: string | null;
  note_attributes?: ShopifyWebhookNoteAttribute[];
  tags?: string;
  line_items?: ShopifyWebhookLineItem[];
};

export type ShopifyWebhookHeaders = {
  topic?: string | null;
  shopifyWebhookId?: string | null;
};

type ResolveContext = {
  shopifyOrderId: string | null;
  note: string | null;
  noteAttributes: Array<{ name: string | null; value: string | null }>;
  lineItemProductIds: string[];
  lineItemSkus: string[];
  lineItemTitles: string[];
};

type ResolveResult = {
  order: OrderRecord | null;
  resolvedMethod: ShopifyWebhookResolvedMethod | null;
  failureReason: string | null;
  context: ResolveContext;
};

type ProcessWebhookResult = {
  orderNumber: string | null;
  status: string;
};

const WEBHOOK_TOPIC = "orders/paid";
const PRODUCT_CODE_REGEX = /\bLC-[A-Z0-9]{6}-[A-Z0-9]{4}\b/i;

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

const dedupeStrings = (values: Array<string | null | undefined>): string[] => {
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) {
      unique.add(normalized);
    }
  }
  return [...unique];
};

const normalizeProductCode = (value: string | null | undefined): string | null => {
  const normalized = value?.trim().toUpperCase() ?? "";
  return PRODUCT_CODE_REGEX.test(normalized) ? normalized.match(PRODUCT_CODE_REGEX)?.[0]?.toUpperCase() ?? null : null;
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

const buildResolveContext = (payload: ShopifyOrdersPaidWebhookPayload): ResolveContext => ({
  shopifyOrderId: payload.id == null ? null : String(payload.id),
  note: payload.note?.trim() || null,
  noteAttributes: (payload.note_attributes ?? []).map((attribute) => ({
    name: attribute.name?.trim() ?? null,
    value: attribute.value?.trim() ?? null,
  })),
  lineItemProductIds: dedupeStrings((payload.line_items ?? []).map((item) => String(item.product_id ?? "").trim() || null)),
  lineItemSkus: dedupeStrings((payload.line_items ?? []).map((item) => item.sku ?? null)),
  lineItemTitles: dedupeStrings(
    (payload.line_items ?? []).flatMap((item) => [item.title ?? null, item.name ?? null, item.product_title ?? null])
  ),
});

const extractProductCodesFromSkus = (payload: ShopifyOrdersPaidWebhookPayload): string[] =>
  dedupeStrings((payload.line_items ?? []).map((item) => normalizeProductCode(item.sku))).map((value) => value.toUpperCase());

const extractProductIds = (payload: ShopifyOrdersPaidWebhookPayload): string[] =>
  dedupeStrings((payload.line_items ?? []).map((item) => (item.product_id == null ? null : String(item.product_id))));

const extractProductCodesFromTitles = (payload: ShopifyOrdersPaidWebhookPayload): string[] =>
  dedupeStrings(
    (payload.line_items ?? []).flatMap((item) => {
      const values = [item.title, item.name, item.product_title];
      return values.map((value) => {
        const match = value?.match(PRODUCT_CODE_REGEX);
        return match?.[0]?.toUpperCase() ?? null;
      });
    })
  );

const parsePayload = (rawBody: Buffer): ShopifyOrdersPaidWebhookPayload =>
  JSON.parse(rawBody.toString("utf8")) as ShopifyOrdersPaidWebhookPayload;

const resolveOrderFromPayload = async (payload: ShopifyOrdersPaidWebhookPayload): Promise<ResolveResult> => {
  const context = buildResolveContext(payload);
  const { orderNumber, source } = extractOrderNumber(payload);

  logger.info("[WEBHOOK RESOLVER] start", {
    shopifyOrderId: context.shopifyOrderId,
    orderNumberCandidate: orderNumber,
    orderNumberSource: source,
    lineItemProductIds: context.lineItemProductIds,
    lineItemSkus: context.lineItemSkus,
    lineItemTitles: context.lineItemTitles,
  });

  if (orderNumber) {
    const order = await orderService.findByOrderNumber(orderNumber);
    if (order) {
      return {
        order,
        resolvedMethod: "orderNumber",
        failureReason: null,
        context,
      };
    }
  }

  for (const productCode of extractProductCodesFromSkus(payload)) {
    const order = await orderService.findByProductCode(productCode);
    if (order) {
      return {
        order,
        resolvedMethod: "productCode",
        failureReason: null,
        context,
      };
    }
  }

  for (const shopifyProductId of extractProductIds(payload)) {
    const order = await orderService.findByShopifyProductId(shopifyProductId);
    if (order) {
      return {
        order,
        resolvedMethod: "shopifyProductId",
        failureReason: null,
        context,
      };
    }
  }

  for (const productCode of extractProductCodesFromTitles(payload)) {
    const order = await orderService.findByProductCode(productCode);
    if (order) {
      return {
        order,
        resolvedMethod: "titleRegex",
        failureReason: null,
        context,
      };
    }
  }

  const failureReason =
    orderNumber || context.lineItemSkus.length > 0 || context.lineItemProductIds.length > 0 || context.lineItemTitles.length > 0
      ? "No local order matched any webhook identifier"
      : "Webhook payload did not contain any supported order identifiers";

  return {
    order: null,
    resolvedMethod: null,
    failureReason,
    context,
  };
};

const persistWebhookEvent = async (
  payload: ShopifyOrdersPaidWebhookPayload,
  headers: ShopifyWebhookHeaders
): Promise<ShopifyWebhookEventRecord> =>
  shopifyWebhookEventRepository.create({
    topic: headers.topic?.trim() || WEBHOOK_TOPIC,
    shopifyWebhookId: headers.shopifyWebhookId?.trim() || null,
    shopifyOrderId: payload.id == null ? null : String(payload.id),
    payload: payload as Prisma.JsonValue,
    status: "received",
  });

const markEventStatus = async (
  event: ShopifyWebhookEventRecord,
  input: {
    status: ShopifyWebhookEventStatus;
    resolvedOrderNumber?: string | null;
    resolvedMethod?: ShopifyWebhookResolvedMethod | null;
    failureReason?: string | null;
    processedAt?: Date | null;
  }
): Promise<ShopifyWebhookEventRecord> =>
  shopifyWebhookEventRepository.update({
    id: event.id,
    status: input.status,
    resolvedOrderNumber: input.resolvedOrderNumber,
    resolvedMethod: input.resolvedMethod,
    failureReason: input.failureReason,
    processedAt: input.processedAt,
  });

const processWebhookEvent = async (
  event: ShopifyWebhookEventRecord,
  payload: ShopifyOrdersPaidWebhookPayload,
  input: { allowDedupe: boolean }
): Promise<ProcessWebhookResult> => {
  if (input.allowDedupe && event.shopifyWebhookId) {
    const priorEvent = await shopifyWebhookEventRepository.findPriorByWebhookId({
      shopifyWebhookId: event.shopifyWebhookId,
      excludeId: event.id,
    });

    if (priorEvent) {
      logger.info("[WEBHOOK DEDUPE] duplicate skipped", {
        webhookEventId: event.id,
        shopifyWebhookId: event.shopifyWebhookId,
        originalEventId: priorEvent.id,
        originalStatus: priorEvent.status,
        originalResolvedOrderNumber: priorEvent.resolvedOrderNumber,
      });

      await markEventStatus(event, {
        status: "duplicate_skipped",
        resolvedOrderNumber: priorEvent.resolvedOrderNumber,
        resolvedMethod: "duplicate",
        failureReason: `Duplicate webhook skipped; originalEventId=${priorEvent.id}`,
        processedAt: new Date(),
      });

      return {
        orderNumber: priorEvent.resolvedOrderNumber,
        status: "duplicate_skipped",
      };
    }
  }

  const resolved = await resolveOrderFromPayload(payload);
  if (!resolved.order) {
    logger.warn("[WEBHOOK RESOLVER] unresolved", {
      webhookEventId: event.id,
      shopifyWebhookId: event.shopifyWebhookId,
      shopifyOrderId: resolved.context.shopifyOrderId,
      topic: event.topic,
      resolvedMethod: resolved.resolvedMethod,
      note: resolved.context.note,
      noteAttributes: resolved.context.noteAttributes,
      lineItemProductIds: resolved.context.lineItemProductIds,
      lineItemSkus: resolved.context.lineItemSkus,
      lineItemTitles: resolved.context.lineItemTitles,
      failureReason: resolved.failureReason,
    });

    await markEventStatus(event, {
      status: "unresolved",
      resolvedOrderNumber: null,
      resolvedMethod: null,
      failureReason: resolved.failureReason,
      processedAt: new Date(),
    });

    return {
      orderNumber: null,
      status: "unresolved",
    };
  }

  await markEventStatus(event, {
    status: "resolved",
    resolvedOrderNumber: resolved.order.orderNumber,
    resolvedMethod: resolved.resolvedMethod,
    failureReason: null,
    processedAt: null,
  });

  logger.info("[WEBHOOK RESOLVER] matched order", {
    webhookEventId: event.id,
    shopifyWebhookId: event.shopifyWebhookId,
    shopifyOrderId: resolved.context.shopifyOrderId,
    resolvedMethod: resolved.resolvedMethod,
    resolvedOrderNumber: resolved.order.orderNumber,
  });

  try {
    logger.info("[SHOPIFY WEBHOOK] mark paid start", {
      webhookEventId: event.id,
      orderNumber: resolved.order.orderNumber,
      resolvedMethod: resolved.resolvedMethod,
    });
    const paymentResult = await orderService.markPaidWithResult({
      orderNumber: resolved.order.orderNumber,
    });
    logger.info("[SHOPIFY WEBHOOK] mark paid success", {
      webhookEventId: event.id,
      orderNumber: paymentResult.order.orderNumber,
      wasAlreadyPaid: paymentResult.wasAlreadyPaid,
    });

    if (!paymentResult.wasAlreadyPaid) {
      logger.info("[SHOPIFY WEBHOOK] discord notify start", {
        webhookEventId: event.id,
        orderNumber: paymentResult.order.orderNumber,
        preferredLanguage: paymentResult.order.preferredLanguage,
      });
      await discordNotificationService.notifyOrderPaid({
        discordUserId: paymentResult.order.discordUserId,
        orderNumber: paymentResult.order.orderNumber,
        amount: paymentResult.order.amount,
        language: paymentResult.order.preferredLanguage,
      });
    } else {
      logger.info("[SHOPIFY WEBHOOK] discord notify skipped", {
        webhookEventId: event.id,
        orderNumber: paymentResult.order.orderNumber,
        reason: "order already paid",
      });
    }

    await markEventStatus(event, {
      status: "processed",
      resolvedOrderNumber: paymentResult.order.orderNumber,
      resolvedMethod: resolved.resolvedMethod,
      failureReason: null,
      processedAt: new Date(),
    });

    logger.info("[SHOPIFY WEBHOOK] completed", {
      webhookEventId: event.id,
      status: paymentResult.order.status,
      orderNumber: paymentResult.order.orderNumber,
      resolvedMethod: resolved.resolvedMethod,
    });

    return {
      orderNumber: paymentResult.order.orderNumber,
      status: paymentResult.order.status,
    };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    logger.error("[SHOPIFY WEBHOOK] processing failed", {
      webhookEventId: event.id,
      shopifyWebhookId: event.shopifyWebhookId,
      shopifyOrderId: resolved.context.shopifyOrderId,
      topic: event.topic,
      resolvedMethod: resolved.resolvedMethod,
      resolvedOrderNumber: resolved.order.orderNumber,
      note: resolved.context.note,
      noteAttributes: resolved.context.noteAttributes,
      lineItemProductIds: resolved.context.lineItemProductIds,
      lineItemSkus: resolved.context.lineItemSkus,
      lineItemTitles: resolved.context.lineItemTitles,
      failureReason,
    });

    await markEventStatus(event, {
      status: "failed",
      resolvedOrderNumber: resolved.order.orderNumber,
      resolvedMethod: resolved.resolvedMethod,
      failureReason,
      processedAt: new Date(),
    });

    return {
      orderNumber: resolved.order.orderNumber,
      status: "failed",
    };
  }
};

export const shopifyWebhookService = {
  verifyOrdersPaidWebhook(rawBody: Buffer, providedHmac: string): boolean {
    return isValidWebhookHmac(rawBody, providedHmac);
  },
  async handleOrdersPaidWebhook(rawBody: Buffer, headers: ShopifyWebhookHeaders = {}): Promise<ProcessWebhookResult> {
    logger.info("[SHOPIFY WEBHOOK] parsing payload", {
      rawBodyLength: rawBody.length,
      topic: headers.topic?.trim() || WEBHOOK_TOPIC,
      shopifyWebhookId: headers.shopifyWebhookId?.trim() || null,
    });

    const payload = parsePayload(rawBody);
    const event = await persistWebhookEvent(payload, headers);

    return processWebhookEvent(event, payload, {
      allowDedupe: true,
    });
  },
  async retryPendingWebhookEvents(input?: {
    statuses?: ShopifyWebhookEventStatus[];
    limit?: number;
    shopifyWebhookIds?: string[];
  }): Promise<{
    scanned: number;
    processed: number;
    unresolved: number;
    failed: number;
    duplicateSkipped: number;
  }> {
    const statuses = input?.statuses ?? ["unresolved", "failed"];
    const limit = input?.limit ?? 50;
    logger.info("[WEBHOOK RETRY] start", {
      statuses,
      limit,
      shopifyWebhookIds: input?.shopifyWebhookIds ?? null,
    });

    const events = await shopifyWebhookEventRepository.listRetryable({
      statuses,
      limit,
      shopifyWebhookIds: input?.shopifyWebhookIds,
    });

    let processed = 0;
    let unresolved = 0;
    let failed = 0;
    let duplicateSkipped = 0;

    for (const event of events) {
      logger.info("[WEBHOOK RETRY] attempt", {
        webhookEventId: event.id,
        shopifyWebhookId: event.shopifyWebhookId,
        status: event.status,
      });

      const result = await processWebhookEvent(event, event.payload as ShopifyOrdersPaidWebhookPayload, {
        allowDedupe: false,
      });

      if (result.status === "paid") {
        processed += 1;
      } else if (result.status === "unresolved") {
        unresolved += 1;
      } else if (result.status === "failed") {
        failed += 1;
      } else if (result.status === "duplicate_skipped") {
        duplicateSkipped += 1;
      }
    }

    logger.info("[WEBHOOK RETRY] completed", {
      scanned: events.length,
      processed,
      unresolved,
      failed,
      duplicateSkipped,
    });

    return {
      scanned: events.length,
      processed,
      unresolved,
      failed,
      duplicateSkipped,
    };
  },
};
