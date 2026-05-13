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
import { fallbackIntentClassification, llmIntentClassifierService } from "../services/llm-intent-classifier.service";
import { isGalleryRefreshMessage, isGallerySelectMessage } from "../utils/gallery-language";
import { logger } from "../utils/logger";

const detectLanguage = (message: string): SupportedLanguage =>
  /[\u4e00-\u9fff]/.test(message) ? "zh" : "en";

const HELP_PATTERNS = ["help", "\u5e2e\u52a9", "\u600e\u4e48\u7528", "how to use"];

const ORDER_PATTERNS = [
  "\u6211\u7684\u8ba2\u5355",
  "\u67e5\u8be2\u8ba2\u5355",
  "\u8ba2\u5355\u72b6\u6001",
  "order",
  "my order",
  "order status",
];

export class HermesRouter {
  constructor(private registry: HermesRegistry) {}

  async determineIntent(text: string): Promise<{ intent: IntentId; language: SupportedLanguage }> {
    const normalized = text.trim().toLowerCase();
    const fallbackLanguage = detectLanguage(text);

    if (!normalized) {
      return { intent: "ignore", language: fallbackLanguage };
    }

    if (isGallerySelectMessage(text)) {
      return { intent: "gallery_select", language: fallbackLanguage };
    }

    if (isGalleryRefreshMessage(text)) {
      return { intent: "gallery_refresh", language: fallbackLanguage };
    }

    if (HELP_PATTERNS.some((pattern) => normalized.includes(pattern))) {
      return { intent: "help", language: fallbackLanguage };
    }

    if (ORDER_PATTERNS.some((pattern) => normalized.includes(pattern))) {
      return { intent: "order_status", language: fallbackLanguage };
    }

    const classified = await llmIntentClassifierService.classify(text);
    if (classified.confidence < 0.5) {
      const fallback = fallbackIntentClassification(text);
      if (fallback.intent !== "ignore") {
        return {
          intent: fallback.intent,
          language: fallback.language,
        };
      }

      return {
        intent: "gallery_search",
        language: classified.language,
      };
    }

    return {
      intent: classified.intent,
      language: classified.language,
    };
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
    const classification = await this.determineIntent(input.text);
    logger.info("[HERMES ROUTER] intent=" + classification.intent);
    const decision = this.resolveAgent(classification.intent, input.channelId);
    const agent = this.registry.getAgent(decision.agentId);

    if (!agent) {
      throw new Error(`Agent not registered: ${decision.agentId}`);
    }

    const context: AgentContext = {
      requestId: `${Date.now()}`,
      language: classification.language,
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
