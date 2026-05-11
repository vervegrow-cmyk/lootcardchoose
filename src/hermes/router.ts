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

const GALLERY_SELECT_PATTERNS: RegExp[] = [
  /^\d+$/,
  /^\u9009\u62e9\s*\d+$/,
  /^\u9009\u7b2c\s*\d+\s*\u5f20$/,
  /^\u6211\u8981\u7b2c\s*\d+\s*\u5f20$/,
  /^choose\s+\d+$/,
  /^select\s+\d+$/,
  /^number\s+\d+$/,
];

const HELP_PATTERNS = ["help", "\u5e2e\u52a9", "\u600e\u4e48\u7528", "how to use"];

const ORDER_PATTERNS = [
  "\u6211\u7684\u8ba2\u5355",
  "\u67e5\u8be2\u8ba2\u5355",
  "\u8ba2\u5355\u72b6\u6001",
  "order",
  "my order",
  "order status",
];

const GALLERY_SEARCH_PATTERNS = [
  "\u641c\u7d22\u56fe\u5e93",
  "\u56fe\u5e93",
  "\u641c\u7d22\u5361\u724c",
  "\u627e\u5361\u724c",
  "\u627e\u56fe",
  "\u627e\u5361",
  "\u5361\u724c",
  "\u7ed9\u6211",
  "\u6211\u8981",
  "\u9ed1\u91d1",
  "\u5973\u89d2\u8272",
  "\u8d5b\u535a\u670b\u514b",
  "\u673a\u7532",
  "ssr",
  "black gold",
  "female",
  "card",
  "cards",
  "gallery",
  "search",
  "show me",
  "cyberpunk",
  "mecha",
  "anime",
];

export class HermesRouter {
  constructor(private registry: HermesRegistry) {}

  determineIntent(text: string): IntentId {
    const normalized = text.trim().toLowerCase();

    if (!normalized) {
      return "ignore";
    }

    if (GALLERY_SELECT_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return "gallery_select";
    }

    if (HELP_PATTERNS.some((pattern) => normalized.includes(pattern))) {
      return "help";
    }

    if (ORDER_PATTERNS.some((pattern) => normalized.includes(pattern))) {
      return "order_status";
    }

    if (GALLERY_SEARCH_PATTERNS.some((pattern) => normalized.includes(pattern))) {
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
