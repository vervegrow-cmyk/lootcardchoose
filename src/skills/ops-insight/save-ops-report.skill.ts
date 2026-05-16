import { OpsInsightAnalysis, OpsInsightReportSaveResult } from "../../agents/ops-insight/ops-insight.types";
import { fileReportService } from "../../services/file-report.service";
import { logger } from "../../utils/logger";

export const saveOpsReportSkill = async (
  date: string,
  analysis: OpsInsightAnalysis
): Promise<OpsInsightReportSaveResult> => {
  logger.info("[OPS INSIGHT] save report skill start", {
    date,
    health: analysis.health,
  });

  const result = await fileReportService.saveDailyReport(date, analysis);

  logger.info("[OPS INSIGHT] save report skill complete", {
    date,
    reportPath: result.reportPath,
  });

  return result;
};
