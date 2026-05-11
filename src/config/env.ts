export type EnvConfig = {
  nodeEnv: string;
  logLevel: string;
  discordBotToken: string;
  databaseUrl: string;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  enableNaturalLanguageSearch: boolean;
  shopifyShopDomain: string;
  shopifyAdminAccessToken: string;
  shopifyApiVersion: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2Bucket: string;
  r2Endpoint: string;
  r2PublicUrl: string;
  enableLootcardChoose: boolean;
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
    shopifyShopDomain: process.env.SHOPIFY_SHOP_DOMAIN ?? "",
    shopifyAdminAccessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? "",
    shopifyApiVersion: process.env.SHOPIFY_API_VERSION ?? "2026-04",
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    r2Bucket: process.env.R2_BUCKET ?? "",
    r2Endpoint: process.env.R2_ENDPOINT ?? "",
    r2PublicUrl: process.env.R2_PUBLIC_URL ?? "",
    enableLootcardChoose: process.env.ENABLE_LOOTCARD_CHOOSE === "true",
  };
};
