import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const GALLERY_ROOT = path.resolve(process.cwd(), "data", "gallery-images");
const BATCH_ONE_SIZE = 25;
const REQUIRED_ARRAY_FIELDS = [
  ["visualLayer", "visualStyle"],
  ["visualLayer", "colorPalette"],
  ["visualLayer", "artStyle"],
  ["emotionalLayer", "mood"],
  ["emotionalLayer", "atmosphere"],
  ["characterLayer", "characterType"],
  ["characterLayer", "roleArchetype"],
  ["worldbuildingLayer", "universe"],
  ["worldbuildingLayer", "theme"],
  ["worldbuildingLayer", "faction"],
] as const;
const SCORE_FIELDS = ["collectorScore", "waifuScore", "battleScore"] as const;
const VALID_PRICING_TIERS = new Set(["budget", "standard", "premium", "collector"]);

type DriftCandidate = {
  file: string;
  title: string;
  issueCount: number;
  issues: string[];
};

type DistributionEntry = {
  value: string;
  count: number;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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

const increment = (map: Map<string, number>, key: string): void => {
  map.set(key, (map.get(key) ?? 0) + 1);
};

const toDistribution = (map: Map<string, number>): DistributionEntry[] =>
  [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));

const main = async (): Promise<void> => {
  const files = (await walkDirectory(GALLERY_ROOT))
    .filter((filePath) => path.extname(filePath).toLowerCase() === ".json")
    .sort((left, right) => left.localeCompare(right));

  const issueCounts = new Map<string, number>();
  const candidates: DriftCandidate[] = [];

  for (const filePath of files) {
    const relativePath = path.relative(GALLERY_ROOT, filePath).replace(/\\/g, "/");
    const raw = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    const title = typeof raw.title === "string" ? raw.title : relativePath;
    const metadata = isPlainObject(raw.metadata) ? raw.metadata : null;
    const intelligence = metadata && isPlainObject(metadata.intelligence) ? metadata.intelligence : null;

    if (!intelligence) {
      continue;
    }

    const issues: string[] = [];

    for (const [layer, field] of REQUIRED_ARRAY_FIELDS) {
      const container = isPlainObject(intelligence[layer]) ? intelligence[layer] : null;
      const value = container?.[field];
      if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
        const issue = `invalid_array:${field}`;
        issues.push(issue);
        increment(issueCounts, issue);
      }
    }

    const commerceLayer = isPlainObject(intelligence.commerceLayer) ? intelligence.commerceLayer : null;
    const pricingTier = commerceLayer?.pricingTier;
    if (!VALID_PRICING_TIERS.has(String(pricingTier ?? ""))) {
      const issue = "invalid_pricingTier";
      issues.push(issue);
      increment(issueCounts, issue);
    }

    for (const field of SCORE_FIELDS) {
      const value = commerceLayer?.[field];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        const issue = `invalid_score:${field}`;
        issues.push(issue);
        increment(issueCounts, issue);
      }
    }

    if (issues.length > 0) {
      candidates.push({
        file: relativePath,
        title,
        issueCount: issues.length,
        issues,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        totalSourceFiles: files.length,
        invalidSourceFiles: candidates.length,
        issueSummary: toDistribution(issueCounts),
        batchOneCandidates: candidates.slice(0, BATCH_ONE_SIZE),
      },
      null,
      2
    )
  );
};

main().catch((error) => {
  console.error("[GALLERY SOURCE INTELLIGENCE AUDIT] fatal error", error);
  process.exit(1);
});
