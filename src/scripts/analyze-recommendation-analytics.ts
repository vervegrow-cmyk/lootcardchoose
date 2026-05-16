import dotenv from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  RecommendationAnalyticsRateMetric,
  RecommendationAnalyticsReport,
} from "../types/recommendation-analytics.types";
import { recommendationAnalyticsService } from "../services/recommendation-analytics.service";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

type CliOptions = {
  file: string | null;
  date: string | null;
};

const parseArgs = (argv: string[]): CliOptions => {
  let file: string | null = null;
  let date: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file") {
      file = argv[index + 1] ?? null;
      if (file) index += 1;
      continue;
    }
    if (arg === "--date") {
      date = argv[index + 1] ?? null;
      if (date) index += 1;
    }
  }

  return { file, date };
};

const formatPercent = (value: number | null): string => (value == null ? "null" : `${(value * 100).toFixed(1)}%`);

const renderRateMetric = (label: string, metric: RecommendationAnalyticsRateMetric): string =>
  `- ${label}: numerator=${metric.numerator}, denominator=${metric.denominator}, rate=${formatPercent(metric.rate)}, insufficientData=${metric.insufficientData}`;

const renderReport = (report: RecommendationAnalyticsReport): string => {
  const lines: string[] = [];

  lines.push("# Recommendation Analytics Report");
  lines.push("");
  lines.push("## Summary");
  lines.push(`- date: ${report.summary.dateKey}`);
  lines.push(`- source file: ${report.summary.sourceFile}`);
  lines.push(`- parsed lines: ${report.summary.parsedLineCount}`);
  lines.push(`- invalid lines: ${report.summary.invalidLineCount}`);
  lines.push("");
  lines.push("## Selection Analytics");
  lines.push(`- totalSelections: ${report.selectionAnalytics.totalSelections}`);
  lines.push(`- rankedSelections: ${report.selectionAnalytics.rankedSelections}`);
  lines.push(renderRateMetric("top1SelectionRate", report.selectionAnalytics.top1SelectionRate));
  lines.push(renderRateMetric("top3SelectionRate", report.selectionAnalytics.top3SelectionRate));
  lines.push(renderRateMetric("top5SelectionRate", report.selectionAnalytics.top5SelectionRate));
  lines.push("");
  lines.push("## Conversion Analytics");
  lines.push(`- searchCount: ${report.conversionAnalytics.searchCount}`);
  lines.push(`- selectionCount: ${report.conversionAnalytics.selectionCount}`);
  lines.push(`- checkoutCreatedCount: ${report.conversionAnalytics.checkoutCreatedCount}`);
  lines.push(`- paidCount: ${report.conversionAnalytics.paidCount}`);
  lines.push(renderRateMetric("searchToSelect", report.conversionAnalytics.searchToSelect));
  lines.push(renderRateMetric("selectToCheckout", report.conversionAnalytics.selectToCheckout));
  lines.push(renderRateMetric("checkoutToPaid", report.conversionAnalytics.checkoutToPaid));
  lines.push("");
  lines.push("## Weak Match Analytics");
  if (report.weakMatchAnalytics.queries.length === 0) {
    lines.push("- queries: none");
  } else {
    for (const item of report.weakMatchAnalytics.queries.slice(0, 5)) {
      lines.push(
        `- query=${item.bucket}, searches=${item.searchCount}, selections=${item.selectionCount}, checkouts=${item.checkoutCount}, paid=${item.paidCount}, top1Miss=${item.top1MissCount}, top3Miss=${item.top3MissCount}, observation=${item.observation}`
      );
    }
  }
  if (report.weakMatchAnalytics.archetypes.length === 0) {
    lines.push("- archetypes: none");
  } else {
    for (const item of report.weakMatchAnalytics.archetypes.slice(0, 5)) {
      lines.push(
        `- archetype=${item.bucket}, searches=${item.searchCount}, selections=${item.selectionCount}, checkouts=${item.checkoutCount}, paid=${item.paidCount}, top1Miss=${item.top1MissCount}, top3Miss=${item.top3MissCount}, observation=${item.observation}`
      );
    }
  }
  lines.push("");
  lines.push("## Metadata Coverage Analytics");
  lines.push(`- totalActiveCards: ${report.metadataCoverageAnalytics.totalActiveCards}`);
  lines.push(`- cardsWithAnyIntelligence: ${report.metadataCoverageAnalytics.cardsWithAnyIntelligence}`);
  for (const field of report.metadataCoverageAnalytics.fieldCoverage) {
    lines.push(
      `- field=${field.field}, cardsWithField=${field.cardsWithField}, totalActiveCards=${field.totalActiveCards}, coverageRate=${formatPercent(field.coverageRate)}, insufficientData=${field.insufficientData}`
    );
  }
  lines.push("- sparseFamilies:");
  for (const family of report.metadataCoverageAnalytics.sparseFamilies.slice(0, 8)) {
    lines.push(
      `- family=${family.family}, cardsMatched=${family.cardsMatched}, totalActiveCards=${family.totalActiveCards}, coverageRate=${formatPercent(family.coverageRate)}, insufficientData=${family.insufficientData}`
    );
  }
  lines.push("");
  lines.push("## Parser Stability Analytics");
  lines.push(`- searchEvents: ${report.parserStabilityAnalytics.searchEvents}`);
  lines.push(`- telemetryKnownEvents: ${report.parserStabilityAnalytics.telemetryKnownEvents}`);
  lines.push(`- unknownTelemetryEvents: ${report.parserStabilityAnalytics.unknownTelemetryEvents}`);
  lines.push(renderRateMetric("timeoutRatio", report.parserStabilityAnalytics.timeoutRatio));
  lines.push(renderRateMetric("fallbackRatio", report.parserStabilityAnalytics.fallbackRatio));
  lines.push(renderRateMetric("rerankEffectivenessRatio", report.parserStabilityAnalytics.rerankEffectivenessRatio));
  lines.push("- outcomeBreakdown:");
  for (const item of report.parserStabilityAnalytics.outcomeBreakdown) {
    lines.push(`- outcome=${item.outcome}, count=${item.count}`);
  }
  lines.push("- fallbackReasonBreakdown:");
  for (const item of report.parserStabilityAnalytics.fallbackReasonBreakdown) {
    lines.push(`- fallbackReason=${item.outcome}, count=${item.count}`);
  }

  return lines.join("\n");
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  const report = await recommendationAnalyticsService.generateReport({
    file: options.file,
    date: options.date,
  });

  const reportDir = path.join(process.cwd(), "reports", "recommendation-analytics", report.summary.dateKey);
  await mkdir(reportDir, { recursive: true });

  const jsonPath = path.join(reportDir, "report.json");
  const mdPath = path.join(reportDir, "report.md");
  const jsonContent = JSON.stringify(report, null, 2);
  const mdContent = renderReport(report);

  await writeFile(jsonPath, jsonContent, "utf8");
  await writeFile(mdPath, mdContent, "utf8");

  console.log(
    JSON.stringify(
      {
        dateKey: report.summary.dateKey,
        jsonPath,
        mdPath,
        summary: {
          searchCount: report.conversionAnalytics.searchCount,
          selectionCount: report.conversionAnalytics.selectionCount,
          checkoutCreatedCount: report.conversionAnalytics.checkoutCreatedCount,
          paidCount: report.conversionAnalytics.paidCount,
          invalidLineCount: report.summary.invalidLineCount,
        },
      },
      null,
      2
    )
  );
};

main().catch((error) => {
  console.error("[ANALYZE RECOMMENDATION ANALYTICS] failed", error);
  process.exit(1);
});
