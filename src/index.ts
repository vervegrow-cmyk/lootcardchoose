import { DiscordBot } from "./bot/discord.bot";

const main = async (): Promise<void> => {
  await DiscordBot.start();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
