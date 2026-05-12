import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { galleryVisionMetadataService } from "../services/gallery-vision-metadata.service";
import { type GalleryImageMetadata, LOCAL_GALLERY_SOURCE_PREFIX } from "../utils/gallery-metadata";

const GALLERY_ROOT = path.resolve(process.cwd(), "data", "gallery-images");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

type AnalyzeStats = {
  success: number;
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

const main = async (): Promise<void> => {
  const force = process.argv.includes("--force");
  const dryRun = process.argv.includes("--dry-run");
  const stats: AnalyzeStats = { success: 0, skipped: 0, failed: 0 };
  const files = await walkDirectory(GALLERY_ROOT);
  const imageFiles = files.filter((filePath) => IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase()));

  for (const imagePath of imageFiles) {
    const metadataPath = imagePath.replace(path.extname(imagePath), ".json");
    const relativePath = path.relative(GALLERY_ROOT, imagePath);
    const metadataExists = files.includes(metadataPath);

    if (metadataExists && !force) {
      stats.skipped += 1;
      console.log(`[Gallery Analyze] skipped ${normalizeRelativePath(relativePath)} (metadata exists)`);
      continue;
    }

    try {
      const metadata = await galleryVisionMetadataService.analyzeImage(imagePath, buildSyncSourceId(relativePath));
      if (dryRun) {
        console.log(`[Gallery Analyze] dry-run ${normalizeRelativePath(relativePath)}`);
        console.log(JSON.stringify(metadata, null, 2));
      } else {
        await writeMetadataFile(metadataPath, metadata);
        console.log(`[Gallery Analyze] generated ${normalizeRelativePath(relativePath)}`);
      }
      stats.success += 1;
    } catch (error) {
      stats.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Gallery Analyze] failed ${normalizeRelativePath(relativePath)} ${message}`);
    }
  }

  console.log(JSON.stringify(stats, null, 2));
};

main().catch((error) => {
  console.error("[Gallery Analyze] fatal error", error);
  process.exit(1);
});
