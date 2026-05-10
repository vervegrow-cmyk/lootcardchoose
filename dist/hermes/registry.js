"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildHermesRegistry = exports.HermesRegistry = void 0;
const gallery_agent_1 = require("../agents/gallery/gallery.agent");
const search_gallery_skill_1 = require("../skills/gallery/search-gallery.skill");
class HermesRegistry {
    constructor() {
        this.agents = new Map();
        this.skills = new Map();
    }
    registerAgent(agent) {
        this.agents.set(agent.id, agent);
    }
    registerSkill(skill) {
        this.skills.set(skill.id, skill);
    }
    getAgent(agentId) {
        return this.agents.get(agentId);
    }
    getSkill(skillId) {
        return this.skills.get(skillId);
    }
    listAgents() {
        return [...this.agents.values()];
    }
    listSkills() {
        return [...this.skills.values()];
    }
}
exports.HermesRegistry = HermesRegistry;
const buildHermesRegistry = () => {
    const registry = new HermesRegistry();
    registry.registerAgent(gallery_agent_1.GalleryAgent);
    registry.registerSkill({
        id: "gallery.search",
        name: "SearchGallerySkill",
        handler: search_gallery_skill_1.searchGallerySkill,
    });
    return registry;
};
exports.buildHermesRegistry = buildHermesRegistry;
