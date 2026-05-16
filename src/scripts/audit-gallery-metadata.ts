import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { galleryIntelligenceService } from "../services/gallery-intelligence.service";
import { galleryMetadataAuditService } from "../services/gallery-metadata-audit.service";
import type {
  GalleryCommerceNaming,
  GalleryMetadataAuditResult,
  GalleryMetadataIntelligence,
} from "../types/gallery-intelligence.types";
import type { GalleryImageMetadata } from "../utils/gallery-metadata";

const GALLERY_ROOT = path.resolve(process.cwd(), "data", "gallery-images");
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

type Mode = "audit" | "enrich";

type CliOptions = {
  mode: Mode;
  dryRun: boolean;
  force: boolean;
};

type Summary = {
  scanned: number;
  enriched: number;
  skipped: number;
  needsHumanReview: number;
  failed: number;
};

type AuditIssue = {
  file: string;
  reason: string;
};

type MetadataContainer = Record<string, unknown> & {
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
  const modeIndex = process.argv.indexOf("--mode");
  const rawMode = modeIndex >= 0 ? process.argv[modeIndex + 1] : null;
  if (rawMode !== "audit" && rawMode !== "enrich") {
    throw new Error('Missing or invalid "--mode audit|enrich"');
  }

  return {
    mode: rawMode,
    dryRun: process.argv.includes("--dry-run"),
    force: process.argv.includes("--force"),
  };
};

const readJsonFile = async (filePath: string): Promise<unknown> => JSON.parse(await readFile(filePath, "utf8")) as unknown;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getMetadataContainer = (metadata: GalleryImageMetadata): MetadataContainer => {
  const current = metadata.metadata;
  if (current == null) {
    return {};
  }
  if (!galleryIntelligenceService.isMetadataObject(current)) {
    throw new Error('Invalid metadata field "metadata": expected object');
  }
  return current as MetadataContainer;
};

