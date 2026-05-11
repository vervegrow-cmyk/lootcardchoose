import { AgentContext, AgentDefinition, HermesInput, HermesOutput } from "../../hermes/types";
import { createCheckoutLinkSkill } from "../../skills/gallery/create-checkout-link.skill";
import { searchGallerySkill } from "../../skills/gallery/search-gallery.skill";
import { selectCardSkill } from "../../skills/gallery/select-card.skill";
import { logger } from "../../utils/logger";

const buildSearchSuccessText = (language: AgentContext["language"], count: number): string =>
  language === "zh"
    ? `为你找到 ${count} 张卡牌样式，回复编号 1-${count} 选择。`
    : `Found ${count} card styles for you. Reply with a number from 1-${count} to choose.`;

const buildSearchEmptyText = (language: AgentContext["language"]): string =>
  language === "zh"
    ? "没有找到匹配的卡牌，请换一个描述试试，例如：黑金 SSR 女角色。"
    : "No matching cards found. Try another description, for example: black gold SSR female card.";

export const GalleryAgent: AgentDefinition = {
  id: "lootcardchoose",
  name: "GalleryAgent",
  description: "Gallery selection agent",
  async handler(input: HermesInput, context: AgentContext): Promise<HermesOutput> {
    if (context.intent === "gallery_search") {
      logger.info("[GALLERY AGENT] handling gallery_search");
      const result = await searchGallerySkill(
        {
          query: input.text,
          discordUserId: context.userId ?? "",
          discordChannelId: context.channelId ?? "",
        },
        { ...context, skillId: "gallery.search" }
      );

      if (result.results.length === 0) {
        return {
          type: "text",
          language: context.language,
          text: buildSearchEmptyText(context.language),
        };
      }

      return {
        type: "gallery_search_results",
        language: context.language,
        text: buildSearchSuccessText(context.language, result.results.length),
        cards: result.results.map((card) => ({
          id: card.id,
          title: card.title,
          description: card.description,
          imageUrl: card.imageUrl,
          price: card.price,
          tags: card.tags,
        })),
        selectionPrompt:
          context.language === "zh"
            ? `回复编号 1-${result.results.length} 选择。`
            : `Reply with a number from 1-${result.results.length} to choose.`,
        metadata: {
          query: result.query,
          parsedQuery: result.parsedQuery ?? undefined,
          limit: result.limit,
        },
      };
    }

    if (context.intent === "gallery_select") {
      logger.info("[GALLERY AGENT] handling gallery_select");
      const selectedIndex = Number.parseInt(input.text.trim(), 10);
      if (!Number.isFinite(selectedIndex) || selectedIndex <= 0) {
        return {
          type: "text",
          language: context.language,
          text: context.language === "zh" ? "请选择有效编号（1-10）。" : "Please choose a valid number (1-10).",
        };
      }

      const selected = await selectCardSkill(
        {
          discordUserId: context.userId ?? "",
          discordChannelId: context.channelId ?? "",
          selectedIndex,
        },
        { ...context, skillId: "gallery.selectCard" }
      );

      const checkout = await createCheckoutLinkSkill(
        {
          title: selected.title,
          description: selected.description,
          imageUrl: selected.imageUrl,
          price: selected.price,
          tags: selected.tags,
        },
        { ...context, skillId: "gallery.createCheckoutLink" }
      );

      return {
        type: "text",
        language: context.language,
        text:
          context.language === "zh"
            ? `已为你选择第 ${selectedIndex} 张卡牌。\n付款链接已生成。\n${checkout.url}`
            : `Selected card #${selectedIndex} for you.\nYour checkout link is ready.\n${checkout.url}`,
      };
    }

    if (context.intent === "help") {
      logger.info("[GALLERY AGENT] handling help");
      return {
        type: "text",
        language: context.language,
        text:
          context.language === "zh"
            ? "输入示例：给我10张黑金SSR女角色卡牌。然后回复 1-10 进行选择。"
            : "Example: Show me 10 black gold SSR female character cards. Then reply with a number from 1-10.",
      };
    }

    if (context.intent === "ignore") {
      logger.info("[GALLERY AGENT] handling ignore");
      return { type: "text", language: context.language, text: "" };
    }

    logger.info("[GALLERY AGENT] handling unknown");
    return {
      type: "text",
      language: context.language,
      text:
        context.language === "zh"
          ? "输入示例：给我10张黑金SSR女角色卡牌。然后回复 1-10 进行选择。"
          : "Example: Show me 10 black gold SSR female character cards. Then reply with a number from 1-10.",
    };
  },
};
