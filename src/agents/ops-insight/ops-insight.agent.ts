import { analyzeOpsLogsSkill } from "../../skills/ops-insight/analyze-ops-logs.skill";
import { fetchRailwayLogsSkill } from "../../skills/ops-insight/fetch-railway-logs.skill";
import { saveOpsReportSkill } from "../../skills/ops-insight/save-ops-report.skill";
import { logger } from "../../utils/logger";
import { OpsInsightRunInput, OpsInsightRunResult } from "./ops-insight.types";

const resolveReportDate = (inputDate?: string): string => {
  if (inputDate) {
    return inputDate;
  }
  return new Date().toISOString().slice(0, 10);
};

export class OpsInsightAgent {
  async run(input: OpsInsightRunInput = {}): Promise<OpsInsightRunResult> {
    const date = resolveReportDate(input.date);
    logger.info("[OPS INSIGHT AGENT] run start", { date });

    const logs = await fetchRailwayLogsSkill();
    const analysis = await analyzeOpsLogsSkill(logs);
    const savedReport = await saveOpsReportSkill(date, analysis);

    logger.info("[OPS INSIGHT AGENT] run complete", {
      date,
      health: analysis.health,
      reportPath: savedReport.reportPath,
    });

    return {
      date,
      health: analysis.health,
      logSource: analysis.logSource,
      generatedAt: analysis.generatedAt,
      reportPath: savedReport.reportPath,
    };
  }
}
