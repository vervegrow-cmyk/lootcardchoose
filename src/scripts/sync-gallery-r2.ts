import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { loadEnv } from "../config/env";
import { galleryRepository } from "../repositories/gallery.repository";
import { cardNamingService, resolveExistingMarketingTitle } from "../services/card-naming.service";
import {
  createFilenameFallbackMetadata,
  galleryVisionMetadataService,
} from "../services/gallery-vision-metadata.service";
import { prisma } from "../services/prisma.service";
import { r2Service } from "../services/r2.service";
import {
  LOCAL_GALLERY_SOURCE_PREFIX,
  slugToTitle,
  type GalleryImageMetadata,
} from "../utils/gallery-metadata";

const GALLERY_ROOT = path.resolve(process.cwd(), "data", "gallery-images");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const R2_PREFIX = "gallery";

type NormalizedGalleryImageMetadata = {
  title: string;
  description: string | null;
  tags: string[];
  style: string | null;
  rarity: string | null;
  category: string | null;
  character: string | null;
  color: string | null;
  mood: string | null;
  scene: string | null;
  price: string;
  confidence: number | null;
  visionSource: string | null;
  isActive: boolean;
  metadata: Record<string, unknown>;
};

type GallerySyncItem = {
  imagePath: string;
  relativePath: string;
  metadataPath: string;
  metadata: GalleryImageMetadata;
  metadataGenerated: boolean;
};

type GallerySyncStats = {
  imagesFound: number;
  metadataGenerated: number;
  metadataDeleted: number;
  uploaded: number;
  upserted: number;
  deactivated: number;
  r2Deleted: number;
  failed: number;
};

const walkDirectory = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return walkDirectory(fullPath);
      }
      return [fullPath];
    })
  );

  return files.flat();
};

const readMetadataFile = async (metadataPath: string): Promise<GalleryImageMetadata> => {
  const raw = await readFile(metadataPath, "utf8");
  return JSON.parse(raw) as GalleryImageMetadata;
};

const writeMetadataFile = async (metadataPath: string, metadata: GalleryImageMetadata): Promise<void> => {
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
};

const ensureMetadataMarketingTitle = async (
  metadata: GalleryImageMetadata,
  relativePath: string,
  preservedMarketingTitle?: string | null
): Promise<{ metadata: GalleryImageMetadata; updated: boolean }> => {
  const existingMarketingTitle = preservedMarketingTitle ?? resolveExistingMarketingTitle(metadata.metadata);
  if (existingMarketingTitle) {
    return {
      metadata: {
        ...metadata,
        metadata: {
          ...(metadata.metadata ?? {}),
          marketingTitle: existingMarketingTitle,
        },
      },
      updated: resolveExistingMarketingTitle(metadata.metadata) !== existingMarketingTitle,
    };
  }

  const generated = await cardNamingService.generateMarketingTitle({
    title: metadata.title,
    description: metadata.description ?? null,
    tags: metadata.tags ?? [],
    style: metadata.style ?? null,
    rarity: metadata.rarity ?? null,
    category: metadata.category ?? null,
    character: metadata.character ?? null,
    color: metadata.color ?? null,
    metadata: metadata.metadata ?? null,
    sourceId: buildSyncSourceId(relativePath),
  });

  return {
    metadata: {
      ...metadata,
      metadata: {
        ...(metadata.metadata ?? {}),
        marketingTitle: generated.marketingTitle,
      },
    },
    updated: true,
  };
};

const normalizeRelativePath = (filePath: string): string => filePath.replace(/\\/g, "/");

const buildSyncSourceId = (relativePath: string): string => `${LOCAL_GALLERY_SOURCE_PREFIX}${normalizeRelativePath(relativePath)}`;

const buildR2Key = (relativePath: string): string => `${R2_PREFIX}/${normalizeRelativePath(relativePath)}`;

const hasMatchingImage = (jsonPath: string, fileSet: Set<string>): boolean => {
  const basePath = jsonPath.slice(0, -path.extname(jsonPath).length);

  for (const extension of IMAGE_EXTENSIONS) {
    const candidate = `${basePath}${extension}`;
    if (fileSet.has(candidate)) {
      return true;
    }
  }

  return false;
};

const cleanupOrphanMetadataFiles = async (files: string[]): Promise<number> => {
  const fileSet = new Set(files);
  let deletedCount = 0;

  for (const filePath of files) {
    if (path.extname(filePath).toLowerCase() !== ".json") {
      continue;
    }

    if (!hasMatchingImage(filePath, fileSet)) {
      await rm(filePath, { force: true });
      deletedCount += 1;
      console.log(`[Gallery Sync] orphan metadata deleted: ${normalizeRelativePath(path.relative(GALLERY_ROOT, filePath))}`);
    }
  }

  return deletedCount;
};

