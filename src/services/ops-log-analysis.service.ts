import { loadEnv } from "../config/env";
import { OpsInsightAnalysis, OpsLogFetchResult, OpsLogLine } from "../agents/ops-insight/ops-insight.types";

const OPS_LOG_ANALYSIS_MAX_LINES = 400;
const OPS_LOG_ANALYSIS_TIMEOUT_MS = 10000;
const OPS_LOG_ANALYSIS_MAX_ITEMS = 10;

type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

type OpsLlmAnalysisPayload = {
  health: "healthy" | "warning" | "critical" | "unknown";
  summary: string;
  issuesFound: string[];
  optimizationSuggestions: string[];
  tomorrowWatchlist: string[];
};

const buildRequestConfigNotes = (logs: OpsLogFetchResult): string[] => {
  const notes = [
    `Railway log request config: since=${logs.requestConfig.since}, lines=${logs.requestConfig.lines}, timeoutMs=${logs.requestConfig.timeoutMs}`,
  ];

  const selectors: string[] = [];
  if (logs.requestConfig.service) {
    selectors.push(`service=${logs.requestConfig.service}`);
  }
  if (logs.requestConfig.environment) {
    selectors.push(`environment=${logs.requestConfig.environment}`);
  }

  if (selectors.length > 0) {
    notes.push(`Railway log request selectors: ${selectors.join(", ")}`);
  }

  return notes;
};

const capItems = (items: string[]): string[] => items.filter((item) => item.trim().length > 0).slice(0, OPS_LOG_ANALYSIS_MAX_ITEMS);

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

const buildLogWindow = (lines: OpsLogLine[]): string[] =>
  lines.slice(-OPS_LOG_ANALYSIS_MAX_LINES).map((line) => `[${line.level.toUpperCase()}] ${line.timestamp} ${line.message}`);

const buildPrompt = (logs: OpsLogFetchResult, windowLines: string[]): DeepSeekMessage[] => [
  {
    role: "system",
    content:
      "You are an operations log analyzer for LootCardChoose. Output JSON only. Do not output markdown. " +
      "Do not output code diff. Do not invent facts that are not present in the logs. " +
      "Do not give conclusions unsupported by the logs. Analyze only the provided log evidence. " +
      "Focus on Discord bot readiness, HTTP server listening, Railway PORT issues, Shopify webhook issues, " +
      "gallery search issues, checkout creation failures, Prisma/database issues, LLM parser issues, R2 issues, " +
      "and whether unrecognized intents appear too often. Return exactly this JSON shape: " +
      '{"health":"healthy|warning|critical|unknown","summary":"string","issuesFound":["string"],"optimizationSuggestions":["string"],"tomorrowWatchlist":["string"]}.',
  },
  {
    role: "user",
    content: [
      `Log source: ${logs.logSource}`,
      `Generated at: ${logs.generatedAt}`,
      `Recent log lines count: ${windowLines.length}`,
      "Recent redacted logs:",
      ...windowLines,
    ].join("\n"),
  },
];

const extractJsonPayload = (raw: string): string => {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
};

const isValidHealth = (value: unknown): value is OpsLlmAnalysisPayload["health"] =>
  value === "healthy" || value === "warning" || value === "critical" || value === "unknown";

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const sanitizeLlmPayload = (value: unknown): OpsLlmAnalysisPayload | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const payload = value as Record<string, unknown>;
  if (!isValidHealth(payload.health) || typeof payload.summary !== "string") {
    return null;
  }

  return {
    health: payload.health,
    summary: payload.summary.trim(),
    issuesFound: capItems(asStringArray(payload.issuesFound)),
    optimizationSuggestions: capItems(asStringArray(payload.optimizationSuggestions)),
    tomorrowWatchlist: capItems(asStringArray(payload.tomorrowWatchlist)),
  };
};

const safeParseLlmPayload = (raw: string): OpsLlmAnalysisPayload | null => {
  try {
    const parsed = JSON.parse(extractJsonPayload(raw)) as unknown;
    return sanitizeLlmPayload(parsed);
  } catch {
    return null;
  }
};

