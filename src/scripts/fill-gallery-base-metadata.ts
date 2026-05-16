import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { galleryBaseMetadataFillService } from "../services/gallery-base-metadata-fill.service";
import { galleryMetadataAuditService } from "../services/gallery-metadata-audit.service";
import type { GalleryCommerceNaming, GalleryMetadataIntelligence } from "../types/gallery-intelligence.types";
import type { GalleryImageMetadata } from "../utils/gallery-metadata";

const GALLERY_ROOT = path.resolve(process.cwd(), "data", "gallery-images");
const BACKUP_ROOT = path.resolve(process.cwd(), "data", "gallery-image-backups", "base-metadata-fill");

type CliOptions = {
  dryRun: boolean;
  write: boolean;
  force: boolean;
};

type Summary = {
  scanned: number;
  eligible: number;
  updated: number;
  skipped: number;
  failed: number;
};

type Issue = {
  file: string;
  reason: string;
};

type MetadataContainer = Record<string, unknown> & {
  source?: string;
  intelligence?: GalleryMetadataIntelligence;
  commerceNaming?: GalleryCommerceNaming;
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

const parseArgs = (): CliOptions => {
  const write = process.argv.includes("--write");
  const dryRun = process.argv.includes("--dry-run") || !write;
  const force = process.argv.includes("--force");
  return { dryRun, write, force };
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readJsonFile = async (filePath: string): Promise<GalleryImageMetadata> => {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  if (!isPlainObject(parsed)) {
    throw new Error("Top-level JSON must be an object");
  }
  return parsed as GalleryImageMetadata;
};

const getMetadataContainer = (metadata: GalleryImageMetadata): MetadataContainer => {
  const current = metadata.metadata;
  if (current == null) {
    return {};
  }
  if (!isPlainObject(current)) {
    throw new Error('Invalid metadata field "metadata": expected object');
  }
  return current as MetadataContainer;
};

const writeMetadataFile = async (filePath: string, metadata: GalleryImageMetadata): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
};

const buildBackupPath = (timestamp: string, relativePath: string): string =>
  path.join(BACKUP_ROOT, timestamp, relativePath);

const backupFile = async (filePath: string, relativePath: string, timestamp: string): Promise<string> => {
  const backupPath = buildBackupPath(timestamp, relativePath);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await copyFile(filePath, backupPath);
  return backupPath;
};

const auditStructure = (metadata: GalleryImageMetadata) => {
  const metadataContainer = getMetadataContainer(metadata);
  const audit = galleryMetadataAuditService.audit({
    intelligence: metadataContainer.intelligence ?? null,
    commerceNaming: metadataContainer.commerceNaming ?? null,
  });
  return audit;
};

const printPreview = (
  relativePath: string,
  before: GalleryImageMetadata,
  after: GalleryImageMetadata,
  changedFields: string[]
): void => {
  console.log(`[GALLERY BASE METADATA FILL] preview ${relativePath}`);
  console.log(
    JSON.stringify(
      {
        changedFields,
        before: {
          title: before.title ?? null,
          description: before.description ?? null,
          tags: before.tags ?? [],
          style: before.style ?? null,
          character: before.character ?? null,
          color: before.color ?? null,
          rarity: before.rarity ?? null,
          category: before.category ?? null,
        },
        after: {
          title: after.title ?? null,
          description: after.description ?? null,
          tags: after.tags ?? [],
          style: after.style ?? null,
          character: after.character ?? null,
          color: after.color ?? null,
          rarity: after.rarity ?? null,
          category: after.category ?? null,
        },
      },
      null,
      2
    )
  );
};

const main = async (): Promise<void> => {
  const options = parseArgs();
  const files = await walkDirectory(GALLERY_ROOT);
  const jsonFiles = files.filter((filePath) => path.extname(filePath).toLowerCase() === ".json");
  const summary: Summary = { scanned: 0, eligible: 0, updated: 0, skipped: 0, failed: 0 };
  const issues: Issue[] = [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  for (const filePath of jsonFiles) {
    const relativePath = normalizeRelativePath(path.relative(GALLERY_ROOT, filePath));
    summary.scanned += 1;

    let metadata: GalleryImageMetadata;
    try {
      metadata = await readJsonFile(filePath);
    } catch (error) {
      summary.failed += 1;
      issues.push({
        file: relativePath,
        reason: `failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    try {
      const audit = auditStructure(metadata);
      if (audit.needsHumanReview) {
        summary.skipped += 1;
        issues.push({
          file: relativePath,
          reason: `audit did not pass: ${[...audit.missingFields, ...audit.lowConfidenceFields, ...audit.formatIssues]
            .filter(Boolean)
            .join("; ")}`,
        });
        continue;
      }

      const fill = galleryBaseMetadataFillService.buildFilledMetadata({
        filePath: relativePath,
        metadata,
        audit,
        force: options.force,
      });

      if (!fill.eligible) {
        summary.skipped += 1;
        issues.push({ file: relativePath, reason: fill.reasons.join("; ") || "non fallback-like metadata" });
        continue;
      }

      summary.eligible += 1;
      galleryBaseMetadataFillService.assertSafeStructure(metadata, fill.next);

      if (fill.changedFields.length === 0) {
        summary.skipped += 1;
        continue;
      }

      if (options.dryRun) {
        printPreview(relativePath, metadata, fill.next, fill.changedFields);
        summary.updated += 1;
        continue;
      }

      const backupPath = await backupFile(filePath, relativePath, timestamp);
      await writeMetadataFile(filePath, fill.next);
      summary.updated += 1;
      console.log(`[GALLERY BASE METADATA FILL] wrote ${relativePath} backup=${normalizeRelativePath(path.relative(process.cwd(), backupPath))}`);
    } catch (error) {
      summary.failed += 1;
      issues.push({
        file: relativePath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  if (issues.length > 0) {
    console.log("[GALLERY BASE METADATA FILL] issues");
    for (const issue of issues) {
      console.log(`- ${issue.file}: ${issue.reason}`);
    }
  }
};

main().catch((error) => {
  console.error("[GALLERY BASE METADATA FILL] fatal error", error);
  process.exit(1);
});
