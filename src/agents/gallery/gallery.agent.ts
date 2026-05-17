import { AgentContext, AgentDefinition, HermesInput, HermesOutput, RefreshMode } from "../../hermes/types";
import { gallerySearchSessionRepository } from "../../repositories/gallery-search-session.repository";
import { CreateCheckoutLinkSkill } from "../../skills/gallery/create-checkout-link.skill";
import { galleryHelpSkill } from "../../skills/gallery/gallery-help.skill";
import { refreshGallerySkill } from "../../skills/gallery/refresh-gallery.skill";
import { awaitPendingSearchSessionWrite, searchGallerySkill } from "../../skills/gallery/search-gallery.skill";
import { selectCardSkill } from "../../skills/gallery/select-card.skill";
import { recommendationFeedbackService } from "../../services/recommendation-feedback.service";
import { parseSelectedIndex } from "../../utils/gallery-language";
import { t } from "../../utils/i18n";
import { logger } from "../../utils/logger";
import { isUserFacingError } from "../../utils/user-facing-error";

const buildSearchRecoveryText = (language: AgentContext["language"]): string =>
  language === "zh"
    ? "我没有找到完全一致的卡，但找到了气质相近的选择。"
    : "I couldn't find exact matches, but I found cards with a similar vibe.";

const buildSearchSuccessText = (
  language: AgentContext["language"],
  count: number,
  summaryText?: string,
  recoveryTriggered?: boolean
): string => {
  if (recoveryTriggered && summaryText?.trim()) {
    return `${buildSearchRecoveryText(language)}\n\n${summaryText}`;
  }

  if (summaryText?.trim()) {
    return summaryText;
  }

  if (recoveryTriggered) {
    return buildSearchRecoveryText(language);
  }

  return t(language, "gallery.search.success", { count });
};

const buildSearchEmptyText = (language: AgentContext["language"]): string => t(language, "gallery.search.empty");

const buildCheckoutReadyText = (language: AgentContext["language"]): string =>
  language === "zh" ? "你的卡牌商品页已准备好，可以先分享，也可以直接购买。" : "Your card page is ready. You can share it or buy it now.";

