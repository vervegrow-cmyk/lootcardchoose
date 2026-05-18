import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { RecommendationFeedbackEvent } from "../types/recommendation-feedback.types";
import type {
  RecommendationFeedbackAnalyticsCliOptions,
  RecommendationFeedbackAnalyticsParsedLine,
  RecommendationFeedbackAnalyticsReport,
  RecommendationFeedbackAnalyticsSource,
  RecommendationFeedbackAnalyticsSummary,
  RecommendationFeedbackAnalyticsTopCard,
  RecommendationFeedbackAnalyticsTopQuery,
} from "../types/recommendation-feedback-analytics.types";
import { saveValidationArtifact } from "./validation-artifact";

const DEFAULT_LIMIT = 20;
const DEFAULT_FILE_PATH = path.join(process.cwd(), "reports", "recommendation-feedback.jsonl");
const REPORTS_DIR = path.join(process.cwd(), "reports");
type FeedbackCardSummary = NonNullable<
  RecommendationFeedbackEvent["recommendationDebugSummary"]
>["top10BeforeRerank"][number];

const parseArgs = (argv: string[]): RecommendationFeedbackAnalyticsCliOptions => {
  let json = false;
  let limit = DEFAULT_LIMIT;
  let file: string | null = null;
  let outputPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--limit") {
      const value = argv[index + 1];
      const parsed = Number.parseInt(value ?? "", 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = parsed;
        index += 1;
      }
      continue;
    }

    if (arg === "--file") {
      file = argv[index + 1] ?? null;
      if (file) {
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

  return { json, limit, file, outputPath };
};

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const safeRate = (numerator: number, denominator: number): number => {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
};

const compareIdOrder = (
  before: FeedbackCardSummary[] | undefined,
  after: FeedbackCardSummary[] | undefined
): "changed" | "same" | "missing" => {
  if (!before || !after || before.length === 0 || after.length === 0) {
    return "missing";
  }

  if (before.length !== after.length) {
    return "changed";
  }

  const same = before.every((item: FeedbackCardSummary, index: number) => item.id === after[index]?.id);
  return same ? "same" : "changed";
};

const sortByCountDesc = <T extends { count: number }>(items: T[]): T[] =>
  [...items].sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    return JSON.stringify(left).localeCompare(JSON.stringify(right));
  });

const incrementMap = (map: Map<string, number>, key: string | null | undefined): void => {
  const normalized = key?.trim();
  if (!normalized) {
    return;
  }
  map.set(normalized, (map.get(normalized) ?? 0) + 1);
};

const resolveCardTitle = (event: RecommendationFeedbackEvent, cardId: string): string | null => {
  const summary = event.recommendationDebugSummary;
  if (!summary) {
    return null;
  }

  for (const item of summary.top10AfterRerank) {
    if (item.id === cardId) {
      return item.title;
    }
  }

  for (const item of summary.top10BeforeRerank) {
    if (item.id === cardId) {
      return item.title;
    }
  }

  return null;
};

const toTopQueries = (map: Map<string, number>, limit: number): RecommendationFeedbackAnalyticsTopQuery[] =>
  sortByCountDesc(
    Array.from(map.entries()).map(([query, count]) => ({
      query,
      count,
    }))
  ).slice(0, limit);

const toTopCards = (
  countMap: Map<string, number>,
  titleMap: Map<string, string | null>,
  limit: number
): RecommendationFeedbackAnalyticsTopCard[] =>
  sortByCountDesc(
    Array.from(countMap.entries()).map(([cardId, count]) => ({
      cardId,
      title: titleMap.get(cardId) ?? null,
      count,
    }))
  ).slice(0, limit);

