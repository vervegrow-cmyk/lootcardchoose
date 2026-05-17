import { prisma } from "../services/prisma.service";

export type GuildConfigRecord = {
  id: string;
  discordGuildId: string;
  enabledChannelIds: string[];
  enabledChannelNames: string[];
  enabledAgents: string[];
  isEnabled: boolean;
  defaultLanguage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export const guildConfigRepository = {
  async findByGuildId(discordGuildId: string): Promise<GuildConfigRecord | null> {
    return prisma.guildConfig.findUnique({
      where: { discordGuildId },
    });
  },
  async upsert(input: {
    discordGuildId: string;
    enabledChannelIds: string[];
    enabledChannelNames: string[];
    enabledAgents: string[];
    isEnabled?: boolean;
    defaultLanguage?: string | null;
  }): Promise<GuildConfigRecord> {
    return prisma.guildConfig.upsert({
      where: { discordGuildId: input.discordGuildId },
      create: {
        discordGuildId: input.discordGuildId,
        enabledChannelIds: input.enabledChannelIds,
        enabledChannelNames: input.enabledChannelNames,
        enabledAgents: input.enabledAgents,
        isEnabled: input.isEnabled ?? true,
        defaultLanguage: input.defaultLanguage ?? null,
      },
      update: {
        enabledChannelIds: input.enabledChannelIds,
        enabledChannelNames: input.enabledChannelNames,
        enabledAgents: input.enabledAgents,
        isEnabled: input.isEnabled ?? true,
        defaultLanguage: input.defaultLanguage ?? null,
      },
    });
  },
  async deleteByGuildId(discordGuildId: string): Promise<void> {
    await prisma.guildConfig.deleteMany({
      where: { discordGuildId },
    });
  },
};
