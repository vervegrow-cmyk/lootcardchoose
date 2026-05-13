import { Prisma } from "@prisma/client";
import { loadEnv } from "../config/env";
import { GalleryCardRecord, galleryRepository } from "../repositories/gallery.repository";
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

type ShopifyNamingSource = ShopifyGalleryCardInput & {
  style?: string | null;
  rarity?: string | null;
  category?: string | null;
  character?: string | null;
  color?: string | null;
  metadata?: Prisma.JsonValue | null;
};

const PRODUCT_CODE_PREFIX = "LC";

const COLOR_THEME_PATTERNS: Array<{ pattern: RegExp; values: string[] }> = [
  { pattern: /\bblack gold\b|\bgold black\b/i, values: ["Shadow", "Obsidian", "Eclipse"] },
  { pattern: /\bblack\b/i, values: ["Midnight", "Obsidian", "Shadow"] },
  { pattern: /\bgold\b|\bgolden\b/i, values: ["Golden", "Radiant"] },
  { pattern: /\bpurple\b|\bviolet\b/i, values: ["Midnight", "Violet"] },
  { pattern: /\bred\b|\bcrimson\b|\bscarlet\b/i, values: ["Crimson", "Scarlet"] },
  { pattern: /\bsilver\b|\bchrome\b/i, values: ["Silver", "Lunar"] },
  { pattern: /\bblue\b|\bsapphire\b/i, values: ["Sapphire", "Azure"] },
  { pattern: /\bgreen\b|\bemerald\b/i, values: ["Emerald", "Verdant"] },
  { pattern: /\bwhite\b|\bivory\b/i, values: ["Ivory", "Celestial"] },
];

const STYLE_THEME_PATTERNS: Array<{ pattern: RegExp; values: string[] }> = [
  { pattern: /\bcyberpunk\b|\bneon\b/i, values: ["Neon", "Neo"] },
  { pattern: /\bmecha\b|\brobot\b/i, values: ["Core", "Phantom"] },
  { pattern: /\bfantasy\b|\bmythic\b|\bmystic\b/i, values: ["Mythic", "Celestial"] },
  { pattern: /\bdragon\b|\bflame\b/i, values: ["Dragon", "Crimson"] },
  { pattern: /\bgothic\b|\bdark\b/i, values: ["Midnight", "Obsidian"] },
  { pattern: /\bsakura\b|\bcherry blossom\b|\bfloral\b|\bpink roses?\b/i, values: ["Sakura", "Blossom"] },
];

const ARCHETYPE_PATTERNS: Array<{ pattern: RegExp; values: string[] }> = [
  { pattern: /\bempress\b/i, values: ["Empress"] },
  { pattern: /\bqueen\b/i, values: ["Queen"] },
  { pattern: /\bvalkyrie\b/i, values: ["Valkyrie"] },
  { pattern: /\bprincess\b/i, values: ["Princess"] },
  { pattern: /\bsorceress\b|\bwitch\b/i, values: ["Sorceress", "Witch"] },
  { pattern: /\bangel\b/i, values: ["Angel"] },
  { pattern: /\bdemon\b/i, values: ["Demon"] },
  { pattern: /\bgoddess\b/i, values: ["Goddess"] },
  { pattern: /\bwarrior\b/i, values: ["Warrior", "Valkyrie"] },
  { pattern: /\bdragon\b/i, values: ["Empress", "Valkyrie"] },
  { pattern: /\bmecha\b|\brobot\b/i, values: ["Phantom", "Vanguard"] },
  { pattern: /\bheroine\b/i, values: ["Heroine"] },
];

const RARITY_VALUES = new Set(["N", "R", "SR", "SSR", "UR"]);

const resolveShopifyStoreDomain = (): string => {
  const env = loadEnv();
  if (!env.shopifyStoreDomain) {
    throw new Error("Missing SHOPIFY_STORE_DOMAIN");
  }
  return env.shopifyStoreDomain;
};

const resolveShopifyApiVersion = (): string => loadEnv().shopifyApiVersion;

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collectMetadataStrings = (value: Prisma.JsonValue | null, result: string[] = []): string[] => {
  if (typeof value === "string") {
    result.push(value);
    return result;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectMetadataStrings(item as Prisma.JsonValue, result);
    }
    return result;
  }

  if (isJsonObject(value)) {
    for (const item of Object.values(value)) {
      collectMetadataStrings(item as Prisma.JsonValue, result);
    }
  }

  return result;
};

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

const stableHash = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const pickStable = (values: string[], seed: string): string => values[stableHash(seed) % values.length];

