import { access, readdir, readFile } from "node:fs/promises";
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

const DEFAULT_LIMIT = 20;
const DEFAULT_FILE_PATH = path.join(process.cwd(), "reports", "recommendation-feedback.jsonl");
const REPORTS_DIR = path.join(process.cwd(), "reports");
type FeedbackCardSummary = NonNullable<
  RecommendationFeedbackEvent["recommendationDebugSummary"]
>["top10BeforeRerank"][number];

const parseArgs = (argv: string[]): RecommendationFeedbackAnalyticsCliOptions => {
  let json = false;
  let limit = DEFAULT_LIMIT;

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
    }
  }

  return { json, limit };
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

const resolveSource = async (): Promise<RecommendationFeedbackAnalyticsSource> => {
  try {
    await access(DEFAULT_FILE_PATH);
    const content = await readFile(DEFAULT_FILE_PATH, "utf8");
    return {
      file: DEFAULT_FILE_PATH,
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
      usedFallbackFile: false,
      missing: true,
      content: "",
    };
  }

  const filesWithContent = await Promise.all(
    candidateFiles.map(async (filePath) => {
      const content = await readFile(filePath, "utf8");
      const lines = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean).length;
      return { filePath, content, lines };
    })
  );

  filesWithContent.sort((left, right) => {
    if (right.lines !== left.lines) {
      return right.lines - left.lines;
    }
    return right.filePath.localeCompare(left.filePath);
  });

  const best = filesWithContent[0];
  return {
    file: best.filePath,
    usedFallbackFile: true,
    missing: false,
    content: best.content,
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

const buildReport = (
  parsedEvents: RecommendationFeedbackEvent[],
  totalLines: number,
  invalidLines: number,
  file: string | null,
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
    file,
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
    file,
    totalLines,
    parsedLines: parsedEvents.length,
    invalidLines,
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
    topQueries: toTopQueries(queryCounts, limit),
    topSelectedCards: toTopCards(selectedCardCounts, selectedCardTitles, limit),
    topPurchasedCards: toTopCards(purchasedCardCounts, purchasedCardTitles, limit),
  };
};

const renderMarkdown = (
  report: RecommendationFeedbackAnalyticsReport,
  source: RecommendationFeedbackAnalyticsSource
): string => {
  const lines: string[] = [];

  lines.push("## Summary");
  lines.push(`- file: ${report.file ?? "not found"}`);
  if (source.usedFallbackFile && report.file) {
    lines.push(`- note: default feedback file was missing; analyzed latest fallback file instead`);
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
  const source = await resolveSource();

  if (source.missing || !source.file) {
    const message = {
      file: DEFAULT_FILE_PATH,
      message: "No recommendation feedback JSONL file found. Run gallery:test-recommendation-feedback or generate production feedback first.",
    };
    if (options.json) {
      console.log(JSON.stringify(message, null, 2));
    } else {
      console.log("## Summary");
      console.log(`- file: ${DEFAULT_FILE_PATH}`);
      console.log(`- message: ${message.message}`);
    }
    return;
  }

  const parsedLines = parseLines(source.content);
  const validEvents = parsedLines
    .filter((entry): entry is Extract<RecommendationFeedbackAnalyticsParsedLine, { ok: true }> => entry.ok)
    .map((entry) => entry.event);
  const invalidLines = parsedLines.length - validEvents.length;

  const report = buildReport(validEvents, parsedLines.length, invalidLines, source.file, options.limit);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(renderMarkdown(report, source));
};

main().catch((error) => {
  console.error("[ANALYZE RECOMMENDATION FEEDBACK] failed", error);
  process.exit(1);
});
