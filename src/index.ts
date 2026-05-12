import crypto from "crypto";
import express, { Request, Response } from "express";
import { DiscordBot } from "./bot/discord.bot";
import { isDatabaseReady } from "./services/prisma.service";
import { shopifyInstallationService } from "./services/shopify-installation.service";
import { shopifyWebhookService } from "./services/shopify-webhook.service";

console.log("[BOOT] lootcardchoose search-fix-v3 038e643");

type ShopifyAccessTokenResponse = {
  access_token?: string;
  scope?: string;
};

const oauthStateStore = new Map<string, number>();
const SHOPIFY_STATE_TTL_MS = 10 * 60 * 1000;

const resolveEnv = (key: string): string => {
  const value = process.env[key] ?? "";
  if (!value) {
    throw new Error(`Missing ${key}`);
  }
  return value;
};

const resolveShopifyClientId = (): string => resolveEnv("SHOPIFY_CLIENT_ID");
const resolveShopifyClientSecret = (): string => resolveEnv("SHOPIFY_CLIENT_SECRET");
const resolveShopifyScopes = (): string => resolveEnv("SHOPIFY_SCOPES");
const resolveShopifyAppUrl = (): string => resolveEnv("SHOPIFY_APP_URL").replace(/\/+$/, "");
const resolveDefaultShop = (): string => resolveEnv("SHOPIFY_STORE_DOMAIN");

const isValidShopDomain = (shop: string): boolean =>
  /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);

const buildAuthState = (): string => crypto.randomBytes(16).toString("hex");

const cleanupExpiredStates = (): void => {
  const now = Date.now();
  for (const [state, createdAt] of oauthStateStore.entries()) {
    if (now - createdAt > SHOPIFY_STATE_TTL_MS) {
      oauthStateStore.delete(state);
    }
  }
};

const rememberState = (state: string): void => {
  cleanupExpiredStates();
  oauthStateStore.set(state, Date.now());
};

const consumeState = (state: string): boolean => {
  cleanupExpiredStates();
  const createdAt = oauthStateStore.get(state);
  if (!createdAt) {
    return false;
  }
  oauthStateStore.delete(state);
  return Date.now() - createdAt <= SHOPIFY_STATE_TTL_MS;
};

const getSingleQueryValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return String(value[0] ?? "");
  }
  return typeof value === "string" ? value : "";
};

const buildHmacMessage = (query: Request["query"]): string => {
  return Object.keys(query)
    .filter((key) => key !== "hmac" && key !== "signature")
    .sort()
    .map((key) => `${key}=${getSingleQueryValue(query[key])}`)
    .join("&");
};

const computeHmacDigest = (query: Request["query"]): { message: string; digest: string } => {
  const secret = resolveShopifyClientSecret();
  const message = buildHmacMessage(query);
  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");
  return { message, digest };
};

const isValidHmac = (query: Request["query"], providedHmac: string): boolean => {
  const { digest } = computeHmacDigest(query);
  const left = Buffer.from(digest, "utf8");
  const right = Buffer.from(providedHmac, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
};

const buildAuthorizeUrl = (shop: string, state: string): string => {
  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authUrl.searchParams.set("client_id", resolveShopifyClientId());
  authUrl.searchParams.set("scope", resolveShopifyScopes());
  authUrl.searchParams.set("redirect_uri", `${resolveShopifyAppUrl()}/auth/callback`);
  authUrl.searchParams.set("state", state);
  return authUrl.toString();
};

const exchangeCodeForAccessToken = async (
  shop: string,
  code: string
): Promise<{ accessToken: string; scope: string | null }> => {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: resolveShopifyClientId(),
      client_secret: resolveShopifyClientSecret(),
      code,
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    console.error("[SHOPIFY OAUTH] token exchange error", {
      shop,
      status: response.status,
      payload,
    });
    throw new Error(`Shopify token exchange failed: ${response.status} ${payload}`);
  }

  const data = (await response.json()) as ShopifyAccessTokenResponse;
  console.log("[SHOPIFY OAUTH] token exchange success", {
    shop,
    scope: data.scope ?? null,
    hasAccessToken: Boolean(data.access_token),
  });
  if (!data.access_token) {
    throw new Error("Shopify token exchange response missing access_token");
  }

  return {
    accessToken: data.access_token,
    scope: data.scope ?? null,
  };
};

