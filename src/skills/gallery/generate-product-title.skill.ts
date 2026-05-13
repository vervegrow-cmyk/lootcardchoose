import { SkillContext, SkillHandler } from "../../hermes/types";
import {
  GenerateMarketingTitleOutput,
  cardNamingService,
} from "../../services/card-naming.service";
import { logger } from "../../utils/logger";

export type GenerateProductTitleInput = {
  galleryCardId: string;
  orderNumber: string;
};

export type GenerateProductTitleOutput = GenerateMarketingTitleOutput;

export const generateProductTitleSkill: SkillHandler<
  GenerateProductTitleInput,
  GenerateProductTitleOutput
> = async (input: GenerateProductTitleInput, _context: SkillContext) => {
  logger.info("[GENERATE PRODUCT TITLE SKILL] start", {
    galleryCardId: input.galleryCardId,
    orderNumber: input.orderNumber,
  });

  const result = await cardNamingService.generateMarketingTitle(input);

  logger.info("[GENERATE PRODUCT TITLE SKILL] success", {
    galleryCardId: input.galleryCardId,
    orderNumber: input.orderNumber,
    marketingTitle: result.marketingTitle,
    source: result.source,
  });

  return result;
};

