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
  score?: number;
};

type ParsedGallerySearchInput = {
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
};

type ScoredGalleryCard = {
  card: GalleryCardRecord;
  score: number;
};

export type GalleryRepository = {
  search: (query: ParsedGallerySearchInput) => Promise<GalleryCardRecord[]>;
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
  findManyByParsedQuery: (query: ParsedGallerySearchInput) => Promise<GalleryCardRecord[]>;
};

const SEARCH_CANDIDATE_LIMIT = 200;
const DEFAULT_REPOSITORY_LIMIT = 10;

const normalizeSearchLimit = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_REPOSITORY_LIMIT;
  }

  if (value < 1) {
    return DEFAULT_REPOSITORY_LIMIT;
  }

  return Math.min(Math.floor(value), DEFAULT_REPOSITORY_LIMIT);
};

const normalizeText = (value: string | null | undefined): string => (value ?? "").trim().toLowerCase();

const normalizeKeywords = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(trimmed);
  }

  return result;
};

const readMetadataSyncSourceId = (metadata: Prisma.JsonValue | null): string | null => {
  if (metadata == null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>).syncSourceId;
  return typeof value === "string" ? value : null;
};

const stringifyMetadata = (metadata: Prisma.JsonValue | null): string => {
  if (metadata == null) {
    return "";
  }

  try {
    return JSON.stringify(metadata).toLowerCase();
  } catch {
    return "";
  }
};

const buildKeywordMatchers = (keyword: string): Prisma.GalleryCardWhereInput[] => [
  { title: { contains: keyword, mode: "insensitive" } },
  { description: { contains: keyword, mode: "insensitive" } },
  { tags: { has: keyword } },
  { style: { contains: keyword, mode: "insensitive" } },
  { rarity: { contains: keyword, mode: "insensitive" } },
  { category: { contains: keyword, mode: "insensitive" } },
  { character: { contains: keyword, mode: "insensitive" } },
  { color: { contains: keyword, mode: "insensitive" } },
];

const buildSearchWhere = (input: ParsedGallerySearchInput): Prisma.GalleryCardWhereInput => {
  const keywords = normalizeKeywords(input.keywords);
  const tags = normalizeKeywords(input.tags);
  const orFilters: Prisma.GalleryCardWhereInput[] = [];

  for (const keyword of keywords) {
    orFilters.push(...buildKeywordMatchers(keyword));
  }

  for (const tag of tags) {
    orFilters.push({ tags: { has: tag } });
  }

  if (input.style) {
    orFilters.push({ style: { contains: input.style, mode: "insensitive" } });
  }
  if (input.rarity) {
    orFilters.push({ rarity: { contains: input.rarity, mode: "insensitive" } });
  }
  if (input.category) {
    orFilters.push({ category: { contains: input.category, mode: "insensitive" } });
  }
  if (input.character) {
    orFilters.push({ character: { contains: input.character, mode: "insensitive" } });
  }
  if (input.color) {
    orFilters.push({ color: { contains: input.color, mode: "insensitive" } });
  }
  if (input.mood) {
    orFilters.push({ description: { contains: input.mood, mode: "insensitive" } });
  }
  if (input.scene) {
    orFilters.push({ description: { contains: input.scene, mode: "insensitive" } });
  }

  return {
    isActive: true,
    OR: orFilters.length > 0 ? orFilters : undefined,
  };
};

const scoreKeywordMatches = (card: GalleryCardRecord, keywords: string[], tags: string[]): number => {
  const tagSet = new Set(card.tags.map((tag) => normalizeText(tag)));
  const title = normalizeText(card.title);
  const description = normalizeText(card.description);
  const style = normalizeText(card.style);
  const metadata = stringifyMetadata(card.metadata);
  const normalizedKeywords = keywords.map((keyword) => normalizeText(keyword));
  const normalizedTags = tags.map((tag) => normalizeText(tag));

  let score = 0;

  for (const tag of [...normalizedKeywords, ...normalizedTags]) {
    if (tagSet.has(tag)) {
      score += 10;
    }
  }

  for (const keyword of normalizedKeywords) {
    if (style.includes(keyword)) {
      score += 5;
    }
    if (title.includes(keyword)) {
      score += 3;
    }
    if (description.includes(keyword)) {
      score += 3;
    }
    if (metadata.includes(keyword)) {
      score += 2;
    }
  }

  return score;
};

const scoreStructuredFields = (card: GalleryCardRecord, input: ParsedGallerySearchInput): number => {
  let score = 0;

  if (input.rarity && normalizeText(card.rarity) === normalizeText(input.rarity)) {
    score += 8;
  }
  if (input.color && normalizeText(card.color) === normalizeText(input.color)) {
    score += 8;
  }
  if (input.character && normalizeText(card.character) === normalizeText(input.character)) {
    score += 8;
  }
  if (input.category && normalizeText(card.category) === normalizeText(input.category)) {
    score += 5;
  }
  if (input.style && normalizeText(card.style).includes(normalizeText(input.style))) {
    score += 5;
  }

  const metadata = stringifyMetadata(card.metadata);
  if (input.mood && metadata.includes(normalizeText(input.mood))) {
    score += 2;
  }
  if (input.scene && metadata.includes(normalizeText(input.scene))) {
    score += 2;
  }

  return score;
};

const rankCards = (cards: GalleryCardRecord[], input: ParsedGallerySearchInput): GalleryCardRecord[] => {
  const keywords = normalizeKeywords(input.keywords);
  const tags = normalizeKeywords(input.tags);

  const scored = cards
    .map(
      (card): ScoredGalleryCard => ({
        card,
        score: scoreKeywordMatches(card, keywords, tags) + scoreStructuredFields(card, input),
      })
    )
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.card.createdAt.getTime() - left.card.createdAt.getTime();
    });

  return scored.map((entry) => ({
    ...entry.card,
    score: entry.score,
  }));
};

const searchAndRank = async (input: ParsedGallerySearchInput): Promise<GalleryCardRecord[]> => {
  const limit = normalizeSearchLimit(input.limit);
  const candidates = await prisma.galleryCard.findMany({
    where: buildSearchWhere(input),
    take: SEARCH_CANDIDATE_LIMIT,
    orderBy: { createdAt: "desc" },
  });

  const ranked = rankCards(candidates, input).slice(0, limit);
  logger.info("[GALLERY REPOSITORY] result count=" + ranked.length);
  return ranked;
};

export const galleryRepository: GalleryRepository = {
  async search(query) {
    const limit = normalizeSearchLimit(query.limit);
    const keywords = normalizeKeywords(query.keywords);
    const tags = normalizeKeywords(query.tags);

    logger.info("[GALLERY REPOSITORY] prisma search start", {
      keywords,
      tags,
      limit,
      rarity: query.rarity,
      color: query.color,
      character: query.character,
      category: query.category,
      style: query.style,
      mood: query.mood,
      scene: query.scene,
    });

    return searchAndRank({
      ...query,
      keywords,
      tags,
      limit,
    });
  },
  async findManyByQuery(query) {
    return galleryRepository.search({
      keywords: query.keywords,
      tags: [],
      style: "",
      rarity: "",
      category: "",
      character: "",
      color: "",
      mood: "",
      scene: "",
      limit: query.limit,
    });
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
    return galleryRepository.search({
      ...query,
      limit: query.limit,
    });
  },
};
