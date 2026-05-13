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
import { gallerySearchSessionRepository } from "../repositories/gallery-search-session.repository";
import { isGalleryRefreshMessage, isGallerySelectMessage } from "../utils/gallery-language";
import { logger } from "../utils/logger";

const detectLanguage = (message: string): SupportedLanguage =>
  /[\u4e00-\u9fff]/.test(message) ? "zh" : "en";

const HELP_PATTERNS = [
  "help",
  "帮助",
  "怎么用",
  "how to use",
  "how do i buy",
  "how do i choose",
  "how do i order",
  "怎么买",
  "怎么购买",
  "如何购买",
];

const ORDER_PATTERNS: RegExp[] = [
  /\bmy order\b/i,
  /\border status\b/i,
  /\bwhere(?:'s| is)\s+my\s+order\b/i,
  /\btrack(?:ing)?(?:\s+my)?\s+order\b/i,
  /\bcheck(?:ing)?\s+(?:my\s+)?order(?:\s+status)?\b/i,
  /我的订单/,
  /查询订单/,
  /订单状态/,
  /订单查询/,
  /查订单/,
];

export class HermesRouter {
  constructor(private registry: HermesRegistry) {}

  async determineIntent(
    text: string,
    context?: {
      userId?: string;
      channelId?: string;
    }
  ): Promise<{ intent: IntentId; language: SupportedLanguage }> {
    const normalized = text.trim().toLowerCase();
    const fallbackLanguage = detectLanguage(text);
    const hasActiveGallerySession =
      Boolean(context?.userId && context?.channelId) &&
      Boolean(
        await gallerySearchSessionRepository.findLatest({
          discordUserId: context?.userId ?? "",
          discordChannelId: context?.channelId ?? "",
          status: "active",
        })
      );

    if (!normalized) {
      return { intent: "ignore", language: fallbackLanguage };
    }

    if (isGallerySelectMessage(text, { hasActiveSession: hasActiveGallerySession })) {
      return { intent: "gallery_select", language: fallbackLanguage };
    }

    if (isGalleryRefreshMessage(text)) {
      return { intent: "gallery_refresh", language: fallbackLanguage };
    }

    if (HELP_PATTERNS.some((pattern) => normalized.includes(pattern))) {
      return { intent: "help", language: fallbackLanguage };
    }

    if (ORDER_PATTERNS.some((pattern) => pattern.test(text.trim()))) {
      return { intent: "order_status", language: fallbackLanguage };
    }

    const classified = await llmIntentClassifierService.classify(text, {
      hasActiveGallerySession,
    });
    if (classified.confidence < 0.5) {
      const fallback = fallbackIntentClassification(text, {
        hasActiveGallerySession,
      });
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
    const classification = await this.determineIntent(input.text, {
      userId: input.userId,
      channelId: input.channelId,
    });
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
