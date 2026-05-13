import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createFilenameFallbackMetadata,
  galleryVisionMetadataService,
} from "../services/gallery-vision-metadata.service";
import { cardNamingService, resolveExistingMarketingTitle } from "../services/card-naming.service";
import { type GalleryImageMetadata, LOCAL_GALLERY_SOURCE_PREFIX } from "../utils/gallery-metadata";

const GALLERY_ROOT = path.resolve(process.cwd(), "data", "gallery-images");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

type AnalyzeStats = {
  aiSuccess: number;
  fallbackWritten: number;
  skipped: number;
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

const normalizeRelativePath = (filePath: string): string => filePath.replace(/\\/g, "/");

const buildSyncSourceId = (relativePath: string): string => `${LOCAL_GALLERY_SOURCE_PREFIX}${normalizeRelativePath(relativePath)}`;

const writeMetadataFile = async (metadataPath: string, metadata: GalleryImageMetadata): Promise<void> => {
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
};

const ensureMetadataMarketingTitle = async (
  metadata: GalleryImageMetadata,
  relativePath: string,
  preservedMarketingTitle?: string | null
): Promise<GalleryImageMetadata> => {
  const existingMarketingTitle = preservedMarketingTitle ?? resolveExistingMarketingTitle(metadata.metadata);
  if (existingMarketingTitle) {
    return {
      ...metadata,
      metadata: {
        ...(metadata.metadata ?? {}),
        marketingTitle: existingMarketingTitle,
      },
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
    ...metadata,
    metadata: {
      ...(metadata.metadata ?? {}),
      marketingTitle: generated.marketingTitle,
    },
  };
};

const main = async (): Promise<void> => {
  const force = process.argv.includes("--force");
  const dryRun = process.argv.includes("--dry-run");
  const stats: AnalyzeStats = { aiSuccess: 0, fallbackWritten: 0, skipped: 0, failed: 0 };
  const files = await walkDirectory(GALLERY_ROOT);
  const imageFiles = files.filter((filePath) => IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase()));

  for (const imagePath of imageFiles) {
    const metadataPath = imagePath.replace(path.extname(imagePath), ".json");
    const relativePath = path.relative(GALLERY_ROOT, imagePath);
    const metadataExists = files.includes(metadataPath);
    let preservedMarketingTitle: string | null = null;

    if (metadataExists) {
      try {
        const existingMetadata = JSON.parse(await readFile(metadataPath, "utf8")) as GalleryImageMetadata;
        preservedMarketingTitle = resolveExistingMarketingTitle(existingMetadata.metadata);
      } catch {
        preservedMarketingTitle = null;
      }
    }

    if (metadataExists && !force) {
      stats.skipped += 1;
      console.log(`[Gallery Analyze] skipped ${normalizeRelativePath(relativePath)} (metadata exists)`);
      continue;
    }

    try {
      console.log(`[GALLERY ANALYZE] analyzing image with vision AI: ${normalizeRelativePath(relativePath)}`);
      const metadata = await galleryVisionMetadataService.analyzeImage(imagePath, buildSyncSourceId(relativePath));
      const enrichedMetadata = await ensureMetadataMarketingTitle(metadata, relativePath, preservedMarketingTitle);
      if (dryRun) {
        console.log(`[GALLERY ANALYZE] dry-run AI result: ${normalizeRelativePath(relativePath)}`);
        console.log(JSON.stringify(enrichedMetadata, null, 2));
      } else {
        await writeMetadataFile(metadataPath, enrichedMetadata);
        console.log(`[GALLERY ANALYZE] wrote json: ${normalizeRelativePath(path.relative(GALLERY_ROOT, metadataPath))}`);
      }
      stats.aiSuccess += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[GALLERY ANALYZE] AI failed ${normalizeRelativePath(relativePath)} ${message}`);

      try {
        const fallback = createFilenameFallbackMetadata(imagePath, buildSyncSourceId(relativePath));
        const enrichedFallback = await ensureMetadataMarketingTitle(fallback, relativePath, preservedMarketingTitle);
        if (dryRun) {
          console.log(`[GALLERY ANALYZE] dry-run fallback result: ${normalizeRelativePath(relativePath)}`);
          console.log(JSON.stringify(enrichedFallback, null, 2));
        } else {
          await writeMetadataFile(metadataPath, enrichedFallback);
          console.log(`[GALLERY ANALYZE] wrote fallback json: ${normalizeRelativePath(path.relative(GALLERY_ROOT, metadataPath))}`);
        }
        stats.fallbackWritten += 1;
      } catch (fallbackError) {
        stats.failed += 1;
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        console.error(`[GALLERY ANALYZE] fallback failed ${normalizeRelativePath(relativePath)} ${fallbackMessage}`);
      }
    }
  }

  console.log(JSON.stringify(stats, null, 2));
};

main().catch((error) => {
  console.error("[Gallery Analyze] fatal error", error);
  process.exit(1);
});
