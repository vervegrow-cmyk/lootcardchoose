import { prisma } from "../services/prisma.service";

export type ShopifyInstallationRecord = {
  id: string;
  shop: string;
  accessToken: string;
  scope: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export const shopifyInstallationRepository = {
  async findByShop(shop: string): Promise<ShopifyInstallationRecord | null> {
    return prisma.shopifyInstallation.findUnique({ where: { shop } });
  },
  async upsertInstallation(input: {
    shop: string;
    accessToken: string;
    scope: string | null;
  }): Promise<ShopifyInstallationRecord> {
    return prisma.shopifyInstallation.upsert({
      where: { shop: input.shop },
      create: {
        shop: input.shop,
        accessToken: input.accessToken,
        scope: input.scope,
      },
      update: {
        accessToken: input.accessToken,
        scope: input.scope,
      },
    });
  },
};
