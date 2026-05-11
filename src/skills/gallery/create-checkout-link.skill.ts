import { SkillContext, SkillHandler } from "../../hermes/types";
import { shopifyService } from "../../services/shopify.service";
import { t } from "../../utils/i18n";

export type CreateCheckoutLinkInput = {
  title: string;
  description: string | null;
  imageUrl: string;
  price: string;
  tags: string[];
};

export type CreateCheckoutLinkOutput = {
  url: string;
};

export const createCheckoutLinkSkill: SkillHandler<
  CreateCheckoutLinkInput,
  CreateCheckoutLinkOutput
> = async (input: CreateCheckoutLinkInput, context: SkillContext) => {
  void t(context.language, "checkout.creating");
  try {
    const result = await shopifyService.createCheckoutLink({
      title: input.title,
      description: input.description,
      imageUrl: input.imageUrl,
      price: input.price,
      tags: input.tags,
    });
    return { url: result.checkoutUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Shopify installation not found")) {
      throw new Error(t(context.language, "checkout.failed"));
    }
    throw error;
  }
};
