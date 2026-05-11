import { isDatabaseReady } from "./prisma.service";
import { shopifyInstallationRepository } from "../repositories/shopify-installation.repository";

const resolveShopifyStoreDomain = (): string => {
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN ?? "";
  if (!storeDomain) {
    throw new Error("Missing SHOPIFY_STORE_DOMAIN");
  }
  return storeDomain;
};

export const shopifyInstallationService = {
  async getAccessTokenForStore(): Promise<string> {
    if (!isDatabaseReady()) {
      throw new Error("Database not configured for Shopify installation lookup");
    }
    const shop = resolveShopifyStoreDomain();
    const installation = await shopifyInstallationRepository.findByShop(shop);
    if (!installation) {
      throw new Error("Shopify installation not found");
    }
    return installation.accessToken;
  },
  async saveInstallation(input: {
    shop: string;
    accessToken: string;
    scope: string | null;
  }): Promise<void> {
    if (!isDatabaseReady()) {
      throw new Error("Database not configured for Shopify installation storage");
    }
    await shopifyInstallationRepository.upsertInstallation(input);
  },
};
