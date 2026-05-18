import { access, readFile } from "node:fs/promises";
import path from "node:path";

type FileCheck = {
  label: string;
  relativePath: string;
};

type TermAudit = {
  term: string;
  count: number;
  files: string[];
};

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, "src");
const DOCS_ROOT = path.join(ROOT, "docs");

const KEY_FILES: FileCheck[] = [
  { label: "Discord Bot", relativePath: "src/bot/discord.bot.ts" },
  { label: "Hermes Router", relativePath: "src/hermes/router.ts" },
  { label: "Hermes Orchestrator", relativePath: "src/hermes/orchestrator.ts" },
  { label: "Gallery Agent", relativePath: "src/agents/gallery/gallery.agent.ts" },
  { label: "Gallery Search Skill", relativePath: "src/skills/gallery/search-gallery.skill.ts" },
  { label: "Gallery Refresh Skill", relativePath: "src/skills/gallery/refresh-gallery.skill.ts" },
  { label: "Gallery Select Skill", relativePath: "src/skills/gallery/select-card.skill.ts" },
  { label: "Checkout Skill", relativePath: "src/skills/gallery/create-checkout-link.skill.ts" },
  { label: "Gallery Service", relativePath: "src/services/gallery.service.ts" },
  { label: "Query Parser", relativePath: "src/services/llm-query-parser.service.ts" },
  { label: "Recommendation Service", relativePath: "src/services/gallery-recommendation.service.ts" },
  { label: "Feedback Service", relativePath: "src/services/recommendation-feedback.service.ts" },
  { label: "Analytics Service", relativePath: "src/services/recommendation-analytics.service.ts" },
  { label: "Shopify Service", relativePath: "src/services/shopify.service.ts" },
  { label: "Webhook Service", relativePath: "src/services/shopify-webhook.service.ts" },
  { label: "R2 Service", relativePath: "src/services/r2.service.ts" },
  { label: "Gallery Repository", relativePath: "src/repositories/gallery.repository.ts" },
  { label: "Session Repository", relativePath: "src/repositories/gallery-search-session.repository.ts" },
  { label: "Schema", relativePath: "prisma/schema.prisma" },
];

const TERM_PATTERNS = [
  "usedFallback",
  "recommendationRecovery",
  "rerank",
  "curatorNarration",
  "feedbackAnalytics",
] as const;

const CHECKLISTS: Array<{ label: string; patterns: string[] }> = [
  {
    label: "Hermes Architecture",
    patterns: ["HermesRouter", "HermesOrchestrator", "GalleryAgent", "buildHermesRegistry"],
  },
  {
    label: "Gallery Search",
    patterns: ["searchGalleryCards", "parseGalleryQuery", "refreshGalleryCards", "galleryRepository.search"],
  },
  {
    label: "Card Intelligence",
    patterns: ["metadata.intelligence", "visualLayer", "emotionalLayer", "characterLayer", "worldbuildingLayer", "commerceLayer"],
  },
  {
    label: "User Intent Intelligence",
    patterns: ["intelligenceQuery", "visualStyle", "moodTags", "characterTypes", "colorHints", "rarityHints"],
  },
  {
    label: "Recommendation",
    patterns: ["rerank(", "recommendationScore", "usedFallback", "rerankHappened", "buildReasons"],
  },
  {
    label: "Presentation",
    patterns: ["buildGalleryLargeImageFeedEmbeds", "setImage(", "curatorNarration", "summaryText", "shareImageUrl"],
  },
  {
    label: "Commerce",
    patterns: ["createPendingOrder", "createProductFromGalleryCard", "checkout_created", "handleOrdersPaidWebhook"],
  },
  {
    label: "Analytics / Feedback",
    patterns: ["recordSearch", "recordSelection", "recordCheckoutCreated", "recordPurchaseCompleted", "generateReport"],
  },
  {
    label: "Infrastructure",
    patterns: ["sync-gallery-r2", "R2_", "DATABASE_URL", "railway"],
  },
];

const normalizeSlashes = (value: string): string => value.replace(/\\/g, "/");
const SELF_PATH = normalizeSlashes(path.relative(ROOT, __filename));

const readText = async (relativePath: string): Promise<string> => {
  const fullPath = path.join(ROOT, relativePath);
  return readFile(fullPath, "utf8");
};

const fileExists = async (relativePath: string): Promise<boolean> => {
  try {
    await access(path.join(ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
};

const listTsFiles = async (dirPath: string): Promise<string[]> => {
  const { readdir } = await import("node:fs/promises");
  const results: string[] = [];

  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".md") || entry.name.endsWith(".prisma"))) {
        results.push(fullPath);
      }
    }
  };

  await walk(dirPath);
  return results;
};

const countTermMatches = async (files: string[], term: string): Promise<TermAudit> => {
  let count = 0;
  const matchedFiles: string[] = [];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const matches = content.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"));
    if (!matches || matches.length === 0) {
      continue;
    }
    count += matches.length;
    matchedFiles.push(normalizeSlashes(path.relative(ROOT, file)));
  }

  return {
    term,
    count,
    files: matchedFiles,
  };
};

const detectPattern = async (pattern: string): Promise<boolean> => {
  const files = [...(await listTsFiles(SRC_ROOT)), ...(await listTsFiles(DOCS_ROOT)), path.join(ROOT, "README.md")];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    if (content.includes(pattern)) {
      return true;
    }
  }

  return false;
};

const main = async (): Promise<void> => {
  console.log("# LootCardChoose V1 Capability Audit");
  console.log("");

  console.log("## Key File Presence");
  for (const file of KEY_FILES) {
    const exists = await fileExists(file.relativePath);
    console.log(`- [${exists ? "x" : " "}] ${file.label}: ${file.relativePath}`);
  }
  console.log("");

  console.log("## Capability Checklist");
  for (const checklist of CHECKLISTS) {
    const found = [];
    const missing = [];

    for (const pattern of checklist.patterns) {
      if (await detectPattern(pattern)) {
        found.push(pattern);
      } else {
        missing.push(pattern);
      }
    }

    console.log(`- ${checklist.label}: found ${found.length}/${checklist.patterns.length}`);
    if (found.length > 0) {
      console.log(`  found: ${found.join(", ")}`);
    }
    if (missing.length > 0) {
      console.log(`  missing: ${missing.join(", ")}`);
    }
  }
  console.log("");

  const auditFiles = (await listTsFiles(SRC_ROOT)).filter(
    (file) => normalizeSlashes(path.relative(ROOT, file)) !== SELF_PATH
  );
  console.log("## Naming Audit");
  for (const term of TERM_PATTERNS) {
    const result = await countTermMatches(auditFiles, term);
    console.log(`- ${result.term}: ${result.count} occurrence(s)`);
    if (result.files.length > 0) {
      console.log(`  files: ${result.files.join(", ")}`);
    }
  }
  console.log("");

  console.log("## Risk Heuristics");
  console.log("- `usedFallback` present means recovery semantics already exist and should not be renamed casually.");
  console.log("- Missing `recommendationRecovery` as a canonical code term suggests recovery is implemented implicitly, not as a standalone module.");
  console.log("- Heavy `rerank` usage indicates recommendation logic is already consolidated around current V1 service boundaries.");
  console.log("- `curatorNarration` presence confirms narration is a distinct presentation capability and should not be merged into analytics semantics.");
  console.log("- Sparse or missing `feedbackAnalytics` naming suggests analytics naming is split across recommendation feedback and recommendation analytics modules.");
};

void main().catch((error) => {
  console.error("[AUDIT V1 CAPABILITIES] failed", error);
  process.exit(1);
});
