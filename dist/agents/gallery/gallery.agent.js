"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GalleryAgent = void 0;
const search_gallery_skill_1 = require("../../skills/gallery/search-gallery.skill");
const logger_1 = require("../../utils/logger");
exports.GalleryAgent = {
    id: "lootcardchoose",
    name: "GalleryAgent",
    description: "图库选卡 Agent",
    async handler(input, context) {
        if (context.intent === "gallery_search") {
            logger_1.logger.info("[GALLERY AGENT] handling gallery_search");
            const result = await (0, search_gallery_skill_1.searchGallerySkill)({ query: input.text, limit: 10 }, { ...context, skillId: "gallery.search" });
            const lines = result.results.map((card, index) => `${index + 1}. ${card.title}｜$${card.price.toFixed(2)}`);
            return {
                text: `✅ 为你找到 ${result.results.length} 张卡牌样式\n\n${lines.join("\n")}\n\n回复编号 1-10 选择。`,
            };
        }
        if (context.intent === "gallery_select") {
            logger_1.logger.info("[GALLERY AGENT] handling gallery_select");
            return { text: "选择功能开发中" };
        }
        if (context.intent === "help") {
            logger_1.logger.info("[GALLERY AGENT] handling help");
            return {
                text: "输入：给我10张黑金SSR女角色卡牌。回复 1-10 选择。",
            };
        }
        if (context.intent === "ignore") {
            logger_1.logger.info("[GALLERY AGENT] handling ignore");
            return { text: "" };
        }
        logger_1.logger.info("[GALLERY AGENT] handling unknown");
        return { text: "无法识别指令，请输入帮助或描述你想找的卡牌。" };
    },
};
