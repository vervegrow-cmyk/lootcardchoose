import { OpsLogFetchResult } from "../../agents/ops-insight/ops-insight.types";
import { railwayLogService } from "../../services/railway-log.service";
import { logger } from "../../utils/logger";

export const fetchRailwayLogsSkill = async (): Promise<OpsLogFetchResult> => {
  logger.info("[OPS INSIGHT] fetch logs skill start", {
    source: "railway",
  });

  const result = await railwayLogService.fetchRecentLogs();

  logger.info("[OPS INSIGHT] fetch logs skill complete", {
    source: result.logSource,
    fetchStatus: result.fetchStatus,
    lineCount: result.lines.length,
  });

  return result;
};
