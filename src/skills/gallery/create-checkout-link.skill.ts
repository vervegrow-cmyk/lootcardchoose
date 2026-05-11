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
      throw new Error(
        "Shopify 尚未完成安装授权，请先访问应用的授权入口完成安装。",
      );
    }
    throw error;
  }
};
