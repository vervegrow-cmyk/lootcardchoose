import { AgentContext, AgentDefinition, HermesInput, HermesOutput } from "../../hermes/types";
import { galleryHelpSkill } from "../../skills/gallery/gallery-help.skill";
import { createCheckoutLinkSkill } from "../../skills/gallery/create-checkout-link.skill";
import { searchGallerySkill } from "../../skills/gallery/search-gallery.skill";
import { selectCardSkill } from "../../skills/gallery/select-card.skill";
import { t } from "../../utils/i18n";
import { logger } from "../../utils/logger";

const buildSearchSuccessText = (language: AgentContext["language"], count: number): string =>
  language === "zh"
    ? "我为你找到以下卡牌，请回复编号选择一张。"
    : "Here are the cards I found for you. Reply with a number to select one.";

const buildSearchEmptyText = (language: AgentContext["language"]): string =>
  language === "zh"
    ? "抱歉，暂时没有找到符合要求的卡牌。你可以换一种颜色、稀有度或角色描述再试。"
    : "Sorry, I couldn't find matching cards. Try describing the style, color, rarity, or character type.";

const buildCheckoutReadyText = (
  language: AgentContext["language"],
  title: string,
  price: string,
  url: string
): string =>
  language === "zh"
    ? `你的卡牌商品已创建，可以通过以下链接查看并购买：\n\n商品：${title}\n价格：$${price}\n链接：${url}`
    : `Your card is ready. You can view and purchase it here:\n\nItem: ${title}\nPrice: $${price}\nLink: ${url}`;

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
          language: result.language,
          text: buildSearchEmptyText(result.language),
        };
      }

      return {
        type: "gallery_search_results",
        language: result.language,
        text: buildSearchSuccessText(result.language, result.results.length),
        cards: result.results.map((card) => ({
          id: card.id,
          title: card.title,
          description: card.description,
          imageUrl: card.imageUrl,
          price: card.price,
          tags: card.tags,
          language: result.language,
        })),
        selectionPrompt:
          result.language === "zh"
            ? "请回复编号选择一张。"
            : "Reply with a number to select one.",
        metadata: {
          query: result.query,
          parsedQuery: result.parsedQuery ?? undefined,
          structuredKeywords: result.parsedQuery?.keywords ?? undefined,
          limit: result.limit,
          language: result.language,
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
          text: t(context.language, "gallery.select.invalid"),
        };
      }

      const selectResult = await selectCardSkill(
        {
          discordUserId: context.userId ?? "",
          discordChannelId: context.channelId ?? "",
          selectedIndex,
        },
        { ...context, skillId: "gallery.selectCard" }
      );

      const checkoutResult = await createCheckoutLinkSkill(selectResult, {
        ...context,
        skillId: "gallery.createCheckoutLink",
      });

      return {
        type: "gallery_checkout_created",
        language: context.language,
        text: buildCheckoutReadyText(
          context.language,
          checkoutResult.selectedCard.title,
          checkoutResult.order.amount,
          checkoutResult.checkoutUrl
        ),
        metadata: {
          title: checkoutResult.selectedCard.title,
          price: checkoutResult.order.amount,
          checkoutUrl: checkoutResult.checkoutUrl,
          orderNumber: checkoutResult.order.orderNumber,
          orderStatus: checkoutResult.order.status,
        },
      };
    }

    if (context.intent === "help" || context.intent === "order_status") {
      logger.info("[GALLERY AGENT] handling help-like inquiry");
      const result = await galleryHelpSkill(
        {
          message: input.text,
        },
        { ...context, skillId: "gallery.help" }
      );

      return {
        type: "text",
        language: result.language,
        text: result.text,
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
      text: context.language === "zh" ? t("zh", "help.message") : t("en", "help.message"),
    };
  },
};