const findImagePath = async (jsonPath: string): Promise<string> => {
  for (const extension of IMAGE_EXTENSIONS) {
    const candidate = jsonPath.replace(/\.json$/i, extension);
    try {
      await readFile(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  throw new Error("Missing sibling image file");
};

const writeMetadataFile = async (metadataPath: string, metadata: GalleryImageMetadata): Promise<void> => {
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
};

const auditExistingMetadata = (metadata: GalleryImageMetadata): GalleryMetadataAuditResult => {
  const metadataContainer = getMetadataContainer(metadata);
  const intelligence = metadataContainer.intelligence ?? null;
  const commerceNaming = metadataContainer.commerceNaming ?? null;
  return galleryMetadataAuditService.audit({ intelligence, commerceNaming });
};

const mergeEnrichment = (
  metadata: GalleryImageMetadata,
  intelligence: GalleryMetadataIntelligence,
  commerceNaming: GalleryCommerceNaming,
  options: {
    writeIntelligence: boolean;
    writeCommerceNaming: boolean;
  }
): { next: GalleryImageMetadata; updated: boolean } => {
  const currentContainer = getMetadataContainer(metadata);

  const nextContainer: MetadataContainer = {
    ...currentContainer,
    ...(options.writeIntelligence ? { intelligence } : {}),
    ...(options.writeCommerceNaming ? { commerceNaming } : {}),
  };

  return {
    next: {
      ...metadata,
      metadata: nextContainer,
    },
    updated: options.writeIntelligence || options.writeCommerceNaming,
  };
};

const printCandidate = (relativePath: string, intelligence: GalleryMetadataIntelligence, commerceNaming: GalleryCommerceNaming): void => {
  console.log(`[GALLERY METADATA ENRICH] candidate ${relativePath}`);
  console.log(
    JSON.stringify(
      {
        metadata: {
          intelligence,
          commerceNaming,
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
  const summary: Summary = { scanned: 0, enriched: 0, skipped: 0, needsHumanReview: 0, failed: 0 };
  const issues: AuditIssue[] = [];

  for (const jsonPath of jsonFiles) {
    const relativePath = normalizeRelativePath(path.relative(GALLERY_ROOT, jsonPath));
    summary.scanned += 1;

    let parsed: GalleryImageMetadata;
    try {
      const raw = await readJsonFile(jsonPath);
      if (!isPlainObject(raw)) {
        throw new Error("Top-level JSON must be an object");
      }
      parsed = raw as GalleryImageMetadata;
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      issues.push({ file: relativePath, reason: `failed to parse JSON: ${message}` });
      console.error(`[GALLERY METADATA ${options.mode.toUpperCase()}] failed ${relativePath} ${message}`);
      continue;
    }

    if (options.mode === "audit") {
      try {
        const audit = auditExistingMetadata(parsed);
        if (audit.needsHumanReview) {
          summary.needsHumanReview += 1;
          issues.push({
            file: relativePath,
            reason: [
              ...audit.missingFields,
              ...audit.lowConfidenceFields,
              ...audit.invalidTags,
              ...audit.formatIssues,
            ]
              .filter(Boolean)
              .join("; "),
          });
        }
      } catch (error) {
        summary.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        issues.push({ file: relativePath, reason: `audit failed: ${message}` });
        console.error(`[GALLERY METADATA AUDIT] failed ${relativePath} ${message}`);
      }
      continue;
    }

    try {
      const currentContainer = getMetadataContainer(parsed);
      const shouldWriteIntelligence = options.force || currentContainer.intelligence == null;
      const shouldWriteCommerceNaming = options.force || currentContainer.commerceNaming == null;

      if (!shouldWriteIntelligence && !shouldWriteCommerceNaming) {
        summary.skipped += 1;
        continue;
      }

      const imagePath = await findImagePath(jsonPath);
      const candidates = await galleryIntelligenceService.buildCandidates({
        imagePath,
        relativePath,
        metadata: parsed,
      });

      const preAuditMerged = mergeEnrichment(parsed, candidates.intelligence, candidates.commerceNaming, {
        writeIntelligence: shouldWriteIntelligence,
        writeCommerceNaming: shouldWriteCommerceNaming,
      });
      const mergedContainer = getMetadataContainer(preAuditMerged.next);
      const audit = galleryMetadataAuditService.audit({
        intelligence: mergedContainer.intelligence ?? null,
        commerceNaming: mergedContainer.commerceNaming ?? null,
      });

      const auditedMerge = mergeEnrichment(preAuditMerged.next, audit.intelligence, candidates.commerceNaming, {
        writeIntelligence: shouldWriteIntelligence,
        writeCommerceNaming: shouldWriteCommerceNaming,
      });

      if (audit.needsHumanReview) {
        summary.needsHumanReview += 1;
        issues.push({
          file: relativePath,
          reason: [
            ...audit.missingFields,
            ...audit.lowConfidenceFields,
            ...audit.invalidTags,
            ...audit.formatIssues,
          ]
            .filter(Boolean)
            .join("; "),
        });
      }

      if (options.dryRun) {
        printCandidate(relativePath, audit.intelligence, candidates.commerceNaming);
        summary.enriched += 1;
        continue;
      }

      await writeMetadataFile(jsonPath, auditedMerge.next);
      summary.enriched += 1;
      console.log(`[GALLERY METADATA ENRICH] wrote ${relativePath}`);
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      issues.push({ file: relativePath, reason: `enrich failed: ${message}` });
      console.error(`[GALLERY METADATA ENRICH] failed ${relativePath} ${message}`);
    }
  }

  console.log(JSON.stringify(summary, null, 2));

  if (issues.length > 0) {
    console.log("[GALLERY METADATA SUMMARY] issues");
    for (const issue of issues) {
      console.log(`- ${issue.file}: ${issue.reason}`);
    }
  }
};

main().catch((error) => {
  console.error("[GALLERY METADATA] fatal error", error);
  process.exit(1);
});
