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
  findById: (cardId: string) => Promise<GalleryCardRecord | null>;
  upsertSyncedCard: (input: {
    syncSourceId: string;
    title: string;
    description: string | null;
    imageUrl: string;
    tags: string[];
    style: string | null;
    rarity: string | null;
    category: string | null;
    character: string | null;
    color: string | null;
    price: string;
    metadata: Prisma.InputJsonValue;
    isActive: boolean;
  }) => Promise<GalleryCardRecord>;
  deactivateCardsMissingFromSyncSource: (activeSyncSourceIds: string[]) => Promise<number>;
  findManyByParsedQuery: (query: {
    keywords: string[];
    tags: string[];
    style: string;
    rarity: string;
    category: string;
    character: string;
    color: string;
    mood: string;
    scene: string;
    limit?: number;
  }) => Promise<GalleryCardRecord[]>;
};

const readMetadataSyncSourceId = (metadata: Prisma.JsonValue | null): string | null => {
  if (metadata == null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>).syncSourceId;
  return typeof value === "string" ? value : null;
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
  async findById(cardId) {
    return prisma.galleryCard.findFirst({
      where: { id: cardId, isActive: true },
    });
  },
  async upsertSyncedCard(input) {
    const existing = await prisma.galleryCard.findFirst({
      where: {
        metadata: {
          path: ["syncSourceId"],
          equals: input.syncSourceId,
        },
      },
    });

    const data = {
      title: input.title,
      description: input.description,
      imageUrl: input.imageUrl,
      tags: input.tags,
      style: input.style,
      rarity: input.rarity,
      category: input.category,
      character: input.character,
      color: input.color,
      price: input.price,
      metadata: input.metadata,
      isActive: input.isActive,
    };

    if (existing) {
      return prisma.galleryCard.update({
        where: { id: existing.id },
        data,
      });
    }

    return prisma.galleryCard.create({
      data,
    });
  },
  async deactivateCardsMissingFromSyncSource(activeSyncSourceIds) {
    const activeIdSet = new Set(activeSyncSourceIds);
    const activeCards = await prisma.galleryCard.findMany({
      where: { isActive: true },
      select: {
        id: true,
        metadata: true,
      },
    });

    const idsToDeactivate = activeCards
      .filter((card) => {
        const syncSourceId = readMetadataSyncSourceId(card.metadata);
        return syncSourceId?.startsWith("local-gallery:") && !activeIdSet.has(syncSourceId);
      })
      .map((card) => card.id);

    if (idsToDeactivate.length === 0) {
      return 0;
    }

    const result = await prisma.galleryCard.updateMany({
      where: {
        id: { in: idsToDeactivate },
      },
      data: {
        isActive: false,
      },
    });

    return result.count;
  },
  async findManyByParsedQuery(query) {
    const limit = query.limit ?? 10;
    const keywords = query.keywords.filter((keyword) => keyword.trim().length > 0);
    const tags = query.tags.filter((tag) => tag.trim().length > 0);

    logger.info("[GALLERY REPOSITORY] prisma search start", {
      keywords,
      tags,
      limit,
    });

    const where: Prisma.GalleryCardWhereInput = {
      isActive: true,
      AND: [
        keywords.length > 0 ? { OR: buildKeywordFilters(keywords) } : undefined,
        tags.length > 0 ? { tags: { hasSome: tags } } : undefined,
        query.style ? { style: { contains: query.style, mode: "insensitive" } } : undefined,
        query.rarity ? { rarity: { contains: query.rarity, mode: "insensitive" } } : undefined,
        query.category ? { category: { contains: query.category, mode: "insensitive" } } : undefined,
        query.character ? { character: { contains: query.character, mode: "insensitive" } } : undefined,
        query.color ? { color: { contains: query.color, mode: "insensitive" } } : undefined,
        query.mood ? { description: { contains: query.mood, mode: "insensitive" } } : undefined,
        query.scene ? { description: { contains: query.scene, mode: "insensitive" } } : undefined,
      ].filter(Boolean) as Prisma.GalleryCardWhereInput[],
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
