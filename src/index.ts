import express, { Request, Response } from "express";
import { DiscordBot } from "./bot/discord.bot";

console.log("[BOOT] lootcardchoose source-start-v1");

const startHealthServer = (): void => {
  const app = express();

  app.get("/", (_request: Request, response: Response) => {
    response.status(200).send("LootCard Choose is running.");
  });

  app.get("/health", (_request: Request, response: Response) => {
    response.status(200).json({ ok: true });
  });

  app.get("/auth/callback", (_request: Request, response: Response) => {
    response.status(200).send("Shopify callback received.");
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
