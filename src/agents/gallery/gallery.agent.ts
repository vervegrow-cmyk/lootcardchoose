import { AgentContext, AgentDefinition, HermesInput, HermesOutput } from "../../hermes/types";
import { createCheckoutLinkSkill } from "../../skills/gallery/create-checkout-link.skill";
import { searchGallerySkill } from "../../skills/gallery/search-gallery.skill";
import { selectCardSkill } from "../../skills/gallery/select-card.skill";
import { t } from "../../utils/i18n";
import { logger } from "../../utils/logger";

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
          limit: 10,
          discordUserId: context.userId ?? "",
          discordChannelId: context.channelId ?? "",
        },
        { ...context, skillId: "gallery.search" }
      );

      if (result.results.length === 0) {
        return {
          type: "text",
          language: context.language,
          text: t(context.language, "gallery.search.empty"),
        };
      }

      return {
        type: "gallery_search_results",
        language: context.language,
        text: t(context.language, "gallery.search.success", { count: result.results.length }),
        cards: result.results.map((card) => ({
          id: card.id,
          title: card.title,
          description: card.description,
          imageUrl: card.imageUrl,
          price: card.price,
          tags: card.tags,
        })),
        selectionPrompt: t(context.language, "gallery.search.chooseHint", {
          count: result.results.length,
        }),
      };
    }

    if (context.intent === "gallery_select") {
      logger.info("[GALLERY AGENT] handling gallery_select");
      const selectedIndex = Number.parseInt(input.text.trim(), 10);
      if (!Number.isFinite(selectedIndex) || selectedIndex <= 0) {
        return {
          type: "text",
          language: context.language,
          text: t(context.language, "gallery.select.invalid"),
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
          `${t(context.language, "gallery.select.success", { index: selectedIndex })}\n` +
          `${t(context.language, "checkout.success")}\n` +
          `${checkout.url}`,
      };
    }

    if (context.intent === "help") {
      logger.info("[GALLERY AGENT] handling help");
      return {
        type: "text",
        language: context.language,
        text: t(context.language, "help.message"),
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
      text: t(context.language, "help.message"),
    };
  },
};
