import { AgentContext, AgentDefinition, HermesInput, HermesOutput } from "../../hermes/types";
import { searchGallerySkill } from "../../skills/gallery/search-gallery.skill";
import { logger } from "../../utils/logger";

export const GalleryAgent: AgentDefinition = {
  id: "lootcardchoose",
  name: "GalleryAgent",
  description: "图库选卡 Agent",
  async handler(input: HermesInput, context: AgentContext): Promise<HermesOutput> {
    if (context.intent === "gallery_search") {
      logger.info("[GALLERY AGENT] handling gallery_search");
      const result = await searchGallerySkill(
        { query: input.text, limit: 10 },
        { ...context, skillId: "gallery.search" }
      );

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
      return { text: "选择功能开发中" };
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