const collectDeterministicIssues = (logs: OpsLogFetchResult): string[] => {
  const issues: string[] = [];
  const windowLines = buildLogWindow(logs.lines);
  const lowerWindow = windowLines.map((line) => line.toLowerCase());
  const hasError = logs.lines.some((line) => line.level === "error");
  const hasWarn = logs.lines.some((line) => line.level === "warn");

  if (logs.fetchStatus === "fallback" || logs.logSource === "railway_fallback") {
    issues.push(logs.failureReason ?? "Railway CLI log fetch failed and complete production health could not be verified.");
  }

  if (!lowerWindow.some((line) => line.includes("[discord] bot ready"))) {
    issues.push("Discord bot ready signal was not observed in the analyzed log window.");
  }

  if (!lowerWindow.some((line) => line.includes("[http] server listening"))) {
    issues.push("HTTP server listening signal was not observed in the analyzed log window.");
  }

  if (lowerWindow.some((line) => line.includes("port") && line.includes("error"))) {
    issues.push("Potential Railway PORT-related errors were observed in the log window.");
  }

  if (lowerWindow.some((line) => line.includes("webhook") && line.includes("error"))) {
    issues.push("Webhook-related errors were observed in the log window.");
  }

  if (lowerWindow.some((line) => line.includes("gallery") && line.includes("error"))) {
    issues.push("Gallery-related errors were observed in the log window.");
  }

  if (lowerWindow.some((line) => line.includes("checkout") && line.includes("fail"))) {
    issues.push("Checkout creation failures were observed in the log window.");
  }

  if (lowerWindow.some((line) => line.includes("prisma") || line.includes("database"))) {
    const hasDatabaseError = lowerWindow.some(
      (line) => (line.includes("prisma") || line.includes("database")) && (line.includes("error") || line.includes("timeout"))
    );
    if (hasDatabaseError) {
      issues.push("Prisma or database-related errors were observed in the log window.");
    }
  }

  if (lowerWindow.some((line) => line.includes("llm") && (line.includes("timeout") || line.includes("error")))) {
    issues.push("LLM parser timeouts or errors were observed in the log window.");
  }

  if (lowerWindow.some((line) => line.includes("r2") && line.includes("error"))) {
    issues.push("R2-related errors were observed in the log window.");
  }

  const ignoredIntentCount = lowerWindow.filter((line) => line.includes("intent=ignore")).length;
  if (ignoredIntentCount >= 5) {
    issues.push(`Unrecognized or ignored intents appeared frequently in the analyzed log window (${ignoredIntentCount} events).`);
  }

  if (hasError && !issues.some((issue) => issue.toLowerCase().includes("error"))) {
    issues.push("At least one application error event is present in the analyzed log window.");
  } else if (hasWarn && issues.length === 0) {
    issues.push("Warning-level events were observed even though no critical failures were confirmed.");
  }

  if (issues.length === 0) {
    issues.push("No critical issues were detected in the analyzed log window.");
  }

  return capItems(issues);
};

const deterministicHealth = (logs: OpsLogFetchResult): OpsInsightAnalysis["health"] => {
  if (logs.fetchStatus === "fallback" || logs.logSource === "railway_fallback") {
    return "unknown";
  }

  const hasError = logs.lines.some((line) => line.level === "error");
  const hasWarn = logs.lines.some((line) => line.level === "warn");

  if (hasError) {
    return "critical";
  }

  if (hasWarn) {
    return "warning";
  }

  return "healthy";
};

const buildDeterministicSummary = (logs: OpsLogFetchResult, health: OpsInsightAnalysis["health"]): string => {
  if (logs.fetchStatus === "fallback" || logs.logSource === "railway_fallback") {
    return "Railway logs could not be fetched, so online system health could not be fully verified. This report uses deterministic fallback analysis only.";
  }

  if (health === "critical") {
    return "Deterministic analysis found error-level signals in the recent Railway logs and recommends urgent follow-up.";
  }

  if (health === "warning") {
    return "Deterministic analysis found warning-level signals in the recent Railway logs and recommends closer monitoring.";
  }

  return "Deterministic analysis found no major warning or error signals in the recent Railway log window.";
};