const resolveSource = async (requestedFile: string | null): Promise<RecommendationFeedbackAnalyticsSource> => {
  if (requestedFile) {
    try {
      const content = await readFile(requestedFile, "utf8");
      return {
        file: requestedFile,
        selectedBy: "explicit",
        usedFallbackFile: false,
        missing: false,
        content,
      };
    } catch {
      return {
        file: requestedFile,
        selectedBy: "explicit",
        usedFallbackFile: false,
        missing: true,
        content: "",
      };
    }
  }

  try {
    await access(DEFAULT_FILE_PATH);
    const content = await readFile(DEFAULT_FILE_PATH, "utf8");
    return {
      file: DEFAULT_FILE_PATH,
      selectedBy: "default",
      usedFallbackFile: false,
      missing: false,
      content,
    };
  } catch {
    // fall through
  }

  let entries: string[] = [];
  try {
    entries = await readdir(REPORTS_DIR);
  } catch {
    return {
      file: null,
      selectedBy: "newest_report",
      usedFallbackFile: false,
      missing: true,
      content: "",
    };
  }

  const candidateFiles = entries
    .filter((entry) => /^recommendation-feedback.*\.jsonl$/i.test(entry))
    .map((entry) => path.join(REPORTS_DIR, entry));

  if (candidateFiles.length === 0) {
    return {
      file: null,
      selectedBy: "newest_report",
      usedFallbackFile: false,
      missing: true,
      content: "",
    };
  }

  const filesWithMeta = await Promise.all(
    candidateFiles.map(async (filePath) => {
      const [content, fileStat] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
      return {
        filePath,
        content,
        modifiedMs: fileStat.mtimeMs,
      };
    })
  );

  filesWithMeta.sort((left, right) => {
    if (right.modifiedMs !== left.modifiedMs) {
      return right.modifiedMs - left.modifiedMs;
    }
    return right.filePath.localeCompare(left.filePath);
  });

  const newest = filesWithMeta[0];
  return {
    file: newest.filePath,
    selectedBy: "newest_report",
    usedFallbackFile: true,
    missing: false,
    content: newest.content,
  };
};

const parseLines = (content: string): RecommendationFeedbackAnalyticsParsedLine[] =>
  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return {
          ok: true,
          event: JSON.parse(line) as RecommendationFeedbackEvent,
        };
      } catch {
        return {
          ok: false,
          line,
        };
      }
    });

const buildInterpretation = (summary: RecommendationFeedbackAnalyticsSummary) => {
  const findings: string[] = [];

  if (summary.searchCount === 0) {
    findings.push("no search events found in the analyzed feedback file");
  }
  if (summary.purchaseCount > 0 && summary.orphanPurchaseCount > 0) {
    findings.push(`found ${summary.orphanPurchaseCount} orphan purchase events`);
  }
  if (summary.usedFallbackRate >= 0.5 && summary.searchCount >= 3) {
    findings.push(`fallback usage is elevated at ${formatPercent(summary.usedFallbackRate)}`);
  }
  if (summary.sessionsWithNoRankingChange > summary.sessionsWithRerank && summary.searchCount >= 4) {
    findings.push("no-ranking-change sessions currently outnumber reranked sessions");
  }
  if (summary.selectionCount === 0 && summary.searchCount > 0) {
    findings.push("searches were recorded but no selections were recorded");
  }
  if (summary.checkoutCount === 0 && summary.selectionCount > 0) {
    findings.push("selections were recorded but no checkout creation was recorded");
  }
  if (summary.purchaseCount === 0 && summary.checkoutCount > 0) {
    findings.push("checkouts were recorded but no purchases were recorded");
  }

  if (findings.length === 0) {
    findings.push("analytics did not show a clear V1 validation anomaly in this sample");
  }

  return {
    status: findings[0] === "analytics did not show a clear V1 validation anomaly in this sample" ? "healthy" : "observe",
    findings,
  } as const;
};

const buildRecommendationV2Gate = (summary: RecommendationFeedbackAnalyticsSummary) => {
  const reasons: string[] = [];

  if (summary.searchCount >= 8 && summary.usedFallbackRate >= 0.8) {
    reasons.push(`fallback rate remained very high across ${summary.searchCount} searches`);
  }
  if (summary.searchCount >= 8 && summary.searchToSelectionRate <= 0.1) {
    reasons.push("search to selection conversion stayed very weak across a meaningful sample");
  }
  if (summary.checkoutCount >= 5 && summary.checkoutToPurchaseRate <= 0.1) {
    reasons.push("checkout to purchase conversion stayed very weak across a meaningful sample");
  }
  if (summary.searchCount >= 8 && summary.sessionsWithRerank === 0) {
    reasons.push("rerank never changed ranking across a meaningful sample");
  }
  if (summary.purchaseCount >= 3 && summary.orphanPurchaseCount >= 2) {
    reasons.push("orphan purchases appeared repeatedly in real analytics");
  }

  return {
    status: reasons.length > 0 ? "re_evaluate" : "not_needed",
    reasons: reasons.length > 0 ? reasons : ["current validation data does not justify Recommendation V2"],
  } as const;
};

