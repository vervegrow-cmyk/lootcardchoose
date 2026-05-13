import { AgentContext, AgentDefinition, HermesInput, HermesOutput } from "../../hermes/types";
import { galleryHelpSkill } from "../../skills/gallery/gallery-help.skill";
import { createCheckoutLinkSkill } from "../../skills/gallery/create-checkout-link.skill";
import { refreshGallerySkill } from "../../skills/gallery/refresh-gallery.skill";
import { searchGallerySkill } from "../../skills/gallery/search-gallery.skill";
import { selectCardSkill } from "../../skills/gallery/select-card.skill";
import { parseSelectedIndex } from "../../utils/gallery-language";
import { t } from "../../utils/i18n";
import { logger } from "../../utils/logger";

const buildSearchSuccessText = (language: AgentContext["language"]): string =>
  language === "zh"
    ? "我为你找到了以下卡牌，请回复编号选择一张。"
    : "Here are the cards I found for you. Reply with a number to select one.";

const buildSearchEmptyText = (language: AgentContext["language"]): string =>
  language === "zh"
    ? "抱歉，暂时没有找到符合要求的卡牌。你可以换一种颜色、稀有度或角色描述再试试。"
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

const buildRefreshText = (
  language: AgentContext["language"],
  refreshMode: "next_batch" | "refine" | "broaden" | "random_fallback" | "need_clarification",
  shortQuestion?: string
): string => {
  if (refreshMode === "need_clarification") {
    return shortQuestion || t(language, "gallery.refresh.needClarification");
  }

  if (refreshMode === "refine") {
    return t(language, "gallery.refresh.refine");
  }

  if (refreshMode === "broaden" || refreshMode === "random_fallback") {
    return t(language, "gallery.refresh.broaden");
  }

  return t(language, "gallery.refresh.nextBatch");
};

export const GalleryAgent: AgentDefinition = {
  id: "lootcardchoose",
  name: "GalleryAgent",
  description: "Gallery selection agent",
  async handler(input: HermesInput, context: AgentContext): Promise<HermesOutput> {
    switch (context.intent) {
      case "gallery_search": {
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
          text: buildSearchSuccessText(result.language),
          cards: result.results.map((card) => ({
            id: card.id,
            title: card.title,
            description: card.description,
            imageUrl: card.imageUrl,
            price: card.price,
            tags: card.tags,
            language: result.language,
          })),
          selectionPrompt: result.language === "zh" ? "请回复编号选择一张。" : "Reply with a number to select one.",
          metadata: {
            query: result.query,
            parsedQuery: result.parsedQuery ?? undefined,
            structuredKeywords: result.parsedQuery?.keywords ?? undefined,
            limit: result.limit,
            language: result.language,
          },
        };
      }
      case "gallery_refresh": {
        logger.info("[GALLERY AGENT] handling gallery_refresh");
        const result = await refreshGallerySkill(
          {
            discordUserId: context.userId ?? "",
            discordChannelId: context.channelId ?? "",
            currentMessage: input.text,
          },
          { ...context, skillId: "gallery.refresh" }
        );

        if (!result.previousSessionFound) {
          return {
            type: "text",
            language: result.language,
            text: t(result.language, "gallery.refresh.noPreviousSearch"),
          };
        }

        if (result.refreshMode === "need_clarification" || result.results.length === 0) {
          return {
            type: "text",
            language: result.language,
            text: buildRefreshText(result.language, result.refreshMode, result.shortQuestion),
            metadata: {
              refreshMode: result.refreshMode,
              reason: result.reason,
              previousQuery: result.query,
            },
          };
        }

        const refreshMode = result.refreshMode as "next_batch" | "refine" | "broaden" | "random_fallback";

        return {
          type: "gallery_search_results",
          language: result.language,
          text: buildRefreshText(result.language, refreshMode, result.shortQuestion),
          cards: result.results.map((card) => ({
            id: card.id,
            title: card.title,
            description: card.description,
            imageUrl: card.imageUrl,
            price: card.price,
            tags: card.tags,
            language: result.language,
            refreshMode,
            reason: result.reason,
          })),
          selectionPrompt: result.language === "zh" ? "请回复编号选择一张。" : "Reply with a number to select one.",
          refreshMode,
          reason: result.reason,
          metadata: {
            previousQuery: result.query,
            refreshMode,
            reason: result.reason,
            firstBatchCardIds: result.firstBatchCardIds,
            secondBatchCardIds: result.secondBatchCardIds,
          },
        };
      }
      case "gallery_select": {
        logger.info("[GALLERY AGENT] handling gallery_select");
        const selectedIndex = parseSelectedIndex(input.text);
        if (!selectedIndex) {
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
      case "help":
      case "order_status": {
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
      case "ignore":
        logger.info("[GALLERY AGENT] handling ignore");
        return { type: "text", language: context.language, text: "" };
      default:
        logger.info("[GALLERY AGENT] handling unknown");
        return {
          type: "text",
          language: context.language,
          text: t(context.language, "help.message"),
        };
    }
  },
};
