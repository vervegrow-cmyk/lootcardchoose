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
};

export const loadEnv = (): EnvConfig => {
  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    logLevel: process.env.LOG_LEVEL ?? "info",
    discordBotToken: process.env.DISCORD_BOT_TOKEN ?? "",
    databaseUrl: process.env.DATABASE_URL ?? "",
    deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
    deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
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
    enableGalleryVisionMetadata: process.env.ENABLE_GALLERY_VISION_METADATA === "true",
  };
};
