import { SkillContext, SkillHandler } from "../../hermes/types";
import { gallerySearchSessionRepository } from "../../repositories/gallery-search-session.repository";
import { galleryService } from "../../services/gallery.service";
import { orderService } from "../../services/order.service";
import { t } from "../../utils/i18n";

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

export const selectCardSkill: SkillHandler<SelectCardInput, SelectCardOutput> = async (
  input: SelectCardInput,
  context: SkillContext
) => {
  const session = await gallerySearchSessionRepository.findLatest({
    discordUserId: input.discordUserId,
    discordChannelId: input.discordChannelId,
    status: "active",
  });

  if (!session || !Array.isArray(session.results)) {
    throw new Error(t(context.language, "gallery.select.invalid"));
  }

  const selected = session.results[input.selectedIndex - 1] as { id?: string } | undefined;
  const galleryCardId = selected?.id;
  if (!galleryCardId) {
    throw new Error(t(context.language, "gallery.select.invalid"));
  }

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
};
