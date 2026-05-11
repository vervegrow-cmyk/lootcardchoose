type ShopifyTokenResponse = {
  access_token: string;
  expires_in: number;
};

type ShopifyTokenCache = {
  accessToken: string;
  expiresAt: number;
};

const SHOPIFY_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const resolveShopifyStoreDomain = (): string => {
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN ?? "";
  if (!storeDomain) {
    throw new Error("Missing SHOPIFY_STORE_DOMAIN");
  }
  return storeDomain;
};

const resolveShopifyClientId = (): string => {
  const clientId = process.env.SHOPIFY_CLIENT_ID ?? "";
  if (!clientId) {
    throw new Error("Missing SHOPIFY_CLIENT_ID");
  }
  return clientId;
};

const resolveShopifyClientSecret = (): string => {
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET ?? "";
  if (!clientSecret) {
    throw new Error("Missing SHOPIFY_CLIENT_SECRET");
  }
  return clientSecret;
};

const calculateExpiresAt = (expiresInSeconds: number): number => {
  const now = Date.now();
  return now + expiresInSeconds * 1000;
};

let tokenCache: ShopifyTokenCache | null = null;

const isTokenValid = (cache: ShopifyTokenCache | null): cache is ShopifyTokenCache => {
  if (!cache) {
    return false;
  }
  return cache.expiresAt - SHOPIFY_TOKEN_REFRESH_BUFFER_MS > Date.now();
};

const requestAccessToken = async (): Promise<ShopifyTokenCache> => {
  const storeDomain = resolveShopifyStoreDomain();
  const clientId = resolveShopifyClientId();
  const clientSecret = resolveShopifyClientSecret();

  const response = await fetch(`https://${storeDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Shopify auth request failed: ${response.status} ${payload}`);
  }

  const data = (await response.json()) as ShopifyTokenResponse;
  if (!data.access_token || !data.expires_in) {
    throw new Error("Shopify auth response missing access_token or expires_in");
  }

  return {
    accessToken: data.access_token,
    expiresAt: calculateExpiresAt(data.expires_in),
  };
};

export const shopifyAuthService = {
  async getShopifyAccessToken(): Promise<string> {
    if (isTokenValid(tokenCache)) {
      return tokenCache.accessToken;
    }

    try {
      const cache = await requestAccessToken();
      tokenCache = cache;
      return cache.accessToken;
    } catch (error) {
      tokenCache = null;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Shopify authorization failed: ${message}`);
    }
  },
};