const loadSyncItems = async (): Promise<GallerySyncItem[]> => {
  const env = loadEnv();
  const files = await walkDirectory(GALLERY_ROOT);
  const imageFiles = files.filter((filePath) => IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase()));

  return Promise.all(
    imageFiles.map(async (imagePath) => {
      const relativePath = path.relative(GALLERY_ROOT, imagePath);
      const sidecarMetadataPath = imagePath.replace(path.extname(imagePath), ".json");
      let metadata: GalleryImageMetadata = {};
      let metadataGenerated = false;
      const syncSourceId = buildSyncSourceId(relativePath);

      try {
        metadata = await readMetadataFile(sidecarMetadataPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("ENOENT")) {
          throw error;
        }
        if (env.enableGalleryVisionMetadata) {
          try {
            console.log(`[Gallery Sync] analyzing image with vision AI: ${normalizeRelativePath(relativePath)}`);
            metadata = await galleryVisionMetadataService.analyzeImage(imagePath, syncSourceId);
          } catch (visionError) {
            const visionMessage = visionError instanceof Error ? visionError.message : String(visionError);
            console.error(
              `[Gallery Sync] vision metadata failed ${normalizeRelativePath(relativePath)} ${visionMessage}`
            );
            metadata = createFilenameFallbackMetadata(imagePath, syncSourceId);
          }
        } else {
          metadata = createFilenameFallbackMetadata(imagePath, syncSourceId);
        }
        await writeMetadataFile(sidecarMetadataPath, metadata);
        metadataGenerated = true;
      }

      const { metadata: enrichedMetadata, updated: marketingTitleUpdated } = await ensureMetadataMarketingTitle(
        metadata,
        relativePath
      );
      if (marketingTitleUpdated) {
        await writeMetadataFile(sidecarMetadataPath, enrichedMetadata);
      }
      metadata = enrichedMetadata;

      return {
        imagePath,
        relativePath,
        metadataPath: sidecarMetadataPath,
        metadata,
        metadataGenerated,
      };
    })
  );
};

const normalizeTags = (tags: string[] | undefined): string[] =>
  (tags ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0);

const normalizePrice = (price: string | number | null | undefined): string => {
  if (typeof price === "number") {
    return price.toFixed(2);
  }
  if (typeof price === "string" && price.trim().length > 0) {
    return price;
  }
  return "0.00";
};

