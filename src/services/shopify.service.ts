import { loadEnv } from "../config/env";
import { logger } from "../utils/logger";

export type ShopifyGalleryCardInput = {
  galleryCardId: string;
  title: string;
  description: string | null;
  imageUrl: string;
  price: string;
  tags: string[];
  marketingTitle?: string;
};

export type ShopifyOrderInput = {
  id: string;
  orderNumber: string;
  amount: string;
  status: string;
};

export type ShopifyCreateProductOutput = {
  orderNumber: string;
  galleryCardId: string;
  shopifyProductId: string;
  productTitle: string;
  productCode: string;
  productHandle: string;
  sku: string;
  productUrl: string;
  purchaseUrl: string;
  shareImageUrl: string;
};

type ShopifyProductImage = {
  src: string;
};

type ShopifyVariant = {
  price: string;
  sku: string;
};

type ShopifyProductPayload = {
  product: {
    title: string;
    handle: string;
    body_html: string | null;
    tags: string;
    status: "active";
    images?: ShopifyProductImage[];
    variants: ShopifyVariant[];
  };
};

type ShopifyProductResponse = {
  product: {
    id: number;
    handle: string;
    variants?: Array<{ id?: number }>;
  };
};

const resolveShopifyStoreDomain = (): string => {
  const env = loadEnv();
  if (!env.shopifyStoreDomain) {
    throw new Error("Missing SHOPIFY_STORE_DOMAIN");
  }
  return env.shopifyStoreDomain;
};

const resolveShopifyApiVersion = (): string => loadEnv().shopifyApiVersion;

const PRODUCT_CODE_PREFIX = "LC";

const EMERGENCY_MARKETING_TITLE_STOPWORDS = new Set([
  "anime",
  "collectible",
  "card",
  "premium",
  "female",
  "male",
  "character",
  "girl",
  "boy",
  "beautiful",
  "beauty",
  "trading",
  "luxury",
]);

const toTitleCase = (value: string): string =>
  value
    .split(/([:-])/)
    .map((part) => {
      if (part === ":" || part === "-") {
        return part;
      }
      const lower = part.toLowerCase();
      return lower ? `${lower[0].toUpperCase()}${lower.slice(1)}` : "";
    })
    .join("");

const resolveOrderTail = (orderNumber: string): string => {
  const digits = orderNumber.replace(/\D/g, "");
  return digits.slice(-6).padStart(6, "0");
};

const resolveGalleryTail = (galleryCardId: string): string => {
  const normalized = galleryCardId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return normalized.slice(-4).padStart(4, "X");
};

const slugify = (value: string): string => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "gallery-card";
};

