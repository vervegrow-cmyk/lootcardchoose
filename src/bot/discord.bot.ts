import { Client, EmbedBuilder, GatewayIntentBits, Message, Partials } from "discord.js";
import { loadEnv } from "../config/env";
import {
  HermesGalleryCheckoutCreatedOutput,
  HermesGallerySearchResultsOutput,
  HermesOutput,
  SupportedLanguage,
} from "../hermes/types";
import { buildHermesRegistry } from "../hermes/registry";
import { HermesRouter } from "../hermes/router";
import { discordNotificationService } from "../services/discord-notification.service";
import { buildGalleryResultsEmbeds } from "../utils/embeds";
import { t } from "../utils/i18n";
import { logger } from "../utils/logger";
import { isUserFacingError } from "../utils/user-facing-error";

type DiscordIgnoreReason = "bot_message" | "empty_content";

type DiscordMessageHandlingDecision = {
  shouldHandle: boolean;
  reason?: DiscordIgnoreReason;
  channelName: string;
  mentioned: boolean;
  normalizedText: string;
  isDM: boolean;
};

const getChannelName = (message: Message): string =>
  message.channel && "name" in message.channel && typeof message.channel.name === "string" ? message.channel.name : "";

const buildMentionRegex = (botUserId: string): RegExp => new RegExp(`<@!?${botUserId}>`, "g");

const normalizeDiscordMessageContent = (content: string, botUserId: string | null): string => {
  const withoutMentions = botUserId ? content.replace(buildMentionRegex(botUserId), " ") : content;
  return withoutMentions.replace(/\s+/g, " ").trim();
};

const shouldHandleDiscordMessage = (message: Message, botUserId: string | null): DiscordMessageHandlingDecision => {
  const channelName = getChannelName(message);
  const mentioned = botUserId
    ? message.mentions.users.has(botUserId) || buildMentionRegex(botUserId).test(message.content)
    : false;
  const normalizedText = normalizeDiscordMessageContent(message.content, botUserId);
  const isDM = !message.guildId;

  if (message.author.bot) {
    return {
      shouldHandle: false,
      reason: "bot_message",
      channelName,
      mentioned,
      normalizedText,
      isDM,
    };
  }

  if (!normalizedText) {
    return {
      shouldHandle: false,
      reason: "empty_content",
      channelName,
      mentioned,
      normalizedText,
      isDM,
    };
  }

  return {
    shouldHandle: true,
    channelName,
    mentioned,
    normalizedText,
    isDM,
  };
};

const extractDiscordApiCode = (error: unknown): string | number | null => {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }

  const code = (error as { code?: string | number }).code;
  return typeof code === "string" || typeof code === "number" ? code : null;
};

const resolveCheckoutProductCode = (response: HermesGalleryCheckoutCreatedOutput): string | null =>
  response.metadata && typeof response.metadata.productCode === "string" ? response.metadata.productCode : null;

export const buildSearchFallbackText = (response: HermesGallerySearchResultsOutput): string => {
  const cardLines = response.cards.slice(0, 10).map((card, index) => {
    const priceLine = response.language === "zh" ? `价格: $${card.price.toFixed(2)}` : `Price: $${card.price.toFixed(2)}`;
    return `${index + 1}. ${card.title}\n${priceLine}\n${card.imageUrl}`;
  });

  return [response.text, ...cardLines, response.selectionPrompt].join("\n\n");
};

export const buildCheckoutFallbackText = (response: HermesGalleryCheckoutCreatedOutput): string => {
  const viewLabel = response.language === "zh" ? "查看与分享" : "View & share";
  const buyLabel = response.language === "zh" ? "立即购买" : "Buy now";
  const codeLabel = response.language === "zh" ? "编号" : "Code";
  const priceLabel = response.language === "zh" ? "价格" : "Price";
  const productCode = resolveCheckoutProductCode(response);

  return [
    response.text,
    response.title,
    ...(productCode ? [`${codeLabel}: ${productCode}`] : []),
    `${priceLabel}: $${response.price}`,
    `${viewLabel}: ${response.productUrl}`,
    `${buyLabel}: ${response.purchaseUrl}`,
    response.shareImageUrl,
  ].join("\n");
};

