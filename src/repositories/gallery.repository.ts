import { Prisma } from "@prisma/client";
import { prisma } from "../services/prisma.service";
import { logger } from "../utils/logger";

export type GalleryCardRecord = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string;
  tags: string[];
  style: string | null;
  rarity: string | null;
  category: string | null;
  character: string | null;
  color: string | null;
  price: Prisma.Decimal;
  metadata: Prisma.JsonValue | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type GalleryRepository = {
  findManyByQuery: (query: { keywords: string[]; limit?: number }) => Promise<GalleryCardRecord[]>;
};

const buildKeywordFilters = (keywords: string[]): Prisma.GalleryCardWhereInput[] => {
  return keywords.map((keyword) => ({
    OR: [
      { title: { contains: keyword, mode: "insensitive" } },
      { tags: { has: keyword } },
      { style: { contains: keyword, mode: "insensitive" } },
      { rarity: { contains: keyword, mode: "insensitive" } },
      { category: { contains: keyword, mode: "insensitive" } },
      { character: { contains: keyword, mode: "insensitive" } },
      { color: { contains: keyword, mode: "insensitive" } },
    ],
  }));
};

export const galleryRepository: GalleryRepository = {
  async findManyByQuery(query) {
    const limit = query.limit ?? 10;
    const keywords = query.keywords.filter((keyword) => keyword.trim().length > 0);

    logger.info("[GALLERY REPOSITORY] prisma search start", { keywords, limit });

    const where: Prisma.GalleryCardWhereInput = {
      isActive: true,
      AND: keywords.length > 0 ? buildKeywordFilters(keywords) : undefined,
    };

    const results = await prisma.galleryCard.findMany({
      where,
      take: limit,
      orderBy: { createdAt: "desc" },
    });

    logger.info("[GALLERY REPOSITORY] result count=" + results.length);

    return results;
  },
};
