"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HermesOrchestrator = void 0;
const logger_1 = require("../utils/logger");
class HermesOrchestrator {
    constructor(options) {
        this.agent = options.agent;
    }
    async run(input, context) {
        logger_1.logger.info("[HERMES ORCHESTRATOR] agent=" + context.agentId);
        return this.agent.handler(input, context);
    }
}
exports.HermesOrchestrator = HermesOrchestrator;