const sendTypingIndicator = async (message: Message): Promise<void> => {
  if (!("sendTyping" in message.channel) || typeof message.channel.sendTyping !== "function") {
    return;
  }

  try {
    logger.info("[DISCORD] send typing", {
      userId: message.author.id,
      channelId: message.channelId,
    });
    await message.channel.sendTyping();
  } catch (error) {
    logger.warn("[DISCORD] send typing failed", {
      userId: message.author.id,
      channelId: message.channelId,
      message: error instanceof Error ? error.message : String(error),
      discordApiCode: extractDiscordApiCode(error),
    });
  }
};

export const replyWithFallback = async (
  message: Message,
  primaryReply: () => Promise<void>,
  fallbackText: string,
  metadata: {
    responseType: HermesOutput["type"];
    orderNumber?: string;
    cardCount?: number;
    productUrl?: string;
    purchaseUrl?: string;
    startAt: number;
  }
): Promise<void> => {
  try {
    await primaryReply();
    logger.info("[DISCORD] reply sent", {
      userId: message.author.id,
      channelId: message.channelId,
      responseType: metadata.responseType,
      cardCount: metadata.cardCount,
      orderNumber: metadata.orderNumber,
      productUrl: metadata.productUrl,
      purchaseUrl: metadata.purchaseUrl,
      latencyMs: Date.now() - metadata.startAt,
    });
  } catch (error) {
    logger.error("[DISCORD] primary reply failed", {
      userId: message.author.id,
      channelId: message.channelId,
      responseType: metadata.responseType,
      orderNumber: metadata.orderNumber,
      cardCount: metadata.cardCount,
      productUrl: metadata.productUrl,
      purchaseUrl: metadata.purchaseUrl,
      latencyMs: Date.now() - metadata.startAt,
      stage: "discord_reply",
      message: error instanceof Error ? error.message : String(error),
      discordApiCode: extractDiscordApiCode(error),
    });

    await message.reply(fallbackText);
    logger.info("[DISCORD] fallback reply sent", {
      userId: message.author.id,
      channelId: message.channelId,
      responseType: metadata.responseType,
      latencyMs: Date.now() - metadata.startAt,
    });
  }
};

const buildCheckoutEmbed = (response: HermesGalleryCheckoutCreatedOutput): EmbedBuilder => {
  const productCode = resolveCheckoutProductCode(response);
  const codeLabel = response.language === "zh" ? "编号" : "Code";
  const viewLabel = response.language === "zh" ? "查看与分享" : "View & share";
  const buyLabel = response.language === "zh" ? "立即购买" : "Buy now";
  const priceLabel = response.language === "zh" ? "价格" : "Price";

  return new EmbedBuilder()
    .setTitle(response.title)
    .setDescription(productCode ? `${response.text}\n\n${codeLabel}: ${productCode}` : response.text)
    .setImage(response.shareImageUrl)
    .addFields(
      {
        name: viewLabel,
        value: response.productUrl,
      },
      {
        name: buyLabel,
        value: response.purchaseUrl,
      },
      {
        name: priceLabel,
        value: `$${response.price}`,
        inline: true,
      }
    );
};