const sendHtml = (response: Response, title: string, body: string): void => {
  response.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body>
    <h1>${title}</h1>
    <p>${body}</p>
  </body>
</html>`);
};

const startHealthServer = (): void => {
  const app = express();

  app.get("/", (_request: Request, response: Response) => {
    response.status(200).send("LootCard Choose is running.");
  });

  app.get("/health", (_request: Request, response: Response) => {
    response.status(200).json({ ok: true });
  });

  app.post("/webhooks/shopify/orders-paid", express.raw({ type: "application/json" }), async (request, response) => {
    try {
      const topic = request.header("x-shopify-topic") ?? "";
      const providedHmac = request.header("x-shopify-hmac-sha256") ?? "";
      const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.from([]);
      console.log("[SHOPIFY WEBHOOK] route hit", {
        topic,
        hmacExists: Boolean(providedHmac),
        rawBodyLength: rawBody.length,
      });

      if (!providedHmac || !shopifyWebhookService.verifyOrdersPaidWebhook(rawBody, providedHmac)) {
        console.warn("[SHOPIFY WEBHOOK] hmac failed", {
          topic,
          hmacExists: Boolean(providedHmac),
          rawBodyLength: rawBody.length,
        });
        response.status(401).json({ ok: false, error: "Invalid Shopify webhook hmac" });
        return;
      }

      console.log("[SHOPIFY WEBHOOK] hmac verified", {
        topic,
        rawBodyLength: rawBody.length,
      });
      const result = await shopifyWebhookService.handleOrdersPaidWebhook(rawBody);
      response.status(200).json({ ok: true, orderNumber: result.orderNumber, status: result.status });
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/install", (request: Request, response: Response) => {
    try {
      const requestedShop = getSingleQueryValue(request.query.shop) || resolveDefaultShop();
      const shop = requestedShop.trim().toLowerCase();

      if (!isValidShopDomain(shop)) {
        response.status(400).json({ ok: false, error: "Invalid shop domain" });
        return;
      }

      const state = buildAuthState();
      rememberState(state);
      response.redirect(buildAuthorizeUrl(shop, state));
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/auth/callback", async (request: Request, response: Response) => {
    try {
      if (!isDatabaseReady()) {
        response.status(500).json({ ok: false, error: "DATABASE_URL is not configured" });
        return;
      }

      const shop = getSingleQueryValue(request.query.shop).trim().toLowerCase();
      const code = getSingleQueryValue(request.query.code);
      const state = getSingleQueryValue(request.query.state);
      const hmac = getSingleQueryValue(request.query.hmac);
      const timestamp = getSingleQueryValue(request.query.timestamp);

      if (!shop || !code || !state || !hmac || !timestamp) {
        response.status(400).json({ ok: false, error: "Missing required OAuth callback params" });
        return;
      }

      if (!isValidShopDomain(shop)) {
        response.status(400).json({ ok: false, error: "Invalid shop domain" });
        return;
      }

      if (!consumeState(state)) {
        response.status(400).json({ ok: false, error: "Invalid or expired state" });
        return;
      }

      const { message, digest } = computeHmacDigest(request.query);
      const hmacValid = isValidHmac(request.query, hmac);
      console.log("[SHOPIFY OAUTH] hmac validation", {
        shop,
        state,
        timestamp,
        message,
        providedHmac: hmac,
        computedHmac: digest,
        valid: hmacValid,
      });

      if (!hmacValid) {
        response.status(400).json({ ok: false, error: "Invalid hmac" });
        return;
      }

      const token = await exchangeCodeForAccessToken(shop, code);

      try {
        await shopifyInstallationService.saveInstallation({
          shop,
          accessToken: token.accessToken,
          scope: token.scope,
        });
      } catch (saveError) {
        console.error("[SHOPIFY OAUTH] prisma save error", {
          shop,
          message: saveError instanceof Error ? saveError.message : String(saveError),
          stack: saveError instanceof Error ? saveError.stack : undefined,
        });
        throw saveError;
      }

      sendHtml(response, "Shopify app installed", `Installation succeeded for ${shop}.`);
    } catch (error) {
      console.error("[SHOPIFY OAUTH] callback error", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/shopify/status", async (_request: Request, response: Response) => {
    try {
      const shop = resolveDefaultShop();
      const installed = await shopifyInstallationService.isStoreInstalled(shop);
      response.status(200).json({
        ok: true,
        shop,
        installed,
      });
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.listen(Number(process.env.PORT || 3000), "0.0.0.0", () => {
    console.log(`[HTTP] server listening port=${process.env.PORT || 3000}`);
  });
};

const main = async (): Promise<void> => {
  startHealthServer();
  await DiscordBot.start();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
