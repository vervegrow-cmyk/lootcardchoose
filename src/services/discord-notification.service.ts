import { Client } from "discord.js";
import { gallerySearchSessionRepository } from "../repositories/gallery-search-session.repository";
import { logger } from "../utils/logger";

let discordClient: Client | null = null;

const hasSend = (value: unknown): value is { send: (message: string) => Promise<unknown> } =>
  typeof value === "object" && value !== null && "send" in value && typeof value.send === "function";

export const discordNotificationService = {
  registerClient(client: Client): void {
    discordClient = client;
  },
  async notifyOrderPaid(input: {
    discordUserId: string;
    orderNumber: string;
    amount: string;
  }): Promise<void> {
    if (!discordClient) {
      logger.warn("[DISCORD NOTIFICATION] client not ready for paid notification", {
        orderNumber: input.orderNumber,
      });
      return;
    }

    const message = `Payment received\n\nOrder: ${input.orderNumber}\nAmount: $${input.amount}`;

    try {
      const user = await discordClient.users.fetch(input.discordUserId);
      const dm = await user.createDM();
      await dm.send(message);
    } catch (error) {
      logger.warn("[DISCORD NOTIFICATION] dm send failed", {
        orderNumber: input.orderNumber,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const session = await gallerySearchSessionRepository.findLatestByUserId(input.discordUserId);
      if (!session) {
        return;
      }

      const channel = await discordClient.channels.fetch(session.discordChannelId);
      if (channel?.isTextBased() && hasSend(channel)) {
        await channel.send(message);
      }
    } catch (error) {
      logger.warn("[DISCORD NOTIFICATION] channel send failed", {
        orderNumber: input.orderNumber,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },
};
