export type OpsInsightRunInput = {
  date?: string;
};

export type OpsLogLevel = "info" | "warn" | "error";

export type OpsLogSource = "mock" | "railway" | "railway_fallback";

export type OpsLogFetchStatus = "success" | "fallback";

export type OpsLogRequestConfig = {
  since: string;
  lines: number;
  timeoutMs: number;
  service?: string;
  environment?: string;
};

export type OpsLogLine = {
  timestamp: string;
  level: OpsLogLevel;
  message: string;
};

export type OpsLogFetchResult = {
  health: "mock" | "healthy" | "warning";
  logSource: OpsLogSource;
  fetchStatus: OpsLogFetchStatus;
  generatedAt: string;
  failureReason?: string;
  requestConfig: OpsLogRequestConfig;
  lines: OpsLogLine[];
};

export type OpsInsightAnalysis = {
  health: "healthy" | "warning" | "critical" | "unknown";
  analysisSource: "llm" | "deterministic";
  logSource: OpsLogSource;
  generatedAt: string;
  summary: string;
  issuesFound: string[];
  optimizationSuggestions: string[];
  tomorrowWatchlist: string[];
  rawLogNotes: string[];
};

export type OpsInsightReportSaveResult = {
  reportPath: string;
  markdown: string;
};

export type OpsInsightRunResult = {
  date: string;
  health: OpsInsightAnalysis["health"];
  logSource: OpsInsightAnalysis["logSource"];
  generatedAt: string;
  reportPath: string;
};
