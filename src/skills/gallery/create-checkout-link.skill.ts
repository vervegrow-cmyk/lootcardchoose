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
    if (message.includes("Shopify authorization failed")) {
      throw new Error(
        "Shopify 授权失败，请检查 SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET / App 是否已安装到店铺。",
      );
    }
    throw error;
  }
};
