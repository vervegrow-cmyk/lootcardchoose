import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type EnvConfig = {
  nodeEnv: string;
  logLevel: string;
  discordBotToken: string;
  databaseUrl: string;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  enableNaturalLanguageSearch: boolean;
  shopifyStoreDomain: string;
  shopifyClientId: string;
  shopifyClientSecret: string;
  shopifyScopes: string;
  shopifyAppUrl: string;
  shopifyApiVersion: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2Bucket: string;
  r2Endpoint: string;
  r2PublicUrl: string;
  enableLootcardChoose: boolean;
  siliconflowApiKey: string;
  siliconflowBaseUrl: string;
  siliconflowVisionModel: string;
  enableGalleryVisionMetadata: boolean;
  railwayLogSince: string;
  railwayLogLines: number;
  railwayLogTimeoutMs: number;
  railwayLogService: string;
  railwayLogEnvironment: string;
};

const DEFAULT_RAILWAY_LOG_SINCE = "24h";
const DEFAULT_RAILWAY_LOG_LINES = 1000;
const MAX_RAILWAY_LOG_LINES = 5000;
const DEFAULT_RAILWAY_LOG_TIMEOUT_MS = 30000;
const MAX_RAILWAY_LOG_TIMEOUT_MS = 120000;

const clampNumber = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);

const parseOptionalString = (value: string | undefined): string => (value ?? "").trim();

const parsePositiveInteger = (value: string | undefined, fallback: number, maximum: number): number => {
  const trimmed = parseOptionalString(value);
  if (trimmed.length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return clampNumber(parsed, 1, maximum);
};

let hasLoadedEnvFiles = false;

const parseEnvValue = (value: string): string => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const loadEnvFile = (filePath: string): void => {
  if (!existsSync(filePath)) {
    return;
  }

  const contents = readFileSync(filePath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = parseEnvValue(line.slice(separatorIndex + 1));
    if (!key || process.env[key] != null) {
      continue;
    }

    process.env[key] = value;
  }
};

const ensureEnvLoaded = (): void => {
  if (hasLoadedEnvFiles) {
    return;
  }

  const cwd = process.cwd();
  loadEnvFile(path.resolve(cwd, ".env"));
  loadEnvFile(path.resolve(cwd, ".env.local"));
  hasLoadedEnvFiles = true;
};

export const loadEnv = (): EnvConfig => {
  ensureEnvLoaded();

  const deepseekApiKey = process.env.DEEPSEEK_API_KEY ?? process.env.SILICONFLOW_API_KEY ?? "";
  const deepseekBaseUrl =
    process.env.DEEPSEEK_BASE_URL ?? process.env.SILICONFLOW_BASE_URL ?? "https://api.deepseek.com/v1";
  const deepseekModel = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  const railwayLogSince = parseOptionalString(process.env.RAILWAY_LOG_SINCE) || DEFAULT_RAILWAY_LOG_SINCE;
  const railwayLogLines = parsePositiveInteger(
    process.env.RAILWAY_LOG_LINES,
    DEFAULT_RAILWAY_LOG_LINES,
    MAX_RAILWAY_LOG_LINES
  );
  const railwayLogTimeoutMs = parsePositiveInteger(
    process.env.RAILWAY_LOG_TIMEOUT_MS,
    DEFAULT_RAILWAY_LOG_TIMEOUT_MS,
    MAX_RAILWAY_LOG_TIMEOUT_MS
  );
  const railwayLogService = parseOptionalString(process.env.RAILWAY_LOG_SERVICE);
  const railwayLogEnvironment = parseOptionalString(process.env.RAILWAY_LOG_ENVIRONMENT);

  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    logLevel: process.env.LOG_LEVEL ?? "info",
    discordBotToken: process.env.DISCORD_BOT_TOKEN ?? "",
    databaseUrl: process.env.DATABASE_URL ?? "",
    deepseekApiKey,
    deepseekBaseUrl,
    deepseekModel,
    enableNaturalLanguageSearch: process.env.ENABLE_NATURAL_LANGUAGE_SEARCH === "true",
    shopifyStoreDomain: process.env.SHOPIFY_STORE_DOMAIN ?? "",
    shopifyClientId: process.env.SHOPIFY_CLIENT_ID ?? "",
    shopifyClientSecret: process.env.SHOPIFY_CLIENT_SECRET ?? "",
    shopifyScopes: process.env.SHOPIFY_SCOPES ?? "",
    shopifyAppUrl: process.env.SHOPIFY_APP_URL ?? "",
    shopifyApiVersion: process.env.SHOPIFY_API_VERSION ?? "2026-04",
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    r2Bucket: process.env.R2_BUCKET ?? "",
    r2Endpoint: process.env.R2_ENDPOINT ?? "",
    r2PublicUrl: process.env.R2_PUBLIC_URL ?? "",
    enableLootcardChoose: process.env.ENABLE_LOOTCARD_CHOOSE === "true",
    siliconflowApiKey: process.env.SILICONFLOW_API_KEY ?? "",
    siliconflowBaseUrl: process.env.SILICONFLOW_BASE_URL ?? "https://api.siliconflow.cn/v1",
    siliconflowVisionModel: process.env.SILICONFLOW_VISION_MODEL ?? "Qwen/Qwen3-VL-8B-Instruct",
    enableGalleryVisionMetadata: process.env.ENABLE_GALLERY_VISION_METADATA !== "false",
    railwayLogSince,
    railwayLogLines,
    railwayLogTimeoutMs,
    railwayLogService,
    railwayLogEnvironment,
  };
};
