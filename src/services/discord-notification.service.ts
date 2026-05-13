import { Client } from "discord.js";
import { SupportedLanguage } from "../hermes/types";
import {
  GallerySearchSessionRecord,
  gallerySearchSessionRepository,
} from "../repositories/gallery-search-session.repository";
import { t } from "../utils/i18n";
import { logger } from "../utils/logger";

let discordClient: Client | null = null;

const hasSend = (value: unknown): value is { send: (message: string) => Promise<unknown> } =>
  typeof value === "object" && value !== null && "send" in value && typeof value.send === "function";

const detectLanguageFromQuery = (query: string): SupportedLanguage | null => {
  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }

  return /[\u4e00-\u9fff]/.test(trimmed) ? "zh" : "en";
};

const resolveSessionLanguage = (session: GallerySearchSessionRecord | null): SupportedLanguage | null => {
  if (!session) {
    return null;
  }

  if (Array.isArray(session.results)) {
    for (const entry of session.results) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        "language" in entry &&
        (((entry as { language?: unknown }).language as unknown) === "zh" ||
          ((entry as { language?: unknown }).language as unknown) === "en")
      ) {
        return (entry as { language: SupportedLanguage }).language;
      }
    }
  }

  return detectLanguageFromQuery(session.query);
};

const buildPaidOrderMessage = (
  language: SupportedLanguage,
  input: {
    orderNumber: string;
    amount: string;
  }
): string =>
  [
    t(language, "order.paid.title"),
    "",
    t(language, "order.paid.number", { orderNumber: input.orderNumber }),
    t(language, "order.paid.amount", { amount: input.amount }),
  ].join("\n");

export const discordNotificationService = {
  registerClient(client: Client): void {
    discordClient = client;
  },
  async notifyOrderPaid(input: {
    discordUserId: string;
    orderNumber: string;
    amount: string;
    language?: SupportedLanguage | null;
  }): Promise<void> {
    if (!discordClient) {
      logger.warn("[DISCORD NOTIFICATION] client not ready for paid notification", {
        orderNumber: input.orderNumber,
      });
      return;
    }

    let latestSession: GallerySearchSessionRecord | null = null;
    try {
      latestSession = await gallerySearchSessionRepository.findLatestByUserId(input.discordUserId);
    } catch (error) {
      logger.warn("[DISCORD NOTIFICATION] latest session lookup failed", {
        orderNumber: input.orderNumber,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const sessionLanguage = resolveSessionLanguage(latestSession);
    const language = input.language ?? sessionLanguage ?? "en";
    const languageSource = input.language ? "order" : sessionLanguage ? "session" : "default";
    const message = buildPaidOrderMessage(language, input);

    logger.info("[DISCORD NOTIFICATION] paid message prepared", {
      orderNumber: input.orderNumber,
      discordUserId: input.discordUserId,
      language,
      languageSource,
      channelId: latestSession?.discordChannelId ?? null,
    });

    try {
      const user = await discordClient.users.fetch(input.discordUserId);
      const dm = await user.createDM();
      await dm.send(message);
    } catch (error) {
      logger.warn("[DISCORD NOTIFICATION] dm send failed", {
        orderNumber: input.orderNumber,
        language,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (!latestSession) {
      return;
    }

    try {
      const channel = await discordClient.channels.fetch(latestSession.discordChannelId);
      if (channel?.isTextBased() && hasSend(channel)) {
        await channel.send(message);
      }
    } catch (error) {
      logger.warn("[DISCORD NOTIFICATION] channel send failed", {
        orderNumber: input.orderNumber,
        language,
        channelId: latestSession.discordChannelId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },
};
