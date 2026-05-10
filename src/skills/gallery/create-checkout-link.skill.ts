import { SkillContext, SkillHandler } from "../../hermes/types";

export type CreateCheckoutLinkInput = {
  cardId: string;
  quantity?: number;
};

export type CreateCheckoutLinkOutput = {
  url: string;
};

export const createCheckoutLinkSkill: SkillHandler<
  CreateCheckoutLinkInput,
  CreateCheckoutLinkOutput
> = async (input: CreateCheckoutLinkInput, context: SkillContext) => {
  void input;
  void context;
  return { url: "" };
};
