export type ShopifyCreateProductInput = {
  title: string;
  description: string | null;
  imageUrl: string;
  price: string;
  tags: string[];
  orderNumber: string;
};

export type ShopifyCreateProductOutput = {
  checkoutUrl: string;
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
    images?: ShopifyProductImage[];
    variants: ShopifyVariant[];
  };
};

type ShopifyProductResponse = {
  product: {
    id: number;
    handle: string;
    variants?: Array<{
      id: number;
    }>;
  };
};

const resolveShopifyStoreDomain = (): string => {
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN ?? "";
  if (!storeDomain) {
    throw new Error("Missing SHOPIFY_STORE_DOMAIN");
  }
  return storeDomain;
};

const resolveShopifyApiVersion = (): string => process.env.SHOPIFY_API_VERSION ?? "2026-04";

const buildProductPayload = (input: ShopifyCreateProductInput): ShopifyProductPayload => ({
  product: {
    title: input.title,
    body_html: input.description,
    tags: [...input.tags, `order:${input.orderNumber}`].join(", "),
    images: input.imageUrl ? [{ src: input.imageUrl }] : undefined,
    variants: [{ price: input.price }],
  },
});

const resolveProductUrl = (storeDomain: string, handle: string): string =>
  `https://${storeDomain}/products/${handle}`;

const resolveCartUrl = (storeDomain: string, variantId: number, orderNumber: string): string => {
  const url = new URL(`https://${storeDomain}/cart/${variantId}:1`);
  url.searchParams.set("attributes[orderNumber]", orderNumber);
  url.searchParams.set("note", orderNumber);
  return url.toString();
};

export const shopifyService = {
  async createCheckoutLink(input: ShopifyCreateProductInput): Promise<ShopifyCreateProductOutput> {
    const { shopifyInstallationService } = await import("./shopify-installation.service");
    const storeDomain = resolveShopifyStoreDomain();
    const apiVersion = resolveShopifyApiVersion();
    const accessToken = await shopifyInstallationService.getAccessTokenForStore();

    const response = await fetch(`https://${storeDomain}/admin/api/${apiVersion}/products.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify(buildProductPayload(input)),
    });

    if (!response.ok) {
      const payload = await response.text();
      throw new Error(`Shopify create product failed: ${response.status} ${payload}`);
    }

    const data = (await response.json()) as ShopifyProductResponse;
    const product = data.product;
    const handle = product?.handle;
    if (!handle) {
      throw new Error("Shopify create product response missing handle");
    }

    const variantId = product.variants?.[0]?.id;
    if (variantId) {
      return { checkoutUrl: resolveCartUrl(storeDomain, variantId, input.orderNumber) };
    }

    return { checkoutUrl: resolveProductUrl(storeDomain, handle) };
  },
};
