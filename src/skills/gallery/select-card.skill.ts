import { SkillContext, SkillHandler } from "../../hermes/types";
import { gallerySearchSessionRepository } from "../../repositories/gallery-search-session.repository";
import { galleryService } from "../../services/gallery.service";
import { orderService } from "../../services/order.service";
import { t } from "../../utils/i18n";
import { logger } from "../../utils/logger";

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
  };
};

const buildOutOfRangeText = (language: SkillContext["language"], max: number): string =>
  language === "zh" ? `请选择 1 到 ${max} 之间的编号。` : `Please choose a number from 1 to ${max}.`;

const buildSelectionFailedText = (language: SkillContext["language"]): string =>
  language === "zh" ? "暂时无法处理这次选图，请重新选择或重新搜索。" : "I couldn't complete that selection. Please try another number or search again.";

export const selectCardSkill: SkillHandler<SelectCardInput, SelectCardOutput> = async (
  input: SelectCardInput,
  context: SkillContext
) => {
  const session = await gallerySearchSessionRepository.findLatest({
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
    throw new Error(t(context.language, "gallery.select.invalid"));
  }

  if (input.selectedIndex < 1 || input.selectedIndex > session.results.length) {
    throw new Error(buildOutOfRangeText(context.language, session.results.length));
  }

  const selected = session.results[input.selectedIndex - 1] as { id?: string } | undefined;
  const galleryCardId = selected?.id;
  if (!galleryCardId) {
    throw new Error(t(context.language, "gallery.select.invalid"));
  }

  try {
    const card = await galleryService.getGalleryCardById(galleryCardId);
    if (!card) {
      throw new Error(t(context.language, "gallery.select.invalid"));
    }

    const order = await orderService.createPendingOrder({
      discordUserId: input.discordUserId,
      galleryCardId: card.id,
      amount: card.price.toFixed(2),
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

    if (
      message === t(context.language, "gallery.select.invalid") ||
      message === buildOutOfRangeText(context.language, session.results.length)
    ) {
      throw error;
    }

    throw new Error(buildSelectionFailedText(context.language));
  }
};
