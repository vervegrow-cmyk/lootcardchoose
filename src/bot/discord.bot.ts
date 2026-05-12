import { Client, EmbedBuilder, GatewayIntentBits, Message } from "discord.js";
import { loadEnv } from "../config/env";
import { buildHermesRegistry } from "../hermes/registry";
import { HermesRouter } from "../hermes/router";
import { discordNotificationService } from "../services/discord-notification.service";
import { buildGalleryResultsEmbeds } from "../utils/embeds";
import { t } from "../utils/i18n";
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
    discordNotificationService.registerClient(client);

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

        if (!response.text) {
          return;
        }

        if (response.type === "gallery_search_results") {
          const embeds = buildGalleryResultsEmbeds(response.language, response.cards).map((embed) => {
            const builder = new EmbedBuilder();
            if (embed.title) {
              builder.setTitle(embed.title);
            }
            if (embed.description) {
              builder.setDescription(embed.description);
            }
            if (embed.imageUrl) {
              builder.setImage(embed.imageUrl);
            }
            if (embed.fields && embed.fields.length > 0) {
              builder.addFields(
                embed.fields.map((field) => ({
                  name: field.name,
                  value: field.value,
                  inline: field.inline ?? false,
                }))
              );
            }
            return builder;
          });

          await message.reply({
            content: `${response.text}\n${response.selectionPrompt}`,
            embeds,
          });
          logger.info("[DISCORD] gallery cards reply sent");
          return;
        }

        await message.reply(response.text);
        logger.info("[DISCORD] reply sent");
      } catch (error) {
        logger.error("[DISCORD] handler error", {
          message: error instanceof Error ? error.message : String(error),
        });
        await message.reply(t("en", "error.generic"));
      }
    });

    await client.login(env.discordBotToken);
  },
};
