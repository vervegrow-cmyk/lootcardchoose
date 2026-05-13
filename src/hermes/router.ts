import { gallerySearchSessionRepository } from "../repositories/gallery-search-session.repository";
import {
  IntentClassificationResult,
  fallbackIntentClassification,
  llmIntentClassifierService,
} from "../services/llm-intent-classifier.service";
import { awaitPendingSearchSessionWrite } from "../skills/gallery/search-gallery.skill";
import { isGalleryRefreshMessage, isGallerySelectMessage } from "../utils/gallery-language";
import { logger } from "../utils/logger";
import { HermesOrchestrator } from "./orchestrator";
import { HermesRegistry } from "./registry";
import {
  AgentContext,
  AgentId,
  HermesInput,
  HermesOutput,
  IntentId,
  RouterInput,
  RoutingDecision,
  SupportedLanguage,
} from "./types";

type DetermineIntentPath =
  | "rule_select"
  | "rule_refresh"
  | "rule_help"
  | "rule_order"
  | "llm"
  | "llm_low_confidence_fallback"
  | "llm_timeout_fallback"
  | "llm_parse_fallback";

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

const detectLanguage = (message: string): SupportedLanguage => (/[\u4e00-\u9fff]/.test(message) ? "zh" : "en");

const resolveClassifiedPath = (classification: IntentClassificationResult): DetermineIntentPath => {
  if (classification.source !== "fallback") {
    return "llm";
  }

  if (classification.fallbackReason === "timeout") {
    return "llm_timeout_fallback";
  }

  return "llm_parse_fallback";
};

export class HermesRouter {
  constructor(private registry: HermesRegistry) {}

  async determineIntent(
    text: string,
    context?: {
      userId?: string;
      channelId?: string;
    }
  ): Promise<{ intent: IntentId; language: SupportedLanguage }> {
    const startedAt = Date.now();
    const normalized = text.trim().toLowerCase();
    const fallbackLanguage = detectLanguage(text);
    let hasActiveGallerySession = false;
    let resolvedIntent: IntentId = "ignore";
    let resolvedLanguage: SupportedLanguage = fallbackLanguage;
    let path: DetermineIntentPath = "llm";

    logger.info("[ROUTER] determineIntent start", {
      userId: context?.userId ?? "",
      channelId: context?.channelId ?? "",
      text,
    });

    try {
      if (context?.userId && context?.channelId) {
        const completed = await awaitPendingSearchSessionWrite({
          discordUserId: context.userId,
          discordChannelId: context.channelId,
          timeoutMs: 1200,
        });

        if (!completed) {
          logger.warn("[ROUTER] pending search session wait timeout", {
            userId: context.userId,
            channelId: context.channelId,
            timeoutMs: 1200,
          });
        }

        hasActiveGallerySession = Boolean(
          await gallerySearchSessionRepository.findLatest({
            discordUserId: context.userId,
            discordChannelId: context.channelId,
            status: "active",
          })
        );
      }

      if (!normalized) {
        resolvedIntent = "ignore";
        resolvedLanguage = fallbackLanguage;
        return {
          intent: resolvedIntent,
          language: resolvedLanguage,
        };
      }

      if (isGallerySelectMessage(text, { hasActiveSession: hasActiveGallerySession })) {
        path = "rule_select";
        resolvedIntent = "gallery_select";
        resolvedLanguage = fallbackLanguage;
        return {
          intent: resolvedIntent,
          language: resolvedLanguage,
        };
      }

      if (isGalleryRefreshMessage(text)) {
        path = "rule_refresh";
        resolvedIntent = "gallery_refresh";
        resolvedLanguage = fallbackLanguage;
        return {
          intent: resolvedIntent,
          language: resolvedLanguage,
        };
      }

      if (HELP_PATTERNS.some((pattern) => normalized.includes(pattern))) {
        path = "rule_help";
        resolvedIntent = "help";
        resolvedLanguage = fallbackLanguage;
        return {
          intent: resolvedIntent,
          language: resolvedLanguage,
        };
      }

      if (ORDER_PATTERNS.some((pattern) => pattern.test(text.trim()))) {
        path = "rule_order";
        resolvedIntent = "order_status";
        resolvedLanguage = fallbackLanguage;
        return {
          intent: resolvedIntent,
          language: resolvedLanguage,
        };
      }

      const classified = await llmIntentClassifierService.classify(text, {
        hasActiveGallerySession,
      });
      const classifiedPath = resolveClassifiedPath(classified);

      if (classified.confidence < 0.5) {
        const fallback = fallbackIntentClassification(text, {
          hasActiveGallerySession,
        });

        path =
          classified.source === "fallback" && classified.fallbackReason
            ? classifiedPath
            : "llm_low_confidence_fallback";
        if (fallback.intent !== "ignore") {
          resolvedIntent = fallback.intent;
          resolvedLanguage = fallback.language;
          return {
            intent: resolvedIntent,
            language: resolvedLanguage,
          };
        }

        resolvedIntent = "gallery_search";
        resolvedLanguage = classified.language;
        return {
          intent: resolvedIntent,
          language: resolvedLanguage,
        };
      }

      path = resolveClassifiedPath(classified);
      resolvedIntent = classified.intent;
      resolvedLanguage = classified.language;
      return {
        intent: resolvedIntent,
        language: resolvedLanguage,
      };
    } finally {
      logger.info("[ROUTER] determineIntent end", {
        userId: context?.userId ?? "",
        channelId: context?.channelId ?? "",
        text,
        intent: resolvedIntent,
        language: resolvedLanguage,
        hasActiveGallerySession,
        path,
        latencyMs: Date.now() - startedAt,
      });
    }
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
