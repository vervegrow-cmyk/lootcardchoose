import { SkillContext, SkillHandler } from "../../hermes/types";
import { orderService } from "../../services/order.service";
import { gallerySearchSessionRepository } from "../../repositories/gallery-search-session.repository";
import { galleryService } from "../../services/gallery.service";

export type SelectCardInput = {
  discordUserId: string;
  discordChannelId: string;
  selectedIndex: number;
};

export type SelectCardOutput = {
  orderId: string;
  orderNumber: string;
  galleryCardId: string;
  title: string;
  description: string | null;
  imageUrl: string;
  price: string;
  tags: string[];
};

export const selectCardSkill: SkillHandler<SelectCardInput, SelectCardOutput> = async (
  input: SelectCardInput,
  context: SkillContext
) => {
  void context;
  const session = await gallerySearchSessionRepository.findLatest({
    discordUserId: input.discordUserId,
    discordChannelId: input.discordChannelId,
  });

  if (!session || !Array.isArray(session.results)) {
    throw new Error("NO_SEARCH_SESSION");
  }

  const selected = session.results[input.selectedIndex - 1] as { id?: string } | undefined;
  const galleryCardId = selected?.id;
  if (!galleryCardId) {
    throw new Error("INVALID_SELECTION");
  }

  const card = await galleryService.getGalleryCardById(galleryCardId);
  if (!card) {
    throw new Error("CARD_NOT_FOUND");
  }

  const order = await orderService.createOrder({
    discordUserId: input.discordUserId,
    galleryCardId: card.id,
    amount: card.price.toFixed(2),
  });

  await gallerySearchSessionRepository.updateSelectedCard({
    sessionId: session.id,
    galleryCardId: card.id,
  });

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    galleryCardId: card.id,
    title: card.title,
    description: card.description,
    imageUrl: card.imageUrl,
    price: card.price.toFixed(2),
    tags: card.tags,
  };
};
