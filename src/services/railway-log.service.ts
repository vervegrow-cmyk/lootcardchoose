import { execFile } from "node:child_process";
import { OpsLogFetchResult, OpsLogLevel, OpsLogLine, OpsLogRequestConfig } from "../agents/ops-insight/ops-insight.types";
import { loadEnv } from "../config/env";

const redactValue = (value: string): string => {
  if (value.length <= 8) {
    return "[REDACTED]";
  }
  return `${value.slice(0, 2)}...[REDACTED]...${value.slice(-2)}`;
};

const SECRET_PATTERNS: Array<{ pattern: RegExp; replacer: (match: string, value: string) => string }> = [
  {
    pattern: /\b(Bearer)\s+([A-Za-z0-9._-]{8,})/gi,
    replacer: (match, value) => match.replace(value, redactValue(value)),
  },
  {
    pattern: /\b(api[_-]?key|token|secret|password|access[_-]?key)\b\s*[:=]\s*([^\s,;]+)/gi,
    replacer: (match, value) => match.replace(value, redactValue(value)),
  },
];

const redactOpaqueTokens = (input: string): string =>
  input.replace(/\b[A-Za-z0-9_-]{24,}\b/g, (token) => redactValue(token));

const redactSecretLine = (line: string): string => {
  let next = line;
  for (const { pattern, replacer } of SECRET_PATTERNS) {
    next = next.replace(pattern, (...args: string[]) => {
      const match = args[0];
      const value = args[2] ?? "";
      return replacer(match, value);
    });
  }
  return redactOpaqueTokens(next);
};

const sanitizeReason = (reason: string): string => {
  const singleLine = reason.replace(/\s+/g, " ").trim();
  const redacted = redactSecretLine(singleLine);
  return redacted.length > 240 ? `${redacted.slice(0, 237)}...` : redacted;
};

const normalizeLevel = (value: string): OpsLogLevel => {
  const lowered = value.toLowerCase();
  if (lowered.includes("error") || lowered.includes("[err]")) {
    return "error";
  }
  if (lowered.includes("warn")) {
    return "warn";
  }
  return "info";
};

const parseRailwayLogLine = (rawLine: string, fallbackTimestamp: string): OpsLogLine => {
  const trimmed = rawLine.trim();
  const timestampMatch = trimmed.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+(?:\[(inf|err|wrn|warn)\]\s+)?(.*)$/i
  );

  if (timestampMatch) {
    const [, timestamp, levelHint, message] = timestampMatch;
    return {
      timestamp,
      level: normalizeLevel(levelHint ?? message),
      message: message.trim(),
    };
  }

  return {
    timestamp: fallbackTimestamp,
    level: normalizeLevel(trimmed),
    message: trimmed,
  };
};

const parseRailwayLogs = (stdout: string, generatedAt: string): OpsLogLine[] =>
  stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => parseRailwayLogLine(line, generatedAt));

const resolveRailwayLogRequestConfig = (): OpsLogRequestConfig => {
  const env = loadEnv();
  const service = env.railwayLogService.trim();
  const environment = env.railwayLogEnvironment.trim();

  return {
    since: env.railwayLogSince,
    lines: env.railwayLogLines,
    timeoutMs: env.railwayLogTimeoutMs,
    ...(service.length > 0 ? { service } : {}),
    ...(environment.length > 0 ? { environment } : {}),
  };
};

const buildRailwayCliArgs = (requestConfig: OpsLogRequestConfig): string[] => {
  const args = ["logs", "--since", requestConfig.since, "--lines", String(requestConfig.lines)];

  if (requestConfig.service) {
    args.push("--service", requestConfig.service);
  }

  if (requestConfig.environment) {
    args.push("--environment", requestConfig.environment);
  }

  return args;
};

const runRailwayLogsCommand = (requestConfig: OpsLogRequestConfig): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    execFile("railway", buildRailwayCliArgs(requestConfig), { timeout: requestConfig.timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject({
          code: "code" in error ? error.code : undefined,
          killed: "killed" in error ? Boolean(error.killed) : false,
          message: error.message,
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : "",
        });
        return;
      }

      resolve({
        stdout: typeof stdout === "string" ? stdout : "",
        stderr: typeof stderr === "string" ? stderr : "",
      });
    });
  });

