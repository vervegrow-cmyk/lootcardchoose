import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import { Prisma } from "@prisma/client";
import { galleryIntelligenceService } from "../services/gallery-intelligence.service";
import { prisma } from "../services/prisma.service";

type GalleryCardBatchRecord = {
  id: string;
  title: string;
  description: string | null;
  tags: string[];
  style: string | null;
  rarity: string | null;
  category: string | null;
  character: string | null;
  color: string | null;
  metadata: Prisma.JsonValue | null;
};

type Summary = {
  scanned: number;
  enriched: number;
  skipped: number;
  failed: number;
};

const BATCH_SIZE = 100;

const isPlainObject = (value: Prisma.JsonValue | null): value is Prisma.JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const parseArgs = (): { force: boolean } => ({
  force: process.argv.includes("--force"),
});

const buildNextMetadata = (
  metadata: Prisma.JsonValue | null,
  intelligence: ReturnType<typeof galleryIntelligenceService.buildMetadata>
): Prisma.InputJsonValue => {
  const next: Record<string, unknown> = isPlainObject(metadata) ? { ...metadata } : {};
  next.intelligence = intelligence;
  return next as Prisma.InputJsonValue;
};

const hasExistingIntelligence = (metadata: Prisma.JsonValue | null): boolean => {
  if (!isPlainObject(metadata)) {
    return false;
  }

  const intelligence = metadata.intelligence;
  return intelligence !== null && intelligence !== undefined;
};

const main = async (): Promise<void> => {
  const options = parseArgs();
  const summary: Summary = {
    scanned: 0,
    enriched: 0,
    skipped: 0,
    failed: 0,
  };

  let cursorId: string | undefined;

  try {
    while (true) {
      const batch = await prisma.galleryCard.findMany({
        select: {
          id: true,
          title: true,
          description: true,
          tags: true,
          style: true,
          rarity: true,
          category: true,
          character: true,
          color: true,
          metadata: true,
        },
        orderBy: {
          id: "asc",
        },
        take: BATCH_SIZE,
        ...(cursorId
          ? {
              cursor: { id: cursorId },
              skip: 1,
            }
          : {}),
      });

      if (batch.length === 0) {
        break;
      }

      for (const card of batch as GalleryCardBatchRecord[]) {
        summary.scanned += 1;

        try {
          if (!options.force && hasExistingIntelligence(card.metadata)) {
            summary.skipped += 1;
            continue;
          }

          const intelligence = galleryIntelligenceService.buildMetadata({
            title: card.title,
            description: card.description,
            tags: card.tags,
            style: card.style,
            rarity: card.rarity,
            category: card.category,
            character: card.character,
            color: card.color,
            metadata: card.metadata,
          });

          const nextMetadata = buildNextMetadata(card.metadata, intelligence);
          await prisma.galleryCard.update({
            where: { id: card.id },
            data: {
              metadata: nextMetadata,
            },
          });

          summary.enriched += 1;
        } catch (error) {
          summary.failed += 1;
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[GALLERY ENRICH] failed card=${card.id} title=${JSON.stringify(card.title)} ${message}`);
        }
      }

      cursorId = batch[batch.length - 1]?.id;
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error) => {
  console.error("[GALLERY ENRICH] fatal error", error);
  process.exit(1);
});
