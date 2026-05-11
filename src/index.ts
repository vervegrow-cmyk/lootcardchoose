import express from "express";
import { DiscordBot } from "./bot/discord.bot";

const startHealthServer = (): void => {
  const app = express();
  const port = Number(process.env.PORT || 3000);

  app.get("/", (_request, response) => {
    response.status(200).send("LootCard Choose is running.");
  });

  app.get("/health", (_request, response) => {
    response.status(200).json({ ok: true });
  });

  app.get("/auth/callback", (_request, response) => {
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