const classifyFailureReason = (errorLike: {
  code?: string | number | null;
  killed?: boolean;
  message: string;
  stdout?: string;
  stderr?: string;
}): string => {
  const stderr = errorLike.stderr ?? "";
  const stdout = errorLike.stdout ?? "";
  const combined = `${stderr}\n${stdout}\n${errorLike.message}`.toLowerCase();

  if (errorLike.code === "ENOENT") {
    return "Railway CLI is not installed or not available on PATH.";
  }

  if (errorLike.killed || combined.includes("timed out")) {
    return "Railway CLI log fetch timed out before completing.";
  }

  if (combined.includes("login") || combined.includes("not logged in") || combined.includes("authenticate")) {
    return "Railway CLI is not logged in for this environment.";
  }

  if (combined.includes("link") || combined.includes("project") || combined.includes("service")) {
    return "Railway project or service is not linked for this workspace.";
  }

  const detail = sanitizeReason(stderr || stdout || errorLike.message);
  return detail.length > 0 ? `Railway CLI log fetch failed: ${detail}` : "Railway CLI log fetch failed for an unknown reason.";
};

const buildMockLines = (): OpsLogLine[] => [
  {
    timestamp: "2026-05-14T00:01:00.000Z",
    level: "info",
    message: "[BOOT] lootcardchoose route-debug-v2-force-deploy",
  },
  {
    timestamp: "2026-05-14T00:01:02.000Z",
    level: "warn",
    message: "RAILWAY_TOKEN=[REDACTED_EXAMPLE_TOKEN]",
  },
  {
    timestamp: "2026-05-14T00:04:10.000Z",
    level: "warn",
    message: "[LLM INTENT CLASSIFIER] timeout Authorization: Bearer [REDACTED_EXAMPLE_KEY]",
  },
  {
    timestamp: "2026-05-14T00:05:15.000Z",
    level: "error",
    message: "[DISCORD] handler error code=error.generic token=[REDACTED_EXAMPLE_DISCORD_TOKEN]",
  },
  {
    timestamp: "2026-05-14T00:06:20.000Z",
    level: "info",
    message: "[HTTP] server listening port=8080",
  },
];

export const railwayLogService = {
  redactSecrets(lines: OpsLogLine[]): OpsLogLine[] {
    return lines.map((line) => ({
      ...line,
      message: redactSecretLine(line.message),
    }));
  },

  fetchMockLogs(): OpsLogFetchResult {
    const generatedAt = new Date().toISOString();
    const lines = this.redactSecrets(buildMockLines());
    const requestConfig = resolveRailwayLogRequestConfig();
    return {
      health: "mock",
      logSource: "mock",
      fetchStatus: "success",
      generatedAt,
      requestConfig,
      lines,
    };
  },

  async fetchRecentLogs(): Promise<OpsLogFetchResult> {
    const generatedAt = new Date().toISOString();
    const requestConfig = resolveRailwayLogRequestConfig();

    try {
      const { stdout } = await runRailwayLogsCommand(requestConfig);
      const lines = this.redactSecrets(parseRailwayLogs(stdout, generatedAt));

      return {
        health: lines.some((line) => line.level === "warn" || line.level === "error") ? "warning" : "healthy",
        logSource: "railway",
        fetchStatus: "success",
        generatedAt,
        requestConfig,
        lines,
      };
    } catch (error) {
      const failureReason = classifyFailureReason(
        error instanceof Error
          ? {
              message: error.message,
            }
          : {
              message:
                typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
                  ? error.message
                  : "Unknown Railway CLI failure.",
              code:
                typeof error === "object" && error !== null && "code" in error
                  ? (error.code as string | number | null | undefined)
                  : undefined,
              killed:
                typeof error === "object" && error !== null && "killed" in error ? Boolean(error.killed) : false,
              stdout:
                typeof error === "object" && error !== null && "stdout" in error && typeof error.stdout === "string"
                  ? error.stdout
                  : "",
              stderr:
                typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string"
                  ? error.stderr
                  : "",
            }
      );

      return {
        health: "warning",
        logSource: "railway_fallback",
        fetchStatus: "fallback",
        generatedAt,
        failureReason,
        requestConfig,
        lines: [],
      };
    }
  },
};
