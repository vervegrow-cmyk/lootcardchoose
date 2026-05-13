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

    client.on("clientReady", () => {
      logger.info("[DISCORD] bot ready");
    });

    client.on("messageCreate", async (message: Message) => {
      if (message.author.bot) {
        return;
      }

      if (!isLootcardChooseChannel(message)) {
        return;
      }

      logger.info("[DISCORD] message received", {
        userId: message.author.id,
        channelId: message.channelId,
        content: message.content,
      });
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
          logger.info("[DISCORD] gallery cards reply sent", {
            userId: message.author.id,
            channelId: message.channelId,
            cardCount: response.cards.length,
            responseType: response.type,
          });
          return;
        }

        if (response.type === "gallery_checkout_created") {
          const embed = new EmbedBuilder()
            .setTitle(response.title)
            .setDescription(response.text)
            .setImage(response.shareImageUrl)
            .addFields(
              {
                name: response.language === "zh" ? "查看与分享" : "View & share",
                value: response.productUrl,
              },
              {
                name: response.language === "zh" ? "立即购买" : "Buy now",
                value: response.purchaseUrl,
              },
              {
                name: response.language === "zh" ? "价格" : "Price",
                value: `$${response.price}`,
                inline: true,
              },
              {
                name: response.language === "zh" ? "订单号" : "Order",
                value: response.orderNumber,
                inline: true,
              }
            );

          await message.reply({
            content: response.text,
            embeds: [embed],
          });
          logger.info("[DISCORD] checkout reply sent", {
            userId: message.author.id,
            channelId: message.channelId,
            orderNumber: response.orderNumber,
            productUrl: response.productUrl,
            purchaseUrl: response.purchaseUrl,
            responseType: response.type,
          });
          return;
        }

        await message.reply(response.text);
        logger.info("[DISCORD] reply sent", {
          userId: message.author.id,
          channelId: message.channelId,
          responseType: response.type,
        });
      } catch (error) {
        const language = /[\u4e00-\u9fff]/.test(message.content) ? "zh" : "en";
        logger.error("[DISCORD] handler error", {
          userId: message.author.id,
          channelId: message.channelId,
          message: error instanceof Error ? error.message : String(error),
        });
        await message.reply(t(language, "error.generic"));
      }
    });

    await client.login(env.discordBotToken);
  },
};
