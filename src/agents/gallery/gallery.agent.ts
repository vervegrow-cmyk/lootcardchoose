import { AgentContext, AgentDefinition, HermesInput, HermesOutput, RefreshMode } from "../../hermes/types";
import { gallerySearchSessionRepository } from "../../repositories/gallery-search-session.repository";
import { galleryHelpSkill } from "../../skills/gallery/gallery-help.skill";
import { CreateCheckoutLinkSkill } from "../../skills/gallery/create-checkout-link.skill";
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

const buildCheckoutReadyText = (language: AgentContext["language"]): string =>
  language === "zh"
    ? "你的卡牌商品页已准备好，可以先分享，也可以直接购买。"
    : "Your card page is ready. You can share it or buy it now.";

const buildRefreshText = (
  language: AgentContext["language"],
  refreshMode: RefreshMode,
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
        logger.info("[GALLERY AGENT] handling gallery_search", {
          discordUserId: context.userId ?? "",
          discordChannelId: context.channelId ?? "",
          query: input.text,
        });
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
        logger.info("[GALLERY AGENT] handling gallery_refresh", {
          discordUserId: context.userId ?? "",
          discordChannelId: context.channelId ?? "",
          feedback: input.text,
        });
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
            metadata: {
              refreshMode: result.refreshMode,
              reason: result.reason,
              keep: result.keep,
              avoid: result.avoid,
              broaden: result.broaden,
              searchKeywords: result.searchKeywords,
            },
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
              keep: result.keep,
              avoid: result.avoid,
              broaden: result.broaden,
              searchKeywords: result.searchKeywords,
            },
          };
        }

        const refreshMode = result.refreshMode as Exclude<RefreshMode, "need_clarification">;

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
            keep: result.keep,
            avoid: result.avoid,
            broaden: result.broaden,
            searchKeywords: result.searchKeywords,
          },
        };
      }
      case "gallery_select": {
        const activeSession = await gallerySearchSessionRepository.findLatest({
          discordUserId: context.userId ?? "",
          discordChannelId: context.channelId ?? "",
          status: "active",
        });
        const selectedIndex = parseSelectedIndex(input.text, {
          hasActiveSession: Boolean(activeSession),
        });

        logger.info("[GALLERY AGENT] handling gallery_select", {
          discordUserId: context.userId ?? "",
          discordChannelId: context.channelId ?? "",
          activeSessionId: activeSession?.id ?? null,
          selectedIndex,
          rawInput: input.text,
        });

        if (!selectedIndex) {
          return {
            type: "text",
            language: context.language,
            text: t(context.language, "gallery.select.invalid"),
          };
        }

        try {
          const selectResult = await selectCardSkill(
            {
              discordUserId: context.userId ?? "",
              discordChannelId: context.channelId ?? "",
              selectedIndex,
            },
            { ...context, skillId: "gallery.selectCard" }
          );

          const checkoutResult = await CreateCheckoutLinkSkill.handle(
            {
              ...selectResult.selectedCard,
              order: selectResult.order,
            },
            {
              ...context,
              skillId: "gallery.createCheckoutLink",
            }
          );

          logger.info("[GALLERY AGENT] checkout created", {
            discordUserId: context.userId ?? "",
            discordChannelId: context.channelId ?? "",
            selectedIndex,
            galleryCardId: checkoutResult.selectedCard.galleryCardId,
            orderNumber: checkoutResult.order.orderNumber,
            productUrl: checkoutResult.productUrl,
            purchaseUrl: checkoutResult.purchaseUrl,
          });

          return {
            type: "gallery_checkout_created",
            language: context.language,
            text: buildCheckoutReadyText(context.language),
            title: checkoutResult.selectedCard.title,
            price: checkoutResult.order.amount,
            productUrl: checkoutResult.productUrl,
            purchaseUrl: checkoutResult.purchaseUrl,
            shareImageUrl: checkoutResult.shareImageUrl,
            productHandle: checkoutResult.productHandle,
            orderNumber: checkoutResult.order.orderNumber,
            orderStatus: checkoutResult.order.status,
            metadata: {
              galleryCardId: checkoutResult.selectedCard.galleryCardId,
              title: checkoutResult.selectedCard.title,
              price: checkoutResult.order.amount,
              productUrl: checkoutResult.productUrl,
              purchaseUrl: checkoutResult.purchaseUrl,
              shareImageUrl: checkoutResult.shareImageUrl,
              productHandle: checkoutResult.productHandle,
              orderNumber: checkoutResult.order.orderNumber,
              orderStatus: checkoutResult.order.status,
            },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn("[GALLERY AGENT] gallery_select failed", {
            discordUserId: context.userId ?? "",
            discordChannelId: context.channelId ?? "",
            activeSessionId: activeSession?.id ?? null,
            selectedIndex,
            message,
          });

          return {
            type: "text",
            language: context.language,
            text: message || t(context.language, "checkout.failed"),
          };
        }
      }
      case "help":
      case "order_status": {
        logger.info("[GALLERY AGENT] handling help-like inquiry", {
          discordUserId: context.userId ?? "",
          discordChannelId: context.channelId ?? "",
          message: input.text,
          intent: context.intent,
        });
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
        logger.info("[GALLERY AGENT] handling ignore", {
          discordUserId: context.userId ?? "",
          discordChannelId: context.channelId ?? "",
        });
        return { type: "text", language: context.language, text: "" };
      default:
        logger.info("[GALLERY AGENT] handling unknown", {
          discordUserId: context.userId ?? "",
          discordChannelId: context.channelId ?? "",
          intent: context.intent ?? "unknown",
        });
        return {
          type: "text",
          language: context.language,
          text: t(context.language, "help.message"),
        };
    }
  },
};