export const DiscordBot = {
  start: async (): Promise<void> => {
    const env = loadEnv();
    logger.info("[DISCORD] starting bot");

    if (!env.discordBotToken.trim()) {
      logger.error("[DISCORD] token missing", {
        envKey: "DISCORD_BOT_TOKEN",
      });
      return;
    }

    if (!env.databaseUrl) {
      logger.warn("[DISCORD] DATABASE_URL missing - bot will start with limited features");
    }
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });
    discordNotificationService.registerClient(client);

    const registry = buildHermesRegistry();
    const router = new HermesRouter(registry);

    client.on("clientReady", () => {
      logger.info("[DISCORD] bot ready");
    });

    client.on("error", (error) => {
      logger.error("[DISCORD] client error", {
        message: error instanceof Error ? error.message : String(error),
      });
    });

    client.on("shardError", (error) => {
      logger.error("[DISCORD] shard error", {
        message: error instanceof Error ? error.message : String(error),
      });
    });

    client.on("messageCreate", async (message: Message) => {
      const handlingDecision = shouldHandleDiscordMessage(message, client.user?.id ?? null);

      if (!handlingDecision.shouldHandle) {
        logger.info("[DISCORD] message ignored", {
          userId: message.author.id,
          channelId: message.channelId,
          channelName: handlingDecision.channelName,
          isDM: handlingDecision.isDM,
          mentioned: handlingDecision.mentioned,
          reason: handlingDecision.reason,
          rawContent: message.content,
          normalizedContent: handlingDecision.normalizedText,
        });
        return;
      }

      logger.info("[DISCORD] message received", {
        userId: message.author.id,
        channelId: message.channelId,
        channelName: handlingDecision.channelName,
        isDM: handlingDecision.isDM,
        mentioned: handlingDecision.mentioned,
        rawContent: message.content,
        normalizedContent: handlingDecision.normalizedText,
      });

      const startedAt = Date.now();
      let stage = "typing";

      try {
        await sendTypingIndicator(message);

        stage = "router.handle";
        const response = await router.handle({
          text: handlingDecision.normalizedText,
          channelId: message.channelId,
          channelName: handlingDecision.isDM ? null : handlingDecision.channelName,
          discordGuildId: message.guildId ?? null,
          isDM: handlingDecision.isDM,
          userId: message.author.id,
        });

        if (!response.text) {
          return;
        }

        if (response.type === "gallery_search_results") {
          stage = "reply.gallery_search_results";
          const embeds = buildGalleryResultsEmbeds(response.language, response.cards).map((embed) => {
            const builder = new EmbedBuilder();
            if (embed.title) {
              builder.setTitle(embed.title);
            }
            if (embed.description) {
              builder.setDescription(embed.description);
            }
            if (embed.thumbnailUrl) {
              builder.setThumbnail(embed.thumbnailUrl);
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

          await replyWithFallback(
            message,
            async () => {
              await message.reply({
                content: `${response.text}\n${response.selectionPrompt}`,
                embeds,
              });
            },
            buildSearchFallbackText(response),
            {
              responseType: response.type,
              cardCount: response.cards.length,
              startAt: startedAt,
            }
          );
          return;
        }

        if (response.type === "gallery_checkout_created") {
          stage = "reply.gallery_checkout_created";
          await replyWithFallback(
            message,
            async () => {
              await message.reply({
                content: response.text,
                embeds: [buildCheckoutEmbed(response)],
              });
            },
            buildCheckoutFallbackText(response),
            {
              responseType: response.type,
              orderNumber: response.orderNumber,
              productUrl: response.productUrl,
              purchaseUrl: response.purchaseUrl,
              startAt: startedAt,
            }
          );
          return;
        }

        stage = "reply.text";
        await message.reply(response.text);
        logger.info("[DISCORD] reply sent", {
          userId: message.author.id,
          channelId: message.channelId,
          responseType: response.type,
          latencyMs: Date.now() - startedAt,
        });
      } catch (error) {
        const language: SupportedLanguage = /[\u4e00-\u9fff]/.test(handlingDecision.normalizedText) ? "zh" : "en";
        const fallbackText = isUserFacingError(error) ? error.message : t(language, "error.generic");

        logger.error("[DISCORD] handler error", {
          userId: message.author.id,
          channelId: message.channelId,
          stage: isUserFacingError(error) ? error.stage : stage,
          code: isUserFacingError(error) ? error.code : "error.generic",
          message: error instanceof Error ? error.message : String(error),
          discordApiCode: extractDiscordApiCode(error),
          latencyMs: Date.now() - startedAt,
        });

        try {
          await message.reply(fallbackText);
        } catch (replyError) {
          logger.error("[DISCORD] fallback reply failed", {
            userId: message.author.id,
            channelId: message.channelId,
            stage: "discord_reply",
            message: replyError instanceof Error ? replyError.message : String(replyError),
            discordApiCode: extractDiscordApiCode(replyError),
            latencyMs: Date.now() - startedAt,
          });
        }
      }
    });

    try {
      await client.login(env.discordBotToken);
    } catch (error) {
      logger.error("[DISCORD] login failed", {
        message: error instanceof Error ? error.message : String(error),
        discordApiCode: extractDiscordApiCode(error),
      });
      throw error;
    }
  },
};
