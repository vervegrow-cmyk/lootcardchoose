import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { OpsInsightAnalysis, OpsInsightReportSaveResult } from "../agents/ops-insight/ops-insight.types";

const REPORTS_ROOT = path.resolve(process.cwd(), "reports", "ops-insights");

const redactLooseSecrets = (value: string): string =>
  value
    .replace(/\b(Bearer)\s+([A-Za-z0-9._-]{8,})/gi, (_match, label: string) => `${label} [REDACTED]`)
    .replace(/\b(api[_-]?key|token|secret|password|access[_-]?key)\b\s*[:=]\s*([^\s,;]+)/gi, "$1=[REDACTED]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[REDACTED]");

const redactLines = (lines: string[]): string[] => lines.map((line) => redactLooseSecrets(line));

const renderBulletSection = (items: string[]): string => (items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None");

export const fileReportService = {
  redactSecrets(lines: string[]): string[] {
    return redactLines(lines);
  },

  renderOpsInsightMarkdown(date: string, analysis: OpsInsightAnalysis): string {
    const summary = redactLooseSecrets(analysis.summary);
    const issuesFound = this.redactSecrets(analysis.issuesFound);
    const optimizationSuggestions = this.redactSecrets(analysis.optimizationSuggestions);
    const tomorrowWatchlist = this.redactSecrets(analysis.tomorrowWatchlist);
    const rawLogNotes = this.redactSecrets([
      `Analysis source: ${analysis.analysisSource}`,
      ...analysis.rawLogNotes,
    ]);

    return [
      `# LootCardChoose Ops Insight - ${date}`,
      "",
      "## Status",
      `- Health: ${analysis.health}`,
      `- Log Source: ${analysis.logSource}`,
      `- Generated At: ${analysis.generatedAt}`,
      "",
      "## Summary",
      summary,
      "",
      "## Issues Found",
      renderBulletSection(issuesFound),
      "",
      "## Optimization Suggestions",
      renderBulletSection(optimizationSuggestions),
      "",
      "## Tomorrow Watchlist",
      renderBulletSection(tomorrowWatchlist),
      "",
      "## Raw Log Notes",
      renderBulletSection(rawLogNotes),
      "",
    ].join("\n");
  },

  async saveDailyReport(date: string, analysis: OpsInsightAnalysis): Promise<OpsInsightReportSaveResult> {
    await mkdir(REPORTS_ROOT, { recursive: true });
    const reportPath = path.resolve(REPORTS_ROOT, `${date}.md`);
    const markdown = this.renderOpsInsightMarkdown(date, analysis);
    await writeFile(reportPath, markdown, "utf8");
    return {
      reportPath,
      markdown,
    };
  },
};
