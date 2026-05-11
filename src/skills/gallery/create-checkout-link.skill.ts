import { SkillContext, SkillHandler } from "../../hermes/types";
import { shopifyService } from "../../services/shopify.service";

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
  void context;
  const result = await shopifyService.createCheckoutLink({
    title: input.title,
    description: input.description,
    imageUrl: input.imageUrl,
    price: input.price,
    tags: input.tags,
  });
  return { url: result.checkoutUrl };
};
