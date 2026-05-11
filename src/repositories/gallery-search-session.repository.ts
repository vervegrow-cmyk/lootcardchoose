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
  findLatest: (input: { discordUserId: string; discordChannelId: string }) => Promise<GallerySearchSessionRecord | null>;
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
      },
      orderBy: { createdAt: "desc" },
    });
  },
  async updateSelectedCard(input) {
    await prisma.gallerySearchSession.update({
      where: { id: input.sessionId },
      data: { selectedGalleryCardId: input.galleryCardId, status: "selected" },
    });
  },
};
