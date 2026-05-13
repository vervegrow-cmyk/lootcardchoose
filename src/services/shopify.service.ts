import { loadEnv } from "../config/env";
import { logger } from "../utils/logger";

export type ShopifyGalleryCardInput = {
  galleryCardId: string;
  title: string;
  description: string | null;
  imageUrl: string;
  price: string;
  tags: string[];
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
  productHandle: string;
  productUrl: string;
  purchaseUrl: string;
  shareImageUrl: string;
};

type ShopifyProductImage = {
  src: string;
};

type ShopifyVariant = {
  price: string;
};

type ShopifyProductPayload = {
  product: {
    title: string;
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

const buildProductPayload = (
  card: ShopifyGalleryCardInput,
  order: ShopifyOrderInput
): ShopifyProductPayload => ({
  product: {
    title: card.title,
    body_html: card.description,
    tags: [...card.tags, `gallery-card:${card.galleryCardId}`, `order:${order.orderNumber}`].join(", "),
    status: "active",
    images: card.imageUrl ? [{ src: card.imageUrl }] : undefined,
    variants: [{ price: card.price }],
  },
});

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
    logger.info("[SHOPIFY SERVICE] create product start", {
      orderNumber: order.orderNumber,
      galleryCardId: card.galleryCardId,
      title: card.title,
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
        productHandle: handle,
        productUrl,
        purchaseUrl,
        shareImageUrl,
      });

      return {
        orderNumber: order.orderNumber,
        galleryCardId: card.galleryCardId,
        shopifyProductId: String(productId),
        productHandle: handle,
        productUrl,
        purchaseUrl,
        shareImageUrl,
      };
    } catch (error) {
      logger.error("[SHOPIFY SERVICE] create product failed", {
        orderNumber: order.orderNumber,
        galleryCardId: card.galleryCardId,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};
