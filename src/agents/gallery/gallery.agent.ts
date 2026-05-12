import { AgentContext, AgentDefinition, HermesInput, HermesOutput } from "../../hermes/types";
import { createCheckoutLinkSkill } from "../../skills/gallery/create-checkout-link.skill";
import { searchGallerySkill } from "../../skills/gallery/search-gallery.skill";
import { selectCardSkill } from "../../skills/gallery/select-card.skill";
import { logger } from "../../utils/logger";

const buildSearchSuccessText = (language: AgentContext["language"], count: number): string =>
  language === "zh"
    ? `涓轰綘鎵惧埌 ${count} 寮犲崱鐗屾牱寮忥紝鍥炲缂栧彿 1-${count} 閫夋嫨銆俙`
    : `Found ${count} card styles for you. Reply with a number from 1-${count} to choose.`;

const buildSearchEmptyText = (language: AgentContext["language"]): string =>
  language === "zh"
    ? "娌℃湁鎵惧埌鍖归厤鐨勫崱鐗岋紝璇锋崲涓€涓弿杩拌瘯璇曪紝渚嬪锛氶粦閲?SSR 濂宠鑹层€?"
    : "No matching cards found. Try another description, for example: black gold SSR female card.";

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
          language: context.language,
          text: buildSearchEmptyText(context.language),
        };
      }

      return {
        type: "gallery_search_results",
        language: context.language,
        text: buildSearchSuccessText(context.language, result.results.length),
        cards: result.results.map((card) => ({
          id: card.id,
          title: card.title,
          description: card.description,
          imageUrl: card.imageUrl,
          price: card.price,
          tags: card.tags,
        })),
        selectionPrompt:
          context.language === "zh"
            ? `鍥炲缂栧彿 1-${result.results.length} 閫夋嫨銆俙`
            : `Reply with a number from 1-${result.results.length} to choose.`,
        metadata: {
          query: result.query,
          parsedQuery: result.parsedQuery ?? undefined,
          limit: result.limit,
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
          text: context.language === "zh" ? "璇烽€夋嫨鏈夋晥缂栧彿锛?-10锛夈€?" : "Please choose a valid number (1-10).",
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
          orderId: selected.orderId,
          title: selected.title,
          description: selected.description,
          imageUrl: selected.imageUrl,
          price: selected.price,
          tags: selected.tags,
          orderNumber: selected.orderNumber,
        },
        { ...context, skillId: "gallery.createCheckoutLink" }
      );

      return {
        type: "text",
        language: context.language,
        text: `✅ Your card listing is ready!\n\nItem: ${selected.title}\nPrice: $${selected.price}\nProduct page: ${checkout.productUrl}\n\nYou can review the card and complete checkout from the product page.`,
      };
    }

    if (context.intent === "help") {
      logger.info("[GALLERY AGENT] handling help");
      return {
        type: "text",
        language: context.language,
        text:
          context.language === "zh"
            ? "杈撳叆绀轰緥锛氱粰鎴?0寮犻粦閲慡SR濂宠鑹插崱鐗屻€傜劧鍚庡洖澶?1-10 杩涜閫夋嫨銆?"
            : "Example: Show me 10 black gold SSR female character cards. Then reply with a number from 1-10.",
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
      text:
        context.language === "zh"
          ? "杈撳叆绀轰緥锛氱粰鎴?0寮犻粦閲慡SR濂宠鑹插崱鐗屻€傜劧鍚庡洖澶?1-10 杩涜閫夋嫨銆?"
          : "Example: Show me 10 black gold SSR female character cards. Then reply with a number from 1-10.",
    };
  },
};