const sanitizeMarketingTitle = (value: string): string =>
  value
    .replace(/[^\x00-\x7F]+/g, " ")
    .replace(/\bLC-[A-Z0-9-]+\b/gi, " ")
    .replace(/\b(?:shopify|variant|product|order|sku|lootcard|gid)\b/gi, " ")
    .replace(/[^A-Za-z\s:-]+/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .map(toTitleCase)
    .join(" ")
    .trim();

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

const readMetadataMarketingTitle = (metadata: Prisma.JsonValue | null): string | null => {
  if (!isJsonObject(metadata)) {
    return null;
  }

  const value = metadata.marketingTitle;
  if (typeof value !== "string") {
    return null;
  }

  const sanitized = sanitizeMarketingTitle(value);
  return sanitized || null;
};

const buildStableSeed = (card: ShopifyNamingSource): string =>
  [
    card.galleryCardId,
    card.title,
    card.style ?? "",
    card.rarity ?? "",
    card.character ?? "",
    card.color ?? "",
    ...card.tags,
  ]
    .join("|")
    .toLowerCase();

const normalizeRarity = (value: string | null | undefined): string => {
  const normalized = (value ?? "").trim().toUpperCase();
  return RARITY_VALUES.has(normalized) ? normalized : "";
};

const buildSourceStrings = (card: ShopifyNamingSource): string[] => [
  card.color ?? "",
  card.style ?? "",
  card.character ?? "",
  card.rarity ?? "",
  card.category ?? "",
  card.title,
  card.description ?? "",
  ...card.tags,
  ...collectMetadataStrings(card.metadata ?? null),
];

const pickThemeValue = (
  patterns: Array<{ pattern: RegExp; values: string[] }>,
  sources: string[],
  seed: string
): string | null => {
  for (const source of sources) {
    for (const matcher of patterns) {
      if (matcher.pattern.test(source)) {
        return pickStable(matcher.values, `${seed}:${matcher.values.join("-")}`);
      }
    }
  }

  return null;
};

const buildFallbackMarketingTitle = (card: ShopifyNamingSource): string => {
  const sources = buildSourceStrings(card);
  const seed = buildStableSeed(card);
  const theme =
    pickThemeValue(COLOR_THEME_PATTERNS, sources, `${seed}:color`) ??
    pickThemeValue(STYLE_THEME_PATTERNS, sources, `${seed}:style`) ??
    pickStable(["Shadow", "Celestial", "Mythic"], `${seed}:theme`);

  let archetype: string | null = null;
  for (const source of sources) {
    for (const matcher of ARCHETYPE_PATTERNS) {
      if (matcher.pattern.test(source)) {
        archetype = pickStable(matcher.values, `${seed}:${matcher.values.join("-")}`);
        break;
      }
    }
    if (archetype) {
      break;
    }
  }

  if (!archetype) {
    const joined = sources.join(" ");
    if (/\bfemale\b|\bgirl\b|\bwoman\b|\blady\b/i.test(joined)) {
      archetype = pickStable(["Queen", "Empress", "Valkyrie"], `${seed}:female`);
    } else if (/\bmale\b|\bboy\b|\bman\b/i.test(joined)) {
      archetype = pickStable(["Champion", "Vanguard"], `${seed}:male`);
    } else if (/\bmecha\b|\brobot\b/i.test(joined)) {
      archetype = pickStable(["Phantom", "Vanguard"], `${seed}:mecha`);
    } else {
      archetype = pickStable(["Heroine", "Valkyrie"], `${seed}:default`);
    }
  }

  const rarity = normalizeRarity(card.rarity);
  return [theme, archetype, rarity].filter(Boolean).join(" ").trim() || "Celestial Heroine";
};

const buildResolvedNamingSource = (
  selectedCard: ShopifyGalleryCardInput,
  storedCard: GalleryCardRecord | null
): ShopifyNamingSource => ({
  galleryCardId: selectedCard.galleryCardId,
  title: storedCard?.title ?? selectedCard.title,
  description: storedCard?.description ?? selectedCard.description,
  imageUrl: selectedCard.imageUrl,
  price: selectedCard.price,
  tags: storedCard?.tags?.length ? storedCard.tags : selectedCard.tags,
  style: storedCard?.style ?? null,
  rarity: storedCard?.rarity ?? null,
  category: storedCard?.category ?? null,
  character: storedCard?.character ?? null,
  color: storedCard?.color ?? null,
  metadata: storedCard?.metadata ?? null,
});

const buildProductIdentity = (
  card: ShopifyNamingSource,
  order: ShopifyOrderInput
): {
  marketingTitle: string;
  productTitle: string;
  productCode: string;
  productHandle: string;
  sku: string;
} => {
  const persistedMarketingTitle = readMetadataMarketingTitle(card.metadata ?? null);
  const marketingTitle = persistedMarketingTitle || buildFallbackMarketingTitle(card);
  const productCode = `${PRODUCT_CODE_PREFIX}-${resolveOrderTail(order.orderNumber)}-${resolveGalleryTail(
    card.galleryCardId
  )}`;
  const productTitle = `${marketingTitle} | LootCard ${productCode}`;
  const sku = productCode;
  const productHandle = slugify(`${marketingTitle}-${productCode.toLowerCase()}`);

  return {
    marketingTitle,
    productTitle,
    productCode,
    productHandle,
    sku,
  };
};

const buildProductPayload = (
  card: ShopifyNamingSource,
  order: ShopifyOrderInput,
  identity: ReturnType<typeof buildProductIdentity>
): ShopifyProductPayload => ({
  product: {
    title: identity.productTitle,
    handle: identity.productHandle,
    body_html: card.description,
    tags: [...card.tags, `gallery-card:${card.galleryCardId}`, `order:${order.orderNumber}`].join(", "),
    status: "active",
    images: card.imageUrl ? [{ src: card.imageUrl }] : undefined,
    variants: [{ price: card.price, sku: identity.sku }],
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
    const storedCard = await galleryRepository.findById(card.galleryCardId);
    const namingSource = buildResolvedNamingSource(card, storedCard);
    const identity = buildProductIdentity(namingSource, order);

    logger.info("[SHOPIFY SERVICE] create product start", {
      orderNumber: order.orderNumber,
      galleryCardId: card.galleryCardId,
      title: namingSource.title,
      marketingTitle: identity.marketingTitle,
      metadataMarketingTitle: readMetadataMarketingTitle(namingSource.metadata ?? null),
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
        body: JSON.stringify(buildProductPayload(namingSource, order, identity)),
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
