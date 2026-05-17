import { SkillContext, SkillHandler } from "../../hermes/types";
import { gallerySearchSessionRepository } from "../../repositories/gallery-search-session.repository";
import { galleryService } from "../../services/gallery.service";
import { orderService } from "../../services/order.service";
import { t } from "../../utils/i18n";
import { logger } from "../../utils/logger";
import { UserFacingError, isUserFacingError } from "../../utils/user-facing-error";

export type SelectCardInput = {
  discordUserId: string;
  discordChannelId: string;
  selectedIndex: number;
};

export type SelectCardOutput = {
  selectedCard: {
    galleryCardId: string;
    title: string;
    description: string | null;
    imageUrl: string;
    price: string;
    tags: string[];
  };
  order: {
    id: string;
    orderNumber: string;
    amount: string;
    status: string;
    shopifyProductId: string | null;
    shopifyCheckoutUrl: string | null;
    shopifyProductUrl: string | null;
    shopifyShareImageUrl: string | null;
    shopifyProductHandle: string | null;
  };
};

const resolvePreferredLanguage = (
  session: Awaited<ReturnType<typeof gallerySearchSessionRepository.findLatest>>,
  fallbackLanguage: SkillContext["language"]
): SkillContext["language"] => {
  if (session && Array.isArray(session.results)) {
    const firstResult = session.results[0] as { language?: unknown } | undefined;
    if (firstResult?.language === "zh" || firstResult?.language === "en") {
      return firstResult.language;
    }
  }

  return fallbackLanguage;
};

const buildOutOfRangeText = (language: SkillContext["language"], max: number): string =>
  language === "zh" ? `请选择 1 到 ${max} 之间的编号。` : `Please choose a number from 1 to ${max}.`;

const buildSelectionFailedText = (language: SkillContext["language"]): string =>
  language === "zh"
    ? "这次选图没有成功，请换个编号或重新搜索试试。"
    : "I couldn't complete that selection. Please try another number or search again.";

export const selectCardSkill: SkillHandler<SelectCardInput, SelectCardOutput> = async (
  input: SelectCardInput,
  context: SkillContext
) => {
  const session = await gallerySearchSessionRepository.findLatest({
    discordGuildId: context.discordGuildId,
    discordUserId: input.discordUserId,
    discordChannelId: input.discordChannelId,
    status: "active",
  });

  logger.info("[SELECT CARD SKILL] session lookup", {
    discordUserId: input.discordUserId,
    discordChannelId: input.discordChannelId,
    selectedIndex: input.selectedIndex,
    sessionId: session?.id ?? null,
    hasResults: Array.isArray(session?.results),
    resultCount: Array.isArray(session?.results) ? session.results.length : 0,
  });

  if (!session || !Array.isArray(session.results)) {
    throw new UserFacingError(t(context.language, "gallery.select.invalid"), {
      code: "gallery.select.invalid",
      stage: "select",
      metadata: {
        discordUserId: input.discordUserId,
        discordChannelId: input.discordChannelId,
        selectedIndex: input.selectedIndex,
      },
    });
  }

  if (input.selectedIndex < 1 || input.selectedIndex > session.results.length) {
    throw new UserFacingError(buildOutOfRangeText(context.language, session.results.length), {
      code: "gallery.select.out_of_range",
      stage: "select",
      metadata: {
        sessionId: session.id,
        selectedIndex: input.selectedIndex,
        maxIndex: session.results.length,
      },
    });
  }

  const selected = session.results[input.selectedIndex - 1] as { id?: string } | undefined;
  const galleryCardId = selected?.id;
  if (!galleryCardId) {
    throw new UserFacingError(t(context.language, "gallery.select.invalid"), {
      code: "gallery.select.invalid",
      stage: "select",
      metadata: {
        sessionId: session.id,
        selectedIndex: input.selectedIndex,
      },
    });
  }

  try {
    const card = await galleryService.getGalleryCardById(galleryCardId);
    if (!card) {
      throw new UserFacingError(t(context.language, "gallery.select.invalid"), {
        code: "gallery.select.card_not_found",
        stage: "select",
        metadata: {
          sessionId: session.id,
          galleryCardId,
        },
      });
    }

    const order = await orderService.createPendingOrder({
      discordUserId: input.discordUserId,
      galleryCardId: card.id,
      amount: card.price.toFixed(2),
      preferredLanguage: resolvePreferredLanguage(session, context.language),
    });

    await gallerySearchSessionRepository.updateSelectedCard({
      sessionId: session.id,
      galleryCardId: card.id,
    });

    logger.info("[SELECT CARD SKILL] selection created", {
      sessionId: session.id,
      selectedIndex: input.selectedIndex,
      galleryCardId: card.id,
      orderNumber: order.orderNumber,
      orderStatus: order.status,
    });

    return {
      selectedCard: {
        galleryCardId: card.id,
        title: card.title,
        description: card.description,
        imageUrl: card.imageUrl,
        price: card.price.toFixed(2),
        tags: card.tags,
      },
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        amount: order.amount,
        status: order.status,
        shopifyProductId: order.shopifyProductId,
        shopifyCheckoutUrl: order.shopifyCheckoutUrl,
        shopifyProductUrl: order.shopifyProductUrl,
        shopifyShareImageUrl: order.shopifyShareImageUrl,
        shopifyProductHandle: order.shopifyProductHandle,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("[SELECT CARD SKILL] selection failed", {
      discordUserId: input.discordUserId,
      discordChannelId: input.discordChannelId,
      selectedIndex: input.selectedIndex,
      sessionId: session.id,
      galleryCardId,
      message,
    });

    if (isUserFacingError(error)) {
      throw error;
    }

    throw new UserFacingError(buildSelectionFailedText(context.language), {
      code: "gallery.select.failed",
      stage: "select",
      metadata: {
        sessionId: session.id,
        galleryCardId,
        message,
      },
    });
  }
};