const buildRefreshText = (
  language: AgentContext["language"],
  refreshMode: RefreshMode,
  shortQuestion?: string,
  poolExhausted?: boolean,
  summaryText?: string
): string => {
  if (refreshMode === "need_clarification") {
    return shortQuestion || (poolExhausted ? t(language, "gallery.refresh.poolExhausted") : t(language, "gallery.refresh.needClarification"));
  }

  if (summaryText?.trim()) {
    return summaryText;
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
          logger.info("[GALLERY AGENT] gallery_search empty", {
            discordUserId: context.userId ?? "",
            discordChannelId: context.channelId ?? "",
            query: input.text,
            exactResultCount: result.exactResultCount,
            recoveryTriggered: result.recoveryTriggered,
            recoveryResultCount: result.recoveryResultCount,
            curatorNarrationUsed: result.curatorNarrationUsed,
            responseTextSource: result.responseTextSource,
          });
          return {
            type: "text",
            language: result.language,
            text: buildSearchEmptyText(result.language),
            metadata: {
              query: result.query,
              parsedQuery: result.parsedQuery ?? undefined,
              structuredKeywords: result.parsedQuery?.keywords ?? undefined,
              limit: result.limit,
              language: result.language,
              exactResultCount: result.exactResultCount,
              recoveryTriggered: result.recoveryTriggered,
              recoveryResultCount: result.recoveryResultCount,
              curatorNarrationUsed: result.curatorNarrationUsed,
              responseTextSource: result.responseTextSource,
            },
          };
        }

        await awaitPendingSearchSessionWrite({
          discordGuildId: context.discordGuildId,
          discordUserId: context.userId ?? "",
          discordChannelId: context.channelId ?? "",
          timeoutMs: 2000,
        });

        const activeSessionAfterSearch = await gallerySearchSessionRepository.findLatest({
          discordGuildId: context.discordGuildId,
          discordUserId: context.userId ?? "",
          discordChannelId: context.channelId ?? "",
          status: "active",
        });

        await recommendationFeedbackService.recordSearch({
          sessionId: activeSessionAfterSearch?.id ?? null,
          query: result.query,
        });

        logger.info("[GALLERY AGENT] gallery_search results", {
          discordUserId: context.userId ?? "",
          discordChannelId: context.channelId ?? "",
          query: result.query,
          resultCount: result.results.length,
          exactResultCount: result.exactResultCount,
          recoveryTriggered: result.recoveryTriggered,
          recoveryResultCount: result.recoveryResultCount,
          curatorNarrationUsed: result.curatorNarrationUsed,
          responseTextSource: result.responseTextSource,
        });

        return {
          type: "gallery_search_results",
          language: result.language,
          text: buildSearchSuccessText(
            result.language,
            result.results.length,
            result.summaryText,
            result.recoveryTriggered
          ),
          cards: result.results.map((card) => ({
            id: card.id,
            title: card.title,
            description: card.description,
            imageUrl: card.imageUrl,
            price: card.price,
            tags: card.tags,
            language: result.language,
            curatorNarration: card.curatorNarration,
          })),
          selectionPrompt: t(result.language, "gallery.search.chooseHint", {
            count: Math.min(result.results.length, 10),
          }),
          metadata: {
            query: result.query,
            parsedQuery: result.parsedQuery ?? undefined,
            structuredKeywords: result.parsedQuery?.keywords ?? undefined,
            limit: result.limit,
            language: result.language,
            exactResultCount: result.exactResultCount,
            recoveryTriggered: result.recoveryTriggered,
            recoveryResultCount: result.recoveryResultCount,
            curatorNarrationUsed: result.curatorNarrationUsed,
            responseTextSource: result.responseTextSource,
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
              anchorSessionId: result.anchorSessionId,
              displaySessionId: result.displaySessionId,
              poolExhausted: result.poolExhausted,
            },
          };
        }

        if (result.refreshMode === "need_clarification" || result.results.length === 0) {
          return {
            type: "text",
            language: result.language,
            text: buildRefreshText(result.language, result.refreshMode, result.shortQuestion, result.poolExhausted, result.summaryText),
            metadata: {
              refreshMode: result.refreshMode,
              reason: result.reason,
              previousQuery: result.query,
              keep: result.keep,
              avoid: result.avoid,
              broaden: result.broaden,
              searchKeywords: result.searchKeywords,
              anchorSessionId: result.anchorSessionId,
              displaySessionId: result.displaySessionId,
              poolExhausted: result.poolExhausted,
            },
          };
        }

        const refreshMode = result.refreshMode as Exclude<RefreshMode, "need_clarification">;

        return {
          type: "gallery_search_results",
          language: result.language,
          text: buildRefreshText(result.language, refreshMode, result.shortQuestion, result.poolExhausted, result.summaryText),
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
            curatorNarration: card.curatorNarration,
          })),
          selectionPrompt: t(result.language, "gallery.search.chooseHint", {
            count: Math.min(result.results.length, 10),
          }),
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
            anchorSessionId: result.anchorSessionId,
            displaySessionId: result.displaySessionId,
            poolExhausted: result.poolExhausted,
          },
        };
      }

      case "gallery_select": {
        const activeSession = await gallerySearchSessionRepository.findLatest({
          discordGuildId: context.discordGuildId,
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

          await recommendationFeedbackService.recordSelection({
            sessionId: activeSession?.id ?? null,
            query: activeSession?.query ?? null,
            selectedCardId: selectResult.selectedCard.galleryCardId,
          });

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

          await recommendationFeedbackService.recordCheckoutCreated({
            sessionId: activeSession?.id ?? null,
            orderNumber: checkoutResult.order.orderNumber,
            query: activeSession?.query ?? null,
            selectedCardId: checkoutResult.selectedCard.galleryCardId,
            discordUserId: context.userId ?? null,
          });

          logger.info("[GALLERY AGENT] checkout created", {
            discordUserId: context.userId ?? "",
            discordChannelId: context.channelId ?? "",
            selectedIndex,
            galleryCardId: checkoutResult.selectedCard.galleryCardId,
            orderNumber: checkoutResult.order.orderNumber,
            productCode: checkoutResult.productCode,
            productUrl: checkoutResult.productUrl,
            purchaseUrl: checkoutResult.purchaseUrl,
          });

          return {
            type: "gallery_checkout_created",
            language: context.language,
            text: buildCheckoutReadyText(context.language),
            title: checkoutResult.productTitle,
            price: checkoutResult.order.amount,
            productUrl: checkoutResult.productUrl,
            purchaseUrl: checkoutResult.purchaseUrl,
            shareImageUrl: checkoutResult.shareImageUrl,
            productHandle: checkoutResult.productHandle,
            orderNumber: checkoutResult.order.orderNumber,
            orderStatus: checkoutResult.order.status,
            metadata: {
              galleryCardId: checkoutResult.selectedCard.galleryCardId,
              title: checkoutResult.productTitle,
              productCode: checkoutResult.productCode,
              price: checkoutResult.order.amount,
              productUrl: checkoutResult.productUrl,
              purchaseUrl: checkoutResult.purchaseUrl,
              shareImageUrl: checkoutResult.shareImageUrl,
              productHandle: checkoutResult.productHandle,
              sku: checkoutResult.sku,
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
            stage: isUserFacingError(error) ? error.stage : "agent",
            code: isUserFacingError(error) ? error.code : "gallery.select.unknown",
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
