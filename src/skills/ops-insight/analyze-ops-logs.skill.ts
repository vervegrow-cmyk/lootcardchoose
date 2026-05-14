import { OpsInsightAnalysis, OpsLogFetchResult } from "../../agents/ops-insight/ops-insight.types";
import { opsLogAnalysisService } from "../../services/ops-log-analysis.service";
import { logger } from "../../utils/logger";

export const analyzeOpsLogsSkill = async (logs: OpsLogFetchResult): Promise<OpsInsightAnalysis> => {
  logger.info("[OPS INSIGHT] analyze logs skill start", {
    source: logs.logSource,
    lineCount: logs.lines.length,
  });

  const analysis = await opsLogAnalysisService.analyzeMockLogs(logs);

  logger.info("[OPS INSIGHT] analyze logs skill complete", {
    health: analysis.health,
    issuesFound: analysis.issuesFound.length,
  });

  return analysis;
};