const buildReport = (
  parsedEvents: RecommendationFeedbackEvent[],
  totalLines: number,
  invalidLines: number,
  source: RecommendationFeedbackAnalyticsSource,
  limit: number
): RecommendationFeedbackAnalyticsReport => {
  let searchCount = 0;
  let selectionCount = 0;
  let checkoutCount = 0;
  let purchaseCount = 0;
  let fallbackSearchCount = 0;
  let orphanPurchaseCount = 0;
  let sessionsWithRerank = 0;
  let sessionsWithNoRankingChange = 0;

  const queryCounts = new Map<string, number>();
  const selectedCardCounts = new Map<string, number>();
  const purchasedCardCounts = new Map<string, number>();
  const selectedCardTitles = new Map<string, string | null>();
  const purchasedCardTitles = new Map<string, string | null>();

  for (const event of parsedEvents) {
    if (event.eventType === "search") {
      searchCount += 1;
      incrementMap(queryCounts, event.query);

      if (event.recommendationDebugSummary?.usedFallback) {
        fallbackSearchCount += 1;
      }

      const rerankStatus = compareIdOrder(
        event.recommendationDebugSummary?.top10BeforeRerank,
        event.recommendationDebugSummary?.top10AfterRerank
      );
      if (rerankStatus === "changed") {
        sessionsWithRerank += 1;
      } else if (rerankStatus === "same") {
        sessionsWithNoRankingChange += 1;
      }
    }

    if (event.eventType === "selection") {
      selectionCount += 1;
      incrementMap(selectedCardCounts, event.selectedCardId);
      if (event.selectedCardId) {
        selectedCardTitles.set(event.selectedCardId, resolveCardTitle(event, event.selectedCardId));
      }
    }

    if (event.eventType === "checkout_created") {
      checkoutCount += 1;
    }

    if (event.eventType === "purchase_completed") {
      purchaseCount += 1;
      if (event.orphan) {
        orphanPurchaseCount += 1;
      }
      incrementMap(purchasedCardCounts, event.selectedCardId);
      if (event.selectedCardId) {
        purchasedCardTitles.set(event.selectedCardId, resolveCardTitle(event, event.selectedCardId));
      }
    }
  }

  const searchToSelectionRate = safeRate(selectionCount, searchCount);
  const selectionToCheckoutRate = safeRate(checkoutCount, selectionCount);
  const checkoutToPurchaseRate = safeRate(purchaseCount, checkoutCount);
  const usedFallbackRate = safeRate(fallbackSearchCount, searchCount);

  const summary: RecommendationFeedbackAnalyticsSummary = {
    file: source.file,
    totalLines,
    parsedLines: parsedEvents.length,
    invalidLines,
    searchCount,
    selectionCount,
    checkoutCount,
    purchaseCount,
    searchToSelectionRate,
    selectionToCheckoutRate,
    checkoutToPurchaseRate,
    usedFallbackRate,
    orphanPurchaseCount,
    sessionsWithRerank,
    sessionsWithNoRankingChange,
  };

  return {
    file: source.file,
    totalLines,
    parsedLines: parsedEvents.length,
    invalidLines,
    source: {
      file: source.file,
      selectedBy: source.selectedBy,
      usedFallbackFile: source.usedFallbackFile,
    },
    summary,
    conversion: {
      searchToSelectionRate,
      selectionToCheckoutRate,
      checkoutToPurchaseRate,
    },
    rerankHealth: {
      usedFallbackRate,
      orphanPurchaseCount,
      sessionsWithRerank,
      sessionsWithNoRankingChange,
    },
    interpretation: buildInterpretation(summary),
    recommendationV2Gate: buildRecommendationV2Gate(summary),
    topQueries: toTopQueries(queryCounts, limit),
    topSelectedCards: toTopCards(selectedCardCounts, selectedCardTitles, limit),
    topPurchasedCards: toTopCards(purchasedCardCounts, purchasedCardTitles, limit),
  };
};

