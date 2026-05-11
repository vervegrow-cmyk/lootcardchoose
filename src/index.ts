import crypto from "crypto";
import express, { Request, Response } from "express";
import { DiscordBot } from "./bot/discord.bot";
import { shopifyInstallationService } from "./services/shopify-installation.service";

type ShopifyAccessTokenResponse = {
  access_token: string;
  scope?: string;
};

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

const buildAuthState = (): string => crypto.randomBytes(16).toString("hex");

let latestAuthState: string | null = null;

const startHealthServer = (): void => {
  const app = express();
  const port = Number(process.env.PORT || 3000);

  app.get("/", async (_request: Request, response: Response) => {
    try {
      await shopifyInstallationService.getAccessTokenForStore();
      response.status(200).send("LootCard Choose is running.");
    } catch (error) {
      const shop = resolveShopifyStoreDomain();
      const clientId = resolveShopifyClientId();
      const state = buildAuthState();
      latestAuthState = state;
      const redirectUri =
        "https://lootcardchoose-production.up.railway.app/auth/callback";
      const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("scope", "read_products,write_products");
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("state", state);
      response.redirect(authUrl.toString());
      void error;
    }
  });

  app.get("/health", (_request: Request, response: Response) => {
    response.status(200).json({ ok: true });
  });

  app.get("/auth/callback", async (request: Request, response: Response) => {
    const shop = String(request.query.shop ?? "");
    const code = String(request.query.code ?? "");
    const state = String(request.query.state ?? "");
    if (!shop || !code) {
      response.status(400).send("Missing shop or code.");
      return;
    }
    if (!state || !latestAuthState || state !== latestAuthState) {
      response.status(400).send("Invalid state.");
      return;
    }

    const clientId = resolveShopifyClientId();
    const clientSecret = resolveShopifyClientSecret();

    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    if (!tokenResponse.ok) {
      const payload = await tokenResponse.text();
      response.status(400).send(`Shopify auth failed: ${payload}`);
      return;
    }

    const data = (await tokenResponse.json()) as ShopifyAccessTokenResponse;
    if (!data.access_token) {
      response.status(400).send("Shopify access token missing.");
      return;
    }

    await shopifyInstallationService.saveInstallation({
      shop,
      accessToken: data.access_token,
      scope: data.scope ?? null,
    });

    latestAuthState = null;
    response.status(200).send("Shopify callback received.");
  });

  app.listen(port, "0.0.0.0", () => {
    console.log(`[HTTP] server listening port=${port}`);
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
