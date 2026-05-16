import dotenv from "dotenv";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { RecommendationAnalyticsCliOptions, RecommendationAnalyticsReport } from "../types/recommendation-analytics.types";
import { recommendationAnalyticsService } from "../services/recommendation-analytics.service";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const DEFAULT_FILE = path.join(process.cwd(), "reports", "recommendation-feedback.jsonl");

const parseArgs = (argv: string[]): RecommendationAnalyticsCliOptions => {
  let json = false;
  let file: string | null = null;
  let date: string | null = null;
  let outputPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--file") {
      file = argv[index + 1] ?? null;
      if (file) {
        index += 1;
      }
      continue;
    }
    if (arg === "--date") {
      date = argv[index + 1] ?? null;
      if (date) {
        index += 1;
      }
      continue;
    }
    if (arg === "--output") {
      outputPath = argv[index + 1] ?? null;
      if (outputPath) {
        index += 1;
      }
    }
  }

  return {
    json,
    file,
    date,
    outputPath,
  };
};

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const renderBuckets = (
  items: Array<{
    bucket: string;
    impressions: number;
    selections: number;
    checkoutCreated: number;
    purchases: number;
    selectionRate: number;
    checkoutRate: number;
    purchaseRate: number;
  }>
): string[] => {
  if (items.length === 0) {
    return ["- none"];
  }

  return items.map(
    (item) =>
      `- ${item.bucket}: impressions=${item.impressions}, selections=${item.selections}, checkout_created=${item.checkoutCreated}, purchases=${item.purchases}, selection_rate=${formatPercent(item.selectionRate)}, checkout_rate=${formatPercent(item.checkoutRate)}, purchase_rate=${formatPercent(item.purchaseRate)}`
  );
};

const renderReport = (report: RecommendationAnalyticsReport): string => {
  const lines: string[] = [];

  lines.push("# Recommendation Analytics Report");
  lines.push("");
  lines.push("## Summary");
  lines.push(`- date: ${report.summary.dateKey}`);
  lines.push(`- timezone: ${report.summary.timezone}`);
  lines.push(`- source file: ${report.summary.sourceFile}`);
  lines.push(`- source window start: ${report.summary.sourceWindowStart ?? "null"}`);
  lines.push(`- source window end: ${report.summary.sourceWindowEnd ?? "null"}`);
  lines.push(`- parsed lines: ${report.summary.parsedLineCount}`);
  lines.push(`- invalid lines: ${report.summary.invalidLineCount}`);
  lines.push("");
  lines.push("## Purchase Funnel");
  lines.push(`- impressions: ${report.funnel.impressions}`);
  lines.push(`- selections: ${report.funnel.selections}`);
  lines.push(`- checkout_created: ${report.funnel.checkoutCreated}`);
  lines.push(`- purchases: ${report.funnel.purchases}`);
  lines.push(`- selection_rate: ${formatPercent(report.funnel.selectionRate)}`);
  lines.push(`- checkout_rate: ${formatPercent(report.funnel.checkoutRate)}`);
  lines.push(`- purchase_rate: ${formatPercent(report.funnel.purchaseRate)}`);
  lines.push("");
  lines.push("## Top Converting Styles");
  lines.push(...renderBuckets(report.topConvertingStyles));
  lines.push("");
  lines.push("## Top Purchased Metadata");
  lines.push("Rarity:");
  lines.push(...renderBuckets(report.topPurchasedMetadata.rarity));
  lines.push("Style:");
  lines.push(...renderBuckets(report.topPurchasedMetadata.style));
  lines.push("Character:");
  lines.push(...renderBuckets(report.topPurchasedMetadata.character));
  lines.push("Color:");
  lines.push(...renderBuckets(report.topPurchasedMetadata.color));
  lines.push("Title:");
  lines.push(...renderBuckets(report.topPurchasedMetadata.title));
  lines.push("PriceTier:");
  lines.push(...renderBuckets(report.topPurchasedMetadata.priceTier));
  lines.push("");
  lines.push("## Checkout Dropoff");
  if (report.checkoutDropoff.length === 0) {
    lines.push("- none");
  } else {
    for (const item of report.checkoutDropoff) {
      lines.push(
        `- ${item.title}: checkout_created=${item.checkoutCreated}, purchases=${item.purchases}, dropoff_count=${item.dropoffCount}, dropoff_rate=${formatPercent(item.dropoffRate)}`
      );
    }
  }
  lines.push("");
  lines.push("## Low Performing Recommendations");
  if (report.lowPerformingRecommendations.length === 0) {
    lines.push("- none");
  } else {
    for (const item of report.lowPerformingRecommendations) {
      lines.push(
        `- ${item.title}: impressions=${item.impressions}, selections=${item.selections}, checkout_created=${item.checkoutCreated}, purchases=${item.purchases}, selection_rate=${formatPercent(item.selectionRate)}, checkout_rate=${formatPercent(item.checkoutRate)}, purchase_rate=${formatPercent(item.purchaseRate)}`
      );
    }
  }

  return lines.join("\n");
};

const maybeWriteOutput = async (outputPath: string | null, content: string): Promise<void> => {
  if (!outputPath) {
    return;
  }
  await writeFile(outputPath, content, "utf8");
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  const report = await recommendationAnalyticsService.generateAndPersistReport({
    file: options.file,
    date: options.date,
  });

  if (!report) {
    const message = {
      file: options.file ?? DEFAULT_FILE,
      message: "No recommendation feedback JSONL file found. Generate feedback events before running analytics.",
    };
    if (options.json) {
      const content = JSON.stringify(message, null, 2);
      await maybeWriteOutput(options.outputPath, content);
      console.log(content);
      return;
    }
    const content = `# Recommendation Analytics Report\n\n- file: ${message.file}\n- message: ${message.message}`;
    await maybeWriteOutput(options.outputPath, content);
    console.log(content);
    return;
  }

  const output = options.json ? JSON.stringify(report, null, 2) : renderReport(report);
  await maybeWriteOutput(options.outputPath, output);
  console.log(output);
};

main().catch((error) => {
  console.error("[GENERATE RECOMMENDATION REPORT] failed", error);
  process.exit(1);
});
