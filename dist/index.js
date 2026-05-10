"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const discord_bot_1 = require("./bot/discord.bot");
const main = async () => {
    await discord_bot_1.DiscordBot.start();
};
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
