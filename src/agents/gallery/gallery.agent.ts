import { AgentContext, AgentDefinition, HermesInput, HermesOutput } from "../../hermes/types";
import { searchGallerySkill } from "../../skills/gallery/search-gallery.skill";
import { selectCardSkill } from "../../skills/gallery/select-card.skill";
import { createCheckoutLinkSkill } from "../../skills/gallery/create-checkout-link.skill";
import { logger } from "../../utils/logger";

export const GalleryAgent: AgentDefinition = {
  id: "lootcardchoose",
  name: "GalleryAgent",
  description: "图库选卡 Agent",
  async handler(input: HermesInput, context: AgentContext): Promise<HermesOutput> {
    if (context.intent === "gallery_search") {
      logger.info("[GALLERY AGENT] handling gallery_search");
      const result = await searchGallerySkill(
        {
          query: input.text,
          limit: 10,
          discordUserId: context.userId ?? "",
          discordChannelId: context.channelId ?? "",
        },
        { ...context, skillId: "gallery.search" }
      );

      if (result.results.length === 0) {
        return {
          text: "图库暂无匹配卡牌，请换个关键词试试。",
        };
      }

      const lines = result.results.map(
        (card: { title: string; price: number }, index: number) =>
          `${index + 1}. ${card.title}｜$${card.price.toFixed(2)}`
      );

      return {
        text: `✅ 为你找到 ${result.results.length} 张卡牌样式\n\n${lines.join("\n")}\n\n回复编号 1-10 选择。`,
      };
    }

    if (context.intent === "gallery_select") {
      logger.info("[GALLERY AGENT] handling gallery_select");
      const selectedIndex = Number.parseInt(input.text.trim(), 10);
      if (!Number.isFinite(selectedIndex) || selectedIndex <= 0) {
        return { text: "请选择有效编号（1-10）。" };
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
        text:
          `✅ 下单链接已生成\n` +
          `商品：${selected.title}\n` +
          `价格：$${selected.price}\n` +
          `付款链接：${checkout.url}`,
      };
    }

    if (context.intent === "help") {
      logger.info("[GALLERY AGENT] handling help");
      return {
        text: "输入：给我10张黑金SSR女角色卡牌。回复 1-10 选择。",
      };
    }

    if (context.intent === "ignore") {
      logger.info("[GALLERY AGENT] handling ignore");
      return { text: "" };
    }

    logger.info("[GALLERY AGENT] handling unknown");
    return { text: "无法识别指令，请输入帮助或描述你想找的卡牌。" };
  },
};