const normalizeMarketingTitle = (value: string): string =>
  value
    .replace(/[^\x00-\x7F]+/g, " ")
    .replace(/[^A-Za-z\s:-]+/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\b(?:shopify|variant|product|order|sku)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildEmergencyMarketingTitle = (card: ShopifyGalleryCardInput): string => {
  const sourceValues = [card.title, ...card.tags];
  const descriptorWords: string[] = [];
  let archetype = "Heroine";

  for (const source of sourceValues) {
    const normalized = source
      .replace(/[^A-Za-z\s-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!normalized) {
      continue;
    }

    if (/\bqueen\b/i.test(normalized)) {
      archetype = "Queen";
    } else if (/\bempress\b/i.test(normalized)) {
      archetype = "Empress";
    } else if (/\bvalkyrie\b/i.test(normalized)) {
      archetype = "Valkyrie";
    } else if (/\bprincess\b/i.test(normalized)) {
      archetype = "Princess";
    } else if (/\bwarrior\b/i.test(normalized)) {
      archetype = "Warrior";
    } else if (/\bmale\b|\bboy\b|\bman\b/i.test(normalized)) {
      archetype = "Champion";
    }

    const words = normalized
      .split(/\s+/)
      .map((word) => word.toLowerCase())
      .filter((word) => word.length > 2 && !EMERGENCY_MARKETING_TITLE_STOPWORDS.has(word));

    for (const word of words) {
      const candidate = toTitleCase(word);
      if (descriptorWords.some((existing) => existing.toLowerCase() === candidate.toLowerCase())) {
        continue;
      }
      descriptorWords.push(candidate);
      if (descriptorWords.length >= 2) {
        break;
      }
    }

    if (descriptorWords.length >= 2) {
      break;
    }
  }

  const titleWords = [...descriptorWords, archetype].slice(0, 6);
  return titleWords.join(" ").trim() || "Celestial Heroine";
};

const buildProductIdentity = (
  card: ShopifyGalleryCardInput,
  order: ShopifyOrderInput
): {
  productTitle: string;
  productCode: string;
  productHandle: string;
  sku: string;
} => {
  const providedMarketingTitle = normalizeMarketingTitle(card.marketingTitle ?? "");
  const marketingTitle = providedMarketingTitle || buildEmergencyMarketingTitle(card);
  const productCode = `${PRODUCT_CODE_PREFIX}-${resolveOrderTail(order.orderNumber)}-${resolveGalleryTail(
    card.galleryCardId
  )}`;
  const productTitle = `${marketingTitle} | ${productCode}`;
  const sku = productCode;
  const productHandle = slugify(`${marketingTitle}-${productCode.toLowerCase()}`);

  return {
    productTitle,
    productCode,
    productHandle,
    sku,
  };
};

const buildProductPayload = (
  card: ShopifyGalleryCardInput,
  order: ShopifyOrderInput
): ShopifyProductPayload => {
  const identity = buildProductIdentity(card, order);

  return {
    product: {
      title: identity.productTitle,
      handle: identity.productHandle,
      body_html: card.description,
      tags: [...card.tags, `gallery-card:${card.galleryCardId}`, `order:${order.orderNumber}`].join(", "),
      status: "active",
      images: card.imageUrl ? [{ src: card.imageUrl }] : undefined,
      variants: [{ price: card.price, sku: identity.sku }],
    },
  };
};

const resolveProductUrl = (storeDomain: string, handle: string): string =>
  `https://${storeDomain}/products/${handle}`;

const resolveCartUrl = (
  storeDomain: string,
  variantId: number | undefined,
  orderNumber: string
): string | null => {
  if (!variantId) {
    return null;
  }
  const url = new URL(`https://${storeDomain}/cart/${variantId}:1`);
  url.searchParams.set("attributes[orderNumber]", orderNumber);
  url.searchParams.set("note", orderNumber);
  return url.toString();
};

export const shopifyService = {
  async createProductFromGalleryCard(
    card: ShopifyGalleryCardInput,
    order: ShopifyOrderInput
  ): Promise<ShopifyCreateProductOutput> {
    const { shopifyInstallationService } = await import("./shopify-installation.service");
    const storeDomain = resolveShopifyStoreDomain();
    const apiVersion = resolveShopifyApiVersion();
    const accessToken = await shopifyInstallationService.getAccessTokenForStore();
    const identity = buildProductIdentity(card, order);
    logger.info("[SHOPIFY SERVICE] create product start", {
      orderNumber: order.orderNumber,
      galleryCardId: card.galleryCardId,
      title: card.title,
      marketingTitle: card.marketingTitle ?? null,
      productTitle: identity.productTitle,
      productCode: identity.productCode,
      productHandle: identity.productHandle,
      sku: identity.sku,
      storeDomain,
    });

    try {
      const response = await fetch(`https://${storeDomain}/admin/api/${apiVersion}/products.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify(buildProductPayload(card, order)),
      });

      if (!response.ok) {
        const payload = await response.text();
        throw new Error(`Shopify create product failed: ${response.status} ${payload}`);
      }

      const data = (await response.json()) as ShopifyProductResponse;
      const productId = data.product?.id;
      const handle = data.product?.handle;
      if (!productId || !handle) {
        throw new Error("Shopify create product response missing product id or handle");
      }

      const variantId = data.product.variants?.[0]?.id;
      const productUrl = resolveProductUrl(storeDomain, handle);
      const purchaseUrl = resolveCartUrl(storeDomain, variantId, order.orderNumber) ?? productUrl;
      const shareImageUrl = card.imageUrl;

      logger.info("[SHOPIFY SERVICE] create product success", {
        orderNumber: order.orderNumber,
        galleryCardId: card.galleryCardId,
        shopifyProductId: String(productId),
        productTitle: identity.productTitle,
        productCode: identity.productCode,
        productHandle: handle,
        sku: identity.sku,
        productUrl,
        purchaseUrl,
        shareImageUrl,
      });

      return {
        orderNumber: order.orderNumber,
        galleryCardId: card.galleryCardId,
        shopifyProductId: String(productId),
        productTitle: identity.productTitle,
        productCode: identity.productCode,
        productHandle: handle,
        sku: identity.sku,
        productUrl,
        purchaseUrl,
        shareImageUrl,
      };
    } catch (error) {
      logger.error("[SHOPIFY SERVICE] create product failed", {
        orderNumber: order.orderNumber,
        galleryCardId: card.galleryCardId,
        productTitle: identity.productTitle,
        productCode: identity.productCode,
        productHandle: identity.productHandle,
        sku: identity.sku,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};
