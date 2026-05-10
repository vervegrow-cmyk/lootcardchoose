import { AgentDefinition, SkillDefinition, RegisteredSkill } from "./types";
import { GalleryAgent } from "../agents/gallery/gallery.agent";
import { searchGallerySkill } from "../skills/gallery/search-gallery.skill";

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

  return registry;
};
