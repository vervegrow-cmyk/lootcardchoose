import { SkillContext, SkillHandler } from "../../hermes/types";
import { galleryHelpService } from "../../services/gallery-help.service";

export type GalleryHelpInput = {
  message: string;
};

export type GalleryHelpOutput = {
  language: SkillContext["language"];
  text: string;
  usedFallback: boolean;
};

export const galleryHelpSkill: SkillHandler<GalleryHelpInput, GalleryHelpOutput> = async (input, context) => {
  const response = await galleryHelpService.answerInquiry(input.message, context.language);
  return {
    language: response.language,
    text: response.text,
    usedFallback: response.usedFallback,
  };
};
