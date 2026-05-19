import { readFile } from "node:fs/promises";
import path from "node:path";

type RuntimeLogSummary = {
  file: string;
  totalLines: number;
  parserNetworkErrors: number;
  wrongChannelDenied: number;
  wrongChannelByKey: Record<string, number>;
  sigtermCount: number;
  replySentCount: number;
  replyFailedCount: number;
  staleSessionClears: number;
};

const DEFAULT_FILE = path.resolve(process.cwd(), "reports", "runtime.log");

const parseArgs = (argv: string[]): { file: string } => {
  const fileIndex = argv.indexOf("--file");
  if (fileIndex >= 0 && argv[fileIndex + 1]) {
    return { file: path.resolve(argv[fileIndex + 1]) };
  }

  return { file: DEFAULT_FILE };
};

const increment = (map: Map<string, number>, key: string): void => {
  map.set(key, (map.get(key) ?? 0) + 1);
};

const extractJsonObject = (line: string): Record<string, unknown> | null => {
  const firstBrace = line.indexOf("{");
  const lastBrace = line.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(line.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  const content = await readFile(options.file, "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  const wrongChannelByKey = new Map<string, number>();

  let parserNetworkErrors = 0;
  let wrongChannelDenied = 0;
  let sigtermCount = 0;
  let replySentCount = 0;
  let replyFailedCount = 0;
  let staleSessionClears = 0;

  for (const line of lines) {
    if (line.includes("[LLM QUERY PARSER] fallback") && line.includes('"reason":"network_error"')) {
      parserNetworkErrors += 1;
    }

    if (line.includes("[HERMES ROUTER] channel denied") && line.includes('"reason":"legacy_wrong_channel"')) {
      wrongChannelDenied += 1;
      const payload = extractJsonObject(line);
      const guildId = String(payload?.discordGuildId ?? "unknown_guild");
      const channelName = String(payload?.channelName ?? "unknown_channel");
      increment(wrongChannelByKey, `${guildId}:${channelName}`);
    }

    if (line.includes("npm error signal SIGTERM")) {
      sigtermCount += 1;
    }

    if (line.includes("[DISCORD] reply sent")) {
      replySentCount += 1;
    }

    if (line.includes("[DISCORD] fallback reply failed") || line.includes("[DISCORD] primary reply failed")) {
      replyFailedCount += 1;
    }

    if (line.includes("[SEARCH GALLERY SKILL] zero-result search cleared active sessions")) {
      staleSessionClears += 1;
    }
  }

  const summary: RuntimeLogSummary = {
    file: options.file,
    totalLines: lines.length,
    parserNetworkErrors,
    wrongChannelDenied,
    wrongChannelByKey: Object.fromEntries(
      [...wrongChannelByKey.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    ),
    sigtermCount,
    replySentCount,
    replyFailedCount,
    staleSessionClears,
  };

  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error("[ANALYZE RUNTIME LOG] failed", error);
  process.exit(1);
});
