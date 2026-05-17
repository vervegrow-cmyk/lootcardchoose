import { Prisma } from "@prisma/client";
import { prisma } from "../services/prisma.service";

export type GallerySearchSessionRecord = {
  id: string;
  discordGuildId: string | null;
  discordUserId: string;
  discordChannelId: string;
  query: string;
  results: Prisma.JsonValue;
  selectedGalleryCardId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export type GallerySearchSessionRepository = {
  create: (input: {
    discordGuildId?: string | null;
    discordUserId: string;
    discordChannelId: string;
    query: string;
    results: Prisma.InputJsonValue;
    status: string;
  }) => Promise<GallerySearchSessionRecord>;
  findLatest: (input: {
    discordGuildId?: string | null;
    discordUserId: string;
    discordChannelId: string;
    status?: string;
  }) => Promise<GallerySearchSessionRecord | null>;
  findLatestByUserId: (discordUserId: string) => Promise<GallerySearchSessionRecord | null>;
  findRecentByUserId: (input: {
    discordGuildId?: string | null;
    discordUserId: string;
    discordChannelId?: string;
    take?: number;
    status?: string;
  }) => Promise<GallerySearchSessionRecord[]>;
  archiveActiveSessions: (input: {
    discordGuildId?: string | null;
    discordUserId: string;
    discordChannelId: string;
  }) => Promise<number>;
  archiveOtherActiveSessions: (input: {
    discordGuildId?: string | null;
    discordUserId: string;
    discordChannelId: string;
    keepSessionId: string;
  }) => Promise<number>;
  updateSelectedCard: (input: { sessionId: string; galleryCardId: string }) => Promise<void>;
};

export const gallerySearchSessionRepository: GallerySearchSessionRepository = {
  async create(input) {
    const normalizedGuildId = input.discordGuildId ?? null;

    return prisma.gallerySearchSession.create({
      data: {
        discordGuildId: normalizedGuildId,
        discordUserId: input.discordUserId,
        discordChannelId: input.discordChannelId,
        query: input.query,
        results: input.results,
        status: input.status,
      },
    });
  },
  async findLatest(input) {
    const normalizedGuildId = input.discordGuildId ?? null;

    return prisma.gallerySearchSession.findFirst({
      where: {
        discordGuildId: normalizedGuildId,
        discordUserId: input.discordUserId,
        discordChannelId: input.discordChannelId,
        ...(input.status ? { status: input.status } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  },
  async findLatestByUserId(discordUserId) {
    return prisma.gallerySearchSession.findFirst({
      where: {
        discordUserId,
      },
      orderBy: { createdAt: "desc" },
    });
  },
  async findRecentByUserId(input) {
    const normalizedGuildId = input.discordGuildId ?? null;

    return prisma.gallerySearchSession.findMany({
      where: {
        discordGuildId: normalizedGuildId,
        discordUserId: input.discordUserId,
        ...(input.discordChannelId ? { discordChannelId: input.discordChannelId } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: input.take ?? 20,
    });
  },
  async archiveActiveSessions(input) {
    const normalizedGuildId = input.discordGuildId ?? null;

    const result = await prisma.gallerySearchSession.updateMany({
      where: {
        discordGuildId: normalizedGuildId,
        discordUserId: input.discordUserId,
        discordChannelId: input.discordChannelId,
        status: "active",
      },
      data: {
        status: "archived",
      },
    });

    return result.count;
  },
  async archiveOtherActiveSessions(input) {
    const normalizedGuildId = input.discordGuildId ?? null;

    const result = await prisma.gallerySearchSession.updateMany({
      where: {
        discordGuildId: normalizedGuildId,
        discordUserId: input.discordUserId,
        discordChannelId: input.discordChannelId,
        status: "active",
        id: {
          not: input.keepSessionId,
        },
      },
      data: {
        status: "archived",
      },
    });

    return result.count;
  },
  async updateSelectedCard(input) {
    await prisma.gallerySearchSession.update({
      where: { id: input.sessionId },
      data: { selectedGalleryCardId: input.galleryCardId },
    });
  },
};
