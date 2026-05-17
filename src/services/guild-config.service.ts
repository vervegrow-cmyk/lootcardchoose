import { guildConfigRepository, GuildConfigRecord } from "../repositories/guild-config.repository";

const LOOTCARDCHOOSE_CHANNEL_NAME = "lootcardchoose";

const normalizeChannelName = (channelName: string | null | undefined): string =>
  channelName ? channelName.trim().replace(/^#/, "").toLowerCase() : "";

const normalizeChannelNames = (channelNames: string[]): string[] =>
  channelNames.map((channelName) => normalizeChannelName(channelName)).filter(Boolean);

export type GuildChannelAccessDecision =
  | {
      status: "skip";
      reason: "dm";
      config: null;
    }
  | {
      status: "allowed";
      mode: "legacy_fallback" | "configured";
      config: GuildConfigRecord | null;
    }
  | {
      status: "denied";
      mode: "legacy_fallback" | "configured";
      reason: "legacy_wrong_channel" | "guild_disabled" | "channel_not_enabled";
      config: GuildConfigRecord | null;
      allowedChannelNames: string[];
    };

export const guildConfigService = {
  normalizeChannelName,
  async getByGuildId(discordGuildId: string): Promise<GuildConfigRecord | null> {
    return guildConfigRepository.findByGuildId(discordGuildId);
  },
  async resolveChannelAccess(input: {
    discordGuildId: string | null;
    discordChannelId: string;
    discordChannelName?: string | null;
  }): Promise<GuildChannelAccessDecision> {
    if (input.discordGuildId == null) {
      return {
        status: "skip",
        reason: "dm",
        config: null,
      };
    }

    const config = await guildConfigRepository.findByGuildId(input.discordGuildId);
    const normalizedChannelName = normalizeChannelName(input.discordChannelName);

    if (!config) {
      if (normalizedChannelName === LOOTCARDCHOOSE_CHANNEL_NAME) {
        return {
          status: "allowed",
          mode: "legacy_fallback",
          config: null,
        };
      }

      return {
        status: "denied",
        mode: "legacy_fallback",
        reason: "legacy_wrong_channel",
        config: null,
        allowedChannelNames: [LOOTCARDCHOOSE_CHANNEL_NAME],
      };
    }

    const allowedChannelNames = normalizeChannelNames(config.enabledChannelNames);

    if (!config.isEnabled) {
      return {
        status: "denied",
        mode: "configured",
        reason: "guild_disabled",
        config,
        allowedChannelNames,
      };
    }

    const isAllowedById = config.enabledChannelIds.includes(input.discordChannelId);
    const isAllowedByName = normalizedChannelName.length > 0 && allowedChannelNames.includes(normalizedChannelName);

    if (isAllowedById || isAllowedByName) {
      return {
        status: "allowed",
        mode: "configured",
        config,
      };
    }

    return {
      status: "denied",
      mode: "configured",
      reason: "channel_not_enabled",
      config,
      allowedChannelNames,
    };
  },
};
