import { CustomerSupportKnowledgeBundle } from "../../agents/customer-support/customer-support.types";
import { SkillHandler } from "../../hermes/types";
import { customerSupportQaService } from "../../services/customer-support-qa.service";

export type LoadCustomerSupportQaInput = Record<string, never>;

export type LoadCustomerSupportQaOutput = CustomerSupportKnowledgeBundle;

export const loadCustomerSupportQaSkill: SkillHandler<
  LoadCustomerSupportQaInput,
  LoadCustomerSupportQaOutput
> = async () => customerSupportQaService.loadKnowledgeBundle();