const renderMarkdown = (report: RecommendationFeedbackAnalyticsReport): string => {
  const lines: string[] = [];

  lines.push("## Summary");
  lines.push(`- file: ${report.file ?? "not found"}`);
  lines.push(`- source selected by: ${report.source.selectedBy}`);
  if (report.source.usedFallbackFile && report.file) {
    lines.push("- note: default feedback file was missing; analyzed newest matching report instead");
  }
  lines.push(`- total lines: ${report.totalLines}`);
  lines.push(`- parsed lines: ${report.parsedLines}`);
  lines.push(`- invalid lines: ${report.invalidLines}`);
  lines.push(`- search count: ${report.summary.searchCount}`);
  lines.push(`- selection count: ${report.summary.selectionCount}`);
  lines.push(`- checkout count: ${report.summary.checkoutCount}`);
  lines.push(`- purchase count: ${report.summary.purchaseCount}`);

  lines.push("");
  lines.push("## Conversion");
  lines.push(`- search -> selection: ${formatPercent(report.conversion.searchToSelectionRate)}`);
  lines.push(`- selection -> checkout: ${formatPercent(report.conversion.selectionToCheckoutRate)}`);
  lines.push(`- checkout -> purchase: ${formatPercent(report.conversion.checkoutToPurchaseRate)}`);

  lines.push("");
  lines.push("## Rerank Health");
  lines.push(`- used fallback rate: ${formatPercent(report.rerankHealth.usedFallbackRate)}`);
  lines.push(`- orphan purchase count: ${report.rerankHealth.orphanPurchaseCount}`);
  lines.push(`- sessions with rerank: ${report.rerankHealth.sessionsWithRerank}`);
  lines.push(`- sessions with no ranking change: ${report.rerankHealth.sessionsWithNoRankingChange}`);

  lines.push("");
  lines.push("## Interpretation");
  lines.push(`- status: ${report.interpretation.status}`);
  report.interpretation.findings.forEach((finding) => {
    lines.push(`- ${finding}`);
  });

  lines.push("");
  lines.push("## Recommendation V2 Gate");
  lines.push(`- status: ${report.recommendationV2Gate.status}`);
  report.recommendationV2Gate.reasons.forEach((reason) => {
    lines.push(`- ${reason}`);
  });

  lines.push("");
  lines.push("## Top Queries");
  if (report.topQueries.length === 0) {
    lines.push("- none");
  } else {
    report.topQueries.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.query} (${item.count})`);
    });
  }

  lines.push("");
  lines.push("## Top Cards");
  lines.push("Selected:");
  if (report.topSelectedCards.length === 0) {
    lines.push("- none");
  } else {
    report.topSelectedCards.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.cardId} | ${item.title ?? "null"} (${item.count})`);
    });
  }

  lines.push("");
  lines.push("Purchased:");
  if (report.topPurchasedCards.length === 0) {
    lines.push("- none");
  } else {
    report.topPurchasedCards.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.cardId} | ${item.title ?? "null"} (${item.count})`);
    });
  }

  return lines.join("\n");
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  const source = await resolveSource(options.file);

  if (source.missing || !source.file) {
    const message = {
      file: options.file ?? DEFAULT_FILE_PATH,
      message: "No recommendation feedback JSONL file found. Run gallery:test-recommendation-feedback or generate production feedback first.",
    };
    if (options.json) {
      console.log(JSON.stringify(message, null, 2));
    } else {
      console.log("## Summary");
      console.log(`- file: ${options.file ?? DEFAULT_FILE_PATH}`);
      console.log(`- message: ${message.message}`);
    }
    return;
  }

  const parsedLines = parseLines(source.content);
  const validEvents = parsedLines
    .filter((entry): entry is Extract<RecommendationFeedbackAnalyticsParsedLine, { ok: true }> => entry.ok)
    .map((entry) => entry.event);
  const invalidLines = parsedLines.length - validEvents.length;

  const report = buildReport(validEvents, parsedLines.length, invalidLines, source, options.limit);

  if (options.json) {
    const artifactPath = await saveValidationArtifact(report, {
      outputPath: options.outputPath,
      prefix: "analytics-validation",
    });
    console.log(
      JSON.stringify(
        {
          ...report,
          artifactPath,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(renderMarkdown(report));
};

main().catch((error) => {
  console.error("[ANALYZE RECOMMENDATION FEEDBACK] failed", error);
  process.exit(1);
});
