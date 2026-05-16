import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type {
  GalleryCommerceNaming,
  GalleryMetadataIntelligence,
} from "../types/gallery-intelligence.types";
import type { GalleryImageMetadata } from "../utils/gallery-metadata";

const GALLERY_ROOT = path.resolve(process.cwd(), "data", "gallery-images");
const DEFAULT_LIMIT = 20;
const BRAND_PATTERNS = [/\blootcard\b/i, /\blootcardchoose\b/i, /\bmcdonald'?s\b/i, /\bshopify\b/i, /\bpatreon\b/i];
const HIGH_RISK_BRAND_PATTERNS = [/\bmcdonald'?s\b/i, /\bnike\b/i, /\bdisney\b/i, /\bmarvel\b/i];
const NSFW_PATTERNS = [
  /\bnsfw\b/i,
  /\badult\b/i,
  /\berotic\b/i,
  /\bseductive\b/i,
  /\bseductress\b/i,
  /\bbra\b/i,
  /\bhentai\b/i,
  /\bexplicit\b/i,
  /\blingerie\b/i,
];
const HIGH_RISK_NSFW_PATTERNS = [
  /\badult\b/i,
  /\berotic\b/i,
  /\bseductive\b/i,
  /\bseductress\b/i,
  /\bbra\b/i,
  /\bhentai\b/i,
];
const MECHANICAL_PATTERNS = [/featuring a .+ in a .+ setting/i, /auto generated metadata/i];

type CliOptions = {
  limit: number;
  json: boolean;
};

type RiskLevel = "high" | "medium" | "low";

type ReviewEntry = {
  file: string;
  riskScore: number;
  riskLevel: RiskLevel;
  title: string | null;
  description: string | null;
  tagsPreview: string[];
  safetyFlags: string[];
  reasons: string[];
};

type Summary = {
  scanned: number;
  parsed: number;
  failed: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
};

type Report = {
  summary: Summary;
  topReviewList: ReviewEntry[];
};

type MetadataContainer = Record<string, unknown> & {
  intelligence?: GalleryMetadataIntelligence;
  commerceNaming?: GalleryCommerceNaming;
};

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseArgs = (): CliOptions => {
  const limitIndex = process.argv.indexOf("--limit");
  const rawLimit = limitIndex >= 0 ? Number.parseInt(process.argv[limitIndex + 1] ?? "", 10) : DEFAULT_LIMIT;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_LIMIT;
  return {
    limit,
    json: process.argv.includes("--json"),
  };
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

const getMetadataContainer = (metadata: GalleryImageMetadata): MetadataContainer => {
  if (!metadata.metadata || !isPlainObject(metadata.metadata)) {
    return {};
  }
  return metadata.metadata as MetadataContainer;
};

const riskLevelFromScore = (riskScore: number): RiskLevel => {
  if (riskScore >= 70) {
    return "high";
  }
  if (riskScore >= 35) {
    return "medium";
  }
  return "low";
};

const hasPatternMatch = (patterns: RegExp[], value: string): boolean =>
  patterns.some((pattern) => pattern.test(value));

const scoreContent = (
  metadata: GalleryImageMetadata,
  file: string
): ReviewEntry => {
  const reasons: string[] = [];
  let riskScore = 0;

  const title = typeof metadata.title === "string" ? normalizeText(metadata.title) : "";
  const description = typeof metadata.description === "string" ? normalizeText(metadata.description) : "";
  const tags = Array.isArray(metadata.tags) ? metadata.tags.filter((tag): tag is string => typeof tag === "string") : [];
  const character = typeof metadata.character === "string" ? normalizeText(metadata.character) : "";
  const joinedContent = [title, description, character, ...tags].join(" ");
  const metadataContainer = getMetadataContainer(metadata);
  const hasMetadataObject = Boolean(metadata.metadata && isPlainObject(metadata.metadata));
  const intelligence = metadataContainer.intelligence;
  const safetyFlags = Array.isArray(intelligence?.commerceLayer.safetyFlags)
    ? intelligence.commerceLayer.safetyFlags.filter((flag): flag is string => typeof flag === "string")
    : [];
  const hasMissingMetadataStructure = !hasMetadataObject || !intelligence || !isPlainObject(intelligence);
  const hasTopLevelBrandRisk = hasPatternMatch(HIGH_RISK_BRAND_PATTERNS, joinedContent);
  const hasTopLevelNsfwRisk = hasPatternMatch(HIGH_RISK_NSFW_PATTERNS, joinedContent);

  if (!hasMetadataObject) {
    reasons.push("missing metadata object");
    riskScore += 100;
  }

  if (!intelligence || !isPlainObject(intelligence)) {
    reasons.push("missing metadata.intelligence");
    riskScore += 100;
  }

  if (!title) {
    reasons.push("title is empty");
    riskScore += 40;
  } else {
    if (/^\d+$/.test(title)) {
      reasons.push("title is numeric-only");
      riskScore += 40;
    }
    if (title.length < 4) {
      reasons.push("title is too short");
      riskScore += 25;
    }
    if (title.length > 90) {
      reasons.push("title is too long");
      riskScore += 25;
    }
  }

  if (!description) {
    reasons.push("description is empty");
    riskScore += 35;
  }
  if (/auto generated metadata/i.test(description)) {
    reasons.push('description still contains "Auto generated metadata"');
    riskScore += 45;
  }
  if (MECHANICAL_PATTERNS.some((pattern) => pattern.test(description))) {
    reasons.push("description looks mechanical");
    riskScore += 20;
  }

  if (tags.length === 0) {
    reasons.push("tags are empty");
    riskScore += 40;
  }
  if (tags.length > 0 && tags.every((tag) => /^\d+$/.test(normalizeText(tag)))) {
    reasons.push("tags are numeric-only");
    riskScore += 35;
  }

  const normalizedTags = tags.map((tag) => normalizeText(tag).toLowerCase()).filter(Boolean);
  const duplicateCount = normalizedTags.length - new Set(normalizedTags).size;
  if (duplicateCount >= 3) {
    reasons.push("tags contain many duplicates");
    riskScore += 25;
  }

  if (hasPatternMatch(BRAND_PATTERNS, joinedContent)) {
    reasons.push("title/description/tags contain brand terms");
    riskScore += 30;
  }

  if (hasPatternMatch(NSFW_PATTERNS, joinedContent)) {
    reasons.push("title/description/tags contain NSFW-sensitive terms");
    riskScore += 45;
  }

  if (safetyFlags.length > 0) {
    if (!hasTopLevelBrandRisk && !hasTopLevelNsfwRisk) {
      reasons.push("internal safetyFlags only");
      riskScore += 35;
    } else {
      reasons.push("metadata.intelligence.commerceLayer.safetyFlags is non-empty");
      riskScore += 20;
    }
  }

  if (intelligence?.audit.needsHumanReview === true) {
    reasons.push("metadata.intelligence.audit.needsHumanReview is true");
    riskScore += 35;
  }

  if (typeof intelligence?.confidence === "number" && intelligence.confidence < 0.7) {
    reasons.push("metadata.intelligence.confidence < 0.7");
    riskScore += 30;
  }

  if (metadata.price === "0.00" || metadata.price === 0) {
    reasons.push("price is 0.00");
    riskScore += 10;
  }

  if (metadata.rarity === "SSR") {
    reasons.push("rarity is SSR; verify over-assignment risk");
    riskScore += 15;
  }

  if (hasTopLevelBrandRisk) {
    reasons.push("top-level brand term");
    riskScore += 60;
  }

  if (hasTopLevelNsfwRisk) {
    reasons.push("top-level nsfw term");
    riskScore += 60;
  }

  const riskLevel =
    hasMissingMetadataStructure || hasTopLevelBrandRisk || hasTopLevelNsfwRisk
      ? "high"
      : riskScore >= 35
        ? "medium"
        : "low";

  return {
    file,
    riskScore,
    riskLevel,
    title: title || null,
    description: description || null,
    tagsPreview: tags.slice(0, 8),
    safetyFlags,
    reasons,
  };
};

const scoreParseFailure = (file: string, reason: string): ReviewEntry => ({
  file,
  riskScore: 100,
  riskLevel: "high",
  title: null,
  description: null,
  tagsPreview: [],
  safetyFlags: [],
  reasons: [`JSON parse failed: ${reason}`],
});

const printTextReport = (report: Report): void => {
  console.log(JSON.stringify(report.summary, null, 2));
  console.log("[GALLERY METADATA REVIEW] top review list");
  for (const entry of report.topReviewList) {
    console.log(
      JSON.stringify(
        {
          file: entry.file,
          riskScore: entry.riskScore,
          riskLevel: entry.riskLevel,
          title: entry.title,
          description: entry.description,
          tagsPreview: entry.tagsPreview,
          safetyFlags: entry.safetyFlags,
          reasons: entry.reasons,
        },
        null,
        2
      )
    );
  }
};

const main = async (): Promise<void> => {
  const options = parseArgs();
  const files = await walkDirectory(GALLERY_ROOT);
  const jsonFiles = files.filter((filePath) => path.extname(filePath).toLowerCase() === ".json");

  const summary: Summary = {
    scanned: 0,
    parsed: 0,
    failed: 0,
    highRisk: 0,
    mediumRisk: 0,
    lowRisk: 0,
  };
  const reviewEntries: ReviewEntry[] = [];

  for (const filePath of jsonFiles) {
    const file = filePath.replace(`${GALLERY_ROOT}${path.sep}`, "").replace(/\\/g, "/");
    summary.scanned += 1;

    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
      if (!isPlainObject(parsed)) {
        throw new Error("top-level JSON must be an object");
      }

      summary.parsed += 1;
      const entry = scoreContent(parsed as GalleryImageMetadata, file);
      reviewEntries.push(entry);
    } catch (error) {
      summary.failed += 1;
      reviewEntries.push(scoreParseFailure(file, error instanceof Error ? error.message : String(error)));
    }
  }

  for (const entry of reviewEntries) {
    if (entry.riskLevel === "high") {
      summary.highRisk += 1;
    } else if (entry.riskLevel === "medium") {
      summary.mediumRisk += 1;
    } else {
      summary.lowRisk += 1;
    }
  }

  const topReviewList = [...reviewEntries]
    .sort((left, right) => right.riskScore - left.riskScore || left.file.localeCompare(right.file))
    .slice(0, options.limit);

  const report: Report = {
    summary,
    topReviewList,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printTextReport(report);
};

main().catch((error) => {
  console.error("[GALLERY METADATA REVIEW] fatal error", error);
  process.exit(1);
});
