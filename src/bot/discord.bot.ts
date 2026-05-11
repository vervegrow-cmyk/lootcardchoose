import { Client, GatewayIntentBits, Message } from "discord.js";
import { buildHermesRegistry } from "../hermes/registry";
import { HermesRouter } from "../hermes/router";
import { loadEnv } from "../config/env";
import { logger } from "../utils/logger";

const isLootcardChooseChannel = (message: Message): boolean => {
  const channelName = message.channel && "name" in message.channel ? message.channel.name : "";
  return channelName === "lootcardchoose";
};

export const DiscordBot = {
  start: async (): Promise<void> => {
    const env = loadEnv();
    if (!env.databaseUrl) {
      logger.warn("[DISCORD] DATABASE_URL missing - bot will start with limited features");
    }
    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    });

    const registry = buildHermesRegistry();
    const router = new HermesRouter(registry);

    client.on("ready", () => {
      logger.info("[DISCORD] bot ready");
    });

    client.on("messageCreate", async (message: Message) => {
      if (message.author.bot) {
        return;
      }

      if (!isLootcardChooseChannel(message)) {
        return;
      }

      logger.info("[DISCORD] message received");
      try {
        const response = await router.handle({
          text: message.content,
          channelId: message.channelId,
          userId: message.author.id,
        });

        if (response.text) {
          await message.reply(response.text);
          if (response.text.startsWith("✅ 为你找到")) {
            logger.info("[DISCORD] gallery cards reply sent");
          } else {
            logger.info("[DISCORD] reply sent");
          }
        }
      } catch (error) {
        logger.error("[DISCORD] handler error", {
          message: error instanceof Error ? error.message : String(error),
        });
        await message.reply("系统处理中出错，请稍后再试。");
      }
    });

    await client.login(env.discordBotToken);
  },
};