const buildDeterministicAnalysis = (logs: OpsLogFetchResult, fallbackReason?: string): OpsInsightAnalysis => {
  const health = deterministicHealth(logs);
  const fallbackRawNote =
    logs.fetchStatus === "fallback" || logs.logSource === "railway_fallback"
      ? `Railway CLI fallback: ${logs.failureReason ?? "Log fetch failed and no live logs were captured."}`
      : null;
  const llmFallbackNote = fallbackReason ? `LLM analysis fallback: ${fallbackReason}` : null;
  const issuesFound = collectDeterministicIssues(logs);

  return {
    health,
    analysisSource: "deterministic",
    logSource: logs.logSource,
    generatedAt: logs.generatedAt,
    summary: buildDeterministicSummary(logs, health),
    issuesFound,
    optimizationSuggestions: capItems([
      "Track recurring warning and error signals by subsystem before the next deploy.",
      "Keep secret redaction enabled for all Railway log ingestion and report generation paths.",
      "Review service health indicators such as Discord ready, HTTP listening, checkout, and database behavior daily.",
    ]),
    tomorrowWatchlist: capItems([
      "Monitor whether Discord bot ready and HTTP server listening signals continue to appear consistently.",
      "Check whether ignored intents and LLM parser warnings increase over the next 24 hours.",
      "Confirm Railway CLI access and project linkage remain healthy for the next report run.",
    ]),
    rawLogNotes: [
      ...buildRequestConfigNotes(logs),
      ...(fallbackRawNote ? [fallbackRawNote] : []),
      ...(llmFallbackNote ? [llmFallbackNote] : []),
      ...buildLogWindow(logs.lines),
    ],
  };
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));

const OPS_LOG_ANALYSIS_TIMEOUT_ERROR = "OPS_LOG_ANALYSIS_TIMEOUT";

const analyzeWithLlm = async (logs: OpsLogFetchResult): Promise<OpsInsightAnalysis | null> => {
  const env = loadEnv();
  if (!env.deepseekApiKey) {
    return null;
  }

  const windowLines = buildLogWindow(logs.lines);
  const normalizedBaseUrl = normalizeBaseUrl(env.deepseekBaseUrl);
  const controller = new AbortController();
  let timeoutHandle: NodeJS.Timeout | undefined;

  try {
    const response = await Promise.race<
      | {
          ok: true;
          payload: DeepSeekResponse;
        }
      | {
          ok: false;
          status: number;
        }
    >([
      (async () => {
        const httpResponse = await fetch(`${normalizedBaseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.deepseekApiKey}`,
          },
          body: JSON.stringify({
            model: env.deepseekModel,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: buildPrompt(logs, windowLines),
          }),
          signal: controller.signal,
        });

        if (!httpResponse.ok) {
          return {
            ok: false as const,
            status: httpResponse.status,
          };
        }

        return {
          ok: true as const,
          payload: (await httpResponse.json()) as DeepSeekResponse,
        };
      })(),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          controller.abort();
          reject(new Error(OPS_LOG_ANALYSIS_TIMEOUT_ERROR));
        }, OPS_LOG_ANALYSIS_TIMEOUT_MS);
      }),
    ]);

    if (!response.ok) {
      throw new Error(`DeepSeek ops analysis returned HTTP ${response.status}.`);
    }

    const content = response.payload.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = safeParseLlmPayload(content);
    if (!parsed) {
      throw new Error("DeepSeek ops analysis returned invalid JSON payload.");
    }

    const health =
      logs.fetchStatus === "fallback" || logs.logSource === "railway_fallback"
        ? parsed.health === "healthy"
          ? "unknown"
          : parsed.health
        : parsed.health;

    return {
      health,
      analysisSource: "llm",
      logSource: logs.logSource,
      generatedAt: logs.generatedAt,
      summary: parsed.summary,
      issuesFound: capItems(parsed.issuesFound),
      optimizationSuggestions: capItems(parsed.optimizationSuggestions),
      tomorrowWatchlist: capItems(parsed.tomorrowWatchlist),
      rawLogNotes: [
        ...buildRequestConfigNotes(logs),
        ...windowLines,
      ],
    };
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

export const opsLogAnalysisService = {
  async analyzeMockLogs(logs: OpsLogFetchResult): Promise<OpsInsightAnalysis> {
    if (logs.fetchStatus === "fallback" || logs.logSource === "railway_fallback") {
      return buildDeterministicAnalysis(logs);
    }

    const env = loadEnv();
    if (!env.deepseekApiKey) {
      return buildDeterministicAnalysis(logs, "DeepSeek API key is missing.");
    }

    try {
      const llmAnalysis = await analyzeWithLlm(logs);
      if (!llmAnalysis) {
        return buildDeterministicAnalysis(logs, "DeepSeek analysis was unavailable.");
      }
      return llmAnalysis;
    } catch (error) {
      if ((error instanceof Error && error.message === OPS_LOG_ANALYSIS_TIMEOUT_ERROR) || isAbortError(error)) {
        return buildDeterministicAnalysis(logs, "DeepSeek analysis timed out.");
      }

      return buildDeterministicAnalysis(
        logs,
        error instanceof Error ? error.message : "DeepSeek analysis failed unexpectedly."
      );
    }
  },
};
