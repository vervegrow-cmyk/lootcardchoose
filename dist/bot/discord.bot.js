"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiscordBot = void 0;
const discord_js_1 = require("discord.js");
const registry_1 = require("../hermes/registry");
const router_1 = require("../hermes/router");
const env_1 = require("../config/env");
const logger_1 = require("../utils/logger");
const isLootcardChooseChannel = (message) => {
    const channelName = message.channel && "name" in message.channel ? message.channel.name : "";
    return channelName === "lootcardchoose";
};
exports.DiscordBot = {
    start: async () => {
        const env = (0, env_1.loadEnv)();
        const client = new discord_js_1.Client({
            intents: [discord_js_1.GatewayIntentBits.Guilds, discord_js_1.GatewayIntentBits.GuildMessages, discord_js_1.GatewayIntentBits.MessageContent],
        });
        const registry = (0, registry_1.buildHermesRegistry)();
        const router = new router_1.HermesRouter(registry);
        client.on("ready", () => {
            logger_1.logger.info("[DISCORD] bot ready");
        });
        client.on("messageCreate", async (message) => {
            if (message.author.bot) {
                return;
            }
            if (!isLootcardChooseChannel(message)) {
                return;
            }
            logger_1.logger.info("[DISCORD] message received");
            const response = await router.handle({
                text: message.content,
                channelId: message.channelId,
                userId: message.author.id,
            });
            if (response.text) {
                await message.reply(response.text);
                if (response.text.startsWith("✅ 为你找到")) {
                    logger_1.logger.info("[DISCORD] gallery cards reply sent");
                }
                else {
                    logger_1.logger.info("[DISCORD] reply sent");
                }
            }
        });
        await client.login(env.discordBotToken);
    },
};
