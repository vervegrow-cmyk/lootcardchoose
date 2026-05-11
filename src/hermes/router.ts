import { HermesRegistry } from "./registry";
import {
  HermesInput,
  HermesOutput,
  AgentId,
  AgentContext,
  RouterInput,
  RoutingDecision,
  IntentId,
  SupportedLanguage,
} from "./types";
import { HermesOrchestrator } from "./orchestrator";
import { logger } from "../utils/logger";

const detectLanguage = (message: string): SupportedLanguage =>
  /[\u4e00-\u9fff]/.test(message) ? "zh" : "en";

export class HermesRouter {
  constructor(private registry: HermesRegistry) {}

  determineIntent(text: string): IntentId {
    const normalized = text.trim().toLowerCase();

    if (!normalized) {
      return "ignore";
    }

    if (/^\d+$/.test(normalized) || /^选择\s*\d+$/.test(normalized) || /^choose\s*\d+$/.test(normalized)) {
      return "gallery_select";
    }

    if (normalized.includes("订单") || normalized.includes("order")) {
      return "order_status";
    }

    if (normalized.includes("帮助") || normalized === "help") {
      return "help";
    }

    if (
      normalized.includes("给我") ||
      normalized.includes("找图") ||
      normalized.includes("找卡") ||
      normalized.includes("黑金") ||
      normalized.includes("ssr") ||
      normalized.includes("赛博朋克") ||
      normalized.includes("女角色") ||
      normalized.includes("机甲") ||
      normalized.includes("show me") ||
      normalized.includes("black gold") ||
      normalized.includes("female character") ||
      normalized.includes("cyberpunk") ||
      normalized.includes("mecha") ||
      normalized.includes("card")
    ) {
      return "gallery_search";
    }

    return "ignore";
  }

  resolveAgent(intent: IntentId, channelId: string): RoutingDecision {
    void intent;
    void channelId;
    return {
      agentId: "lootcardchoose",
      intent,
    };
  }

  async handle(input: RouterInput): Promise<HermesOutput> {
    const intent = this.determineIntent(input.text);
    logger.info("[HERMES ROUTER] intent=" + intent);
    const decision = this.resolveAgent(intent, input.channelId);
    const agent = this.registry.getAgent(decision.agentId);

    if (!agent) {
      throw new Error(`Agent not registered: ${decision.agentId}`);
    }

    const context: AgentContext = {
      requestId: `${Date.now()}`,
      language: detectLanguage(input.text),
      userId: input.userId,
      channelId: input.channelId,
      agentId: decision.agentId,
      intent: decision.intent,
    };

    const hermesInput: HermesInput = { text: input.text };
    const orchestrator = new HermesOrchestrator({ agent });
    return orchestrator.run(hermesInput, context);
  }

  async route(agentId: AgentId, input: HermesInput, context: AgentContext): Promise<HermesOutput> {
    const agent = this.registry.getAgent(agentId);

    if (!agent) {
      throw new Error(`Agent not registered: ${agentId}`);
    }

    const orchestrator = new HermesOrchestrator({ agent });
    return orchestrator.run(input, context);
  }
}
