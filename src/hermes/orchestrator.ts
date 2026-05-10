import { AgentDefinition, AgentHandler, HermesInput, HermesOutput } from "./types";
import { logger } from "../utils/logger";

export type OrchestratorOptions = {
  agent: AgentDefinition;
};

export class HermesOrchestrator {
  private agent: AgentDefinition;

  constructor(options: OrchestratorOptions) {
    this.agent = options.agent;
  }

  async run(input: HermesInput, context: Parameters<AgentHandler>[1]): Promise<HermesOutput> {
    logger.info("[HERMES ORCHESTRATOR] agent=" + context.agentId);
    return this.agent.handler(input, context);
  }
}
