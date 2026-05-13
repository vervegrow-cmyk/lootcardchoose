import { AgentDefinition, SkillDefinition, RegisteredSkill } from "./types";
import { GalleryAgent } from "../agents/gallery/gallery.agent";
import { CreateCheckoutLinkSkill } from "../skills/gallery/create-checkout-link.skill";
import { galleryHelpSkill } from "../skills/gallery/gallery-help.skill";
import { generateProductTitleSkill } from "../skills/gallery/generate-product-title.skill";
import { refreshGallerySkill } from "../skills/gallery/refresh-gallery.skill";
import { searchGallerySkill } from "../skills/gallery/search-gallery.skill";
import { selectCardSkill } from "../skills/gallery/select-card.skill";

export class HermesRegistry {
  private agents = new Map<string, AgentDefinition>();
  private skills = new Map<string, RegisteredSkill>();

  registerAgent(agent: AgentDefinition): void {
    this.agents.set(agent.id, agent);
  }

  registerSkill<TInput, TOutput>(skill: SkillDefinition<TInput, TOutput>): void {
    this.skills.set(skill.id, skill as RegisteredSkill);
  }

  getAgent(agentId: string): AgentDefinition | undefined {
    return this.agents.get(agentId);
  }

  getSkill(skillId: string): RegisteredSkill | undefined {
    return this.skills.get(skillId);
  }

  listAgents(): AgentDefinition[] {
    return [...this.agents.values()];
  }

  listSkills(): RegisteredSkill[] {
    return [...this.skills.values()];
  }
}

export const buildHermesRegistry = (): HermesRegistry => {
  const registry = new HermesRegistry();

  registry.registerAgent(GalleryAgent);
  registry.registerSkill({
    id: "gallery.search",
    name: "SearchGallerySkill",
    handler: searchGallerySkill,
  });
  registry.registerSkill({
    id: "gallery.refresh",
    name: "RefreshGallerySkill",
    handler: refreshGallerySkill,
  });
  registry.registerSkill({
    id: "gallery.selectCard",
    name: "SelectCardSkill",
    handler: selectCardSkill,
  });
  registry.registerSkill({
    id: "gallery.generateProductTitle",
    name: "GenerateProductTitleSkill",
    handler: generateProductTitleSkill,
  });
  registry.registerSkill({
    id: "gallery.createCheckoutLink",
    name: "CreateCheckoutLinkSkill",
    handler: CreateCheckoutLinkSkill.handle,
  });
  registry.registerSkill({
    id: "gallery.help",
    name: "GalleryHelpSkill",
    handler: galleryHelpSkill,
  });

  return registry;
};
