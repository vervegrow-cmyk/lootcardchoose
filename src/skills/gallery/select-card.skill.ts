import { SkillContext, SkillHandler } from "../../hermes/types";

export type SelectCardInput = {
  cardId: string;
  reason?: string;
};

export type SelectCardOutput = {
  selected: boolean;
};

export const selectCardSkill: SkillHandler<SelectCardInput, SelectCardOutput> = async (
  input: SelectCardInput,
  context: SkillContext
) => {
  void input;
  void context;
  return { selected: false };
};
