import { Prisma } from "@prisma/client";
import { prisma } from "../services/prisma.service";

export type GallerySearchSessionRecord = {
  id: string;
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
    discordUserId: string;
    discordChannelId: string;
    query: string;
    results: Prisma.InputJsonValue;
    status: string;
  }) => Promise<GallerySearchSessionRecord>;
  findLatest: (input: {
    discordUserId: string;
    discordChannelId: string;
    status?: string;
  }) => Promise<GallerySearchSessionRecord | null>;
  findLatestByUserId: (discordUserId: string) => Promise<GallerySearchSessionRecord | null>;
  findRecentByUserId: (input: {
    discordUserId: string;
    discordChannelId?: string;
    take?: number;
    status?: string;
  }) => Promise<GallerySearchSessionRecord[]>;
  archiveActiveSessions: (input: { discordUserId: string; discordChannelId: string }) => Promise<number>;
  archiveOtherActiveSessions: (input: {
    discordUserId: string;
    discordChannelId: string;
    keepSessionId: string;
  }) => Promise<number>;
  updateSelectedCard: (input: { sessionId: string; galleryCardId: string }) => Promise<void>;
};

export const gallerySearchSessionRepository: GallerySearchSessionRepository = {
  async create(input) {
    return prisma.gallerySearchSession.create({
      data: {
        discordUserId: input.discordUserId,
        discordChannelId: input.discordChannelId,
        query: input.query,
        results: input.results,
        status: input.status,
      },
    });
  },
  async findLatest(input) {
    return prisma.gallerySearchSession.findFirst({
      where: {
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
    return prisma.gallerySearchSession.findMany({
      where: {
        discordUserId: input.discordUserId,
        ...(input.discordChannelId ? { discordChannelId: input.discordChannelId } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: input.take ?? 20,
    });
  },
  async archiveActiveSessions(input) {
    const result = await prisma.gallerySearchSession.updateMany({
      where: {
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
    const result = await prisma.gallerySearchSession.updateMany({
      where: {
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
