import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { galleryRepository } from "../repositories/gallery.repository";
import { prisma } from "../services/prisma.service";
import { r2Service } from "../services/r2.service";

const GALLERY_ROOT = path.resolve(process.cwd(), "data", "gallery-images");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const R2_PREFIX = "gallery-images";

type GalleryImageMetadata = {
  title?: string;
  description?: string | null;
  tags?: string[];
  style?: string | null;
  rarity?: string | null;
  category?: string | null;
  character?: string | null;
  color?: string | null;
  price?: string | number | null;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
};

type NormalizedGalleryImageMetadata = {
  title: string;
  description: string | null;
  tags: string[];
  style: string | null;
  rarity: string | null;
  category: string | null;
  character: string | null;
  color: string | null;
  price: string;
  isActive: boolean;
  metadata: Record<string, unknown>;
};

type GallerySyncItem = {
  imagePath: string;
  relativePath: string;
  metadataPath: string | null;
  metadata: GalleryImageMetadata;
};

const slugToTitle = (relativePath: string): string => {
  const basename = path.basename(relativePath, path.extname(relativePath));
  return basename
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

const loadSyncItems = async (): Promise<GallerySyncItem[]> => {
  const files = await walkDirectory(GALLERY_ROOT);
  const imageFiles = files.filter((filePath) => IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase()));

  return Promise.all(
    imageFiles.map(async (imagePath) => {
      const relativePath = path.relative(GALLERY_ROOT, imagePath);
      const sidecarMetadataPath = imagePath.replace(path.extname(imagePath), ".json");
      let metadataPath: string | null = sidecarMetadataPath;
      let metadata: GalleryImageMetadata = {};

      try {
        metadata = await readMetadataFile(sidecarMetadataPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("ENOENT")) {
          throw error;
        }
        metadataPath = null;
      }

      return {
        imagePath,
        relativePath,
        metadataPath,
        metadata,
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
    price: normalizePrice(metadata.price),
    isActive: metadata.isActive ?? true,
    metadata: metadata.metadata ?? {},
  };
};

const buildR2Key = (relativePath: string): string => `${R2_PREFIX}/${relativePath.replace(/\\/g, "/")}`;

const syncItem = async (item: GallerySyncItem): Promise<void> => {
  const normalized = normalizeMetadata(item.relativePath, item.metadata);
  const upload = await r2Service.uploadFile({
    key: buildR2Key(item.relativePath),
    filePath: item.imagePath,
  });

  const syncSourceId = item.relativePath.replace(/\\/g, "/");
  const metadata: Prisma.InputJsonValue = {
    ...normalized.metadata,
    syncSourceId,
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

export const syncGalleryR2 = async (): Promise<void> => {
  const items = await loadSyncItems();
  if (items.length === 0) {
    console.log("[SYNC GALLERY R2] no image files found in data/gallery-images");
    return;
  }

  for (const item of items) {
    await syncItem(item);
    console.log(`[SYNC GALLERY R2] synced ${item.relativePath}`);
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
