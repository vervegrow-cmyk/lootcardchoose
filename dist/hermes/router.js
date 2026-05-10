"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HermesRouter = void 0;
const orchestrator_1 = require("./orchestrator");
const logger_1 = require("../utils/logger");
class HermesRouter {
    constructor(registry) {
        this.registry = registry;
    }
    determineIntent(text) {
        const normalized = text.trim().toLowerCase();
        if (!normalized) {
            return "ignore";
        }
        if (/^\d+$/.test(normalized) || /选择\d+/.test(normalized)) {
            return "gallery_select";
        }
        if (normalized.includes("订单") || normalized.includes("order")) {
            return "order_status";
        }
        if (normalized.includes("帮助") || normalized === "help") {
            return "help";
        }
        if (normalized.includes("给我") ||
            normalized.includes("找图") ||
            normalized.includes("黑金") ||
            normalized.includes("ssr") ||
            normalized.includes("赛博朋克") ||
            normalized.includes("女角色")) {
            return "gallery_search";
        }
        return "ignore";
    }
    resolveAgent(intent, channelId) {
        void intent;
        void channelId;
        return {
            agentId: "lootcardchoose",
            intent,
        };
    }
    async handle(input) {
        const intent = this.determineIntent(input.text);
        logger_1.logger.info("[HERMES ROUTER] intent=" + intent);
        const decision = this.resolveAgent(intent, input.channelId);
        const agent = this.registry.getAgent(decision.agentId);
        if (!agent) {
            throw new Error(`Agent not registered: ${decision.agentId}`);
        }
        const context = {
            requestId: `${Date.now()}`,
            userId: input.userId,
            channelId: input.channelId,
            agentId: decision.agentId,
            intent: decision.intent,
        };
        const hermesInput = { text: input.text };
        const orchestrator = new orchestrator_1.HermesOrchestrator({ agent });
        return orchestrator.run(hermesInput, context);
    }
    async route(agentId, input, context) {
        const agent = this.registry.getAgent(agentId);
        if (!agent) {
            throw new Error(`Agent not registered: ${agentId}`);
        }
        const orchestrator = new orchestrator_1.HermesOrchestrator({ agent });
        return orchestrator.run(input, context);
    }
}
exports.HermesRouter = HermesRouter;