const normalizeOptionalString = (value: string | null | undefined, field: string, relativePath: string): string | null => {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid metadata field "${field}" in ${relativePath}: expected string or null`);
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeMetadata = (relativePath: string, metadata: GalleryImageMetadata): NormalizedGalleryImageMetadata => {
  if (metadata.title != null && typeof metadata.title !== "string") {
    throw new Error(`Invalid metadata field "title" in ${relativePath}: expected string`);
  }
  if (metadata.description != null && typeof metadata.description !== "string") {
    throw new Error(`Invalid metadata field "description" in ${relativePath}: expected string or null`);
  }
  if (metadata.tags != null && !Array.isArray(metadata.tags)) {
    throw new Error(`Invalid metadata field "tags" in ${relativePath}: expected string[]`);
  }
  if (metadata.tags && metadata.tags.some((tag) => typeof tag !== "string")) {
    throw new Error(`Invalid metadata field "tags" in ${relativePath}: expected string[]`);
  }
  if (metadata.price != null && typeof metadata.price !== "string" && typeof metadata.price !== "number") {
    throw new Error(`Invalid metadata field "price" in ${relativePath}: expected string or number`);
  }
  if (metadata.confidence != null && typeof metadata.confidence !== "number") {
    throw new Error(`Invalid metadata field "confidence" in ${relativePath}: expected number`);
  }
  if (metadata.isActive != null && typeof metadata.isActive !== "boolean") {
    throw new Error(`Invalid metadata field "isActive" in ${relativePath}: expected boolean`);
  }
  if (metadata.metadata != null && (typeof metadata.metadata !== "object" || Array.isArray(metadata.metadata))) {
    throw new Error(`Invalid metadata field "metadata" in ${relativePath}: expected object`);
  }

  return {
    title: metadata.title?.trim() || slugToTitle(relativePath),
    description: normalizeOptionalString(metadata.description, "description", relativePath),
    tags: normalizeTags(metadata.tags),
    style: normalizeOptionalString(metadata.style, "style", relativePath),
    rarity: normalizeOptionalString(metadata.rarity, "rarity", relativePath),
    category: normalizeOptionalString(metadata.category, "category", relativePath),
    character: normalizeOptionalString(metadata.character, "character", relativePath),
    color: normalizeOptionalString(metadata.color, "color", relativePath),
    mood: normalizeOptionalString(metadata.mood, "mood", relativePath),
    scene: normalizeOptionalString(metadata.scene, "scene", relativePath),
    price: normalizePrice(metadata.price),
    confidence: metadata.confidence ?? null,
    visionSource: normalizeOptionalString(metadata.visionSource, "visionSource", relativePath),
    isActive: metadata.isActive ?? true,
    metadata: metadata.metadata ?? {},
  };
};

const syncItem = async (item: GallerySyncItem): Promise<void> => {
  const normalized = normalizeMetadata(item.relativePath, item.metadata);
  const syncSourceId = buildSyncSourceId(item.relativePath);
  const r2Key = buildR2Key(item.relativePath);
  const upload = await r2Service.uploadFile({
    key: r2Key,
    filePath: item.imagePath,
  });

  const metadata: Prisma.InputJsonValue = {
    ...normalized.metadata,
    mood: normalized.mood,
    scene: normalized.scene,
    confidence: normalized.confidence,
    visionSource: normalized.visionSource,
    syncSourceId,
    filename: path.basename(item.imagePath),
    localImagePath: item.imagePath,
    localMetadataPath: item.metadataPath,
    r2Key: upload.key,
    r2PublicUrl: upload.publicUrl,
  };

  await galleryRepository.upsertSyncedCard({
    syncSourceId,
    title: normalized.title,
    description: normalized.description,
    imageUrl: upload.publicUrl,
    tags: normalized.tags,
    style: normalized.style,
    rarity: normalized.rarity,
    category: normalized.category,
    character: normalized.character,
    color: normalized.color,
    price: normalized.price,
    metadata,
    isActive: normalized.isActive,
  });
};

const deleteStaleR2Objects = async (activeR2Keys: string[]): Promise<number> => {
  const activeKeySet = new Set(activeR2Keys.map(normalizeRelativePath));
  const remoteKeys = await r2Service.listObjects(`${R2_PREFIX}/`);
  let deletedCount = 0;

  for (const remoteKey of remoteKeys) {
    const normalizedKey = normalizeRelativePath(remoteKey);
    if (!normalizedKey.startsWith(`${R2_PREFIX}/`)) {
      continue;
    }
    if (activeKeySet.has(normalizedKey)) {
      continue;
    }

    await r2Service.deleteObject(normalizedKey);
    deletedCount += 1;
    console.log(`[Gallery Sync] stale R2 object deleted: ${normalizedKey}`);
  }

  return deletedCount;
};

export const syncGalleryR2 = async (): Promise<void> => {
  const stats: GallerySyncStats = {
    imagesFound: 0,
    metadataGenerated: 0,
    metadataDeleted: 0,
    uploaded: 0,
    upserted: 0,
    deactivated: 0,
    r2Deleted: 0,
    failed: 0,
  };

  let items: GallerySyncItem[] = [];
  try {
    const allFiles = await walkDirectory(GALLERY_ROOT);
    stats.metadataDeleted = await cleanupOrphanMetadataFiles(allFiles);
    items = await loadSyncItems();
    stats.imagesFound = items.length;
    stats.metadataGenerated = items.filter((item) => item.metadataGenerated).length;
  } catch (error) {
    console.error("[Gallery Sync] failed to scan local gallery directory", error);
    throw error;
  }

  try {
    await r2Service.listObjects(`${R2_PREFIX}/`);
  } catch (error) {
    console.error("[Gallery Sync] R2 configuration or access check failed", error);
    throw error;
  }

  for (const item of items) {
    try {
      await syncItem(item);
      stats.uploaded += 1;
      stats.upserted += 1;
      console.log(`[SYNC GALLERY R2] synced ${item.relativePath}`);
    } catch (error) {
      stats.failed += 1;
      console.error(`[SYNC GALLERY R2] failed ${item.relativePath}`, error);
    }
  }

  const activeSyncSourceIds = items.map((item) => buildSyncSourceId(item.relativePath));
  try {
    stats.deactivated = await galleryRepository.deactivateCardsMissingFromSyncSource(activeSyncSourceIds);
  } catch (error) {
    stats.failed += 1;
    console.error("[Gallery Sync] failed to deactivate missing GalleryCard records", error);
  }

  try {
    stats.r2Deleted = await deleteStaleR2Objects(items.map((item) => buildR2Key(item.relativePath)));
  } catch (error) {
    stats.failed += 1;
    console.error("[Gallery Sync] failed to delete stale R2 objects", error);
  }

  console.log(JSON.stringify(stats, null, 2));

  if (stats.failed > 0) {
    throw new Error(`Gallery sync completed with ${stats.failed} failed item(s)`);
  }
};

syncGalleryR2()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
