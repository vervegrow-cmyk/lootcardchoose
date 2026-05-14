import { gallerySearchSessionRepository } from "../repositories/gallery-search-session.repository";
import {
  IntentClassificationResult,
  fallbackIntentClassification,
  llmIntentClassifierService,
} from "../services/llm-intent-classifier.service";
import { awaitPendingSearchSessionWrite } from "../skills/gallery/search-gallery.skill";
import { extractGalleryKeywordCandidates, isGalleryRefreshMessage, isGallerySelectMessage } from "../utils/gallery-language";
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
  | "rule_gallery_search"
  | "rule_order"
  | "rule_customer_support"
  | "rule_help"
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
  "hi",
  "hello",
  "good morning",
  "shopping",
  "browse",
  "looking",
  "help me",
  "i want to shop",
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
  /\bhas\s+my\s+order\s+shipped\b/i,
  /我的订单/,
  /查询订单/,
  /订单状态/,
  /订单查询/,
  /查订单/,
];

const GALLERY_SEARCH_PATTERNS: RegExp[] = [
  /\b(?:show|find|search|recommend|give)\s+me\b/i,
  /\brecommend\b.+\bcards?\b/i,
  /\bi\s+want\b(?!\s+to\s+shop\b)/i,
  /\bdo\s+you\s+have\b.+\bcards?\b/i,
  /\bany\b.+\bcards?\b/i,
];

const GALLERY_STYLE_TERMS = [
  "anime",
  "dragon",
  "cyberpunk",
  "ssr",
  "red",
  "one piece",
  "sr",
  "ur",
  "female",
  "girl",
  "warrior",
  "fantasy",
  "black gold",
  "dark",
  "cute",
  "mecha",
  "premium",
  "character",
];

const CUSTOMER_SUPPORT_PATTERNS: RegExp[] = [
  /\bwhen\s+will\s+it\s+ship\b/i,
  /\bhow\s+long\s+does\s+delivery\s+take\b/i,
  /\bcan\s+i\s+get\s+a\s+discount\b/i,
  /\bdo\s+you\s+offer\s+free\s+shipping\b/i,
  /\bhow\s+do\s+i\s+pay\b/i,
  /\bcan\s+i\s+buy\s+multiple\s+cards\b/i,
  /\bcan\s+i\s+customi[sz]e\s+a\s+card\b/i,
  /\bwhat\s+if\s+i\s+entered\s+the\s+wrong\s+address\b/i,
  /\bis\s+there\s+a\s+bulk\s+discount\b/i,
  /\bcan\s+i\s+get\s+a\s+better\s+price\s+if\s+i\s+buy\s+more\b/i,
  /\bfree shipping\b/i,
  /\bbulk discount\b/i,
  /\bwrong address\b/i,
  /折扣|包邮|付款|支付|发货|物流|多张|定制|地址/,
];

const HELP_WELCOME_EXACT_PATTERNS: RegExp[] = [
  /^(?:hi|hello|good morning|shopping|browse|looking|help me)$/i,
  /^i want to shop$/i,
];
const NOT_CUSTOMER_SUPPORT_ONLY = ["anime", "cards", "cool", "styles", "ssr", "girl", "red", "one piece", "black gold"];

const detectLanguage = (message: string): SupportedLanguage => (/[\u4e00-\u9fff]/.test(message) ? "zh" : "en");

const hasExplicitCustomerSupportSignal = (text: string): boolean =>
  CUSTOMER_SUPPORT_PATTERNS.some((pattern) => pattern.test(text));

const matchesAnyPhrase = (normalized: string, phrases: string[]): boolean =>
  phrases.some((phrase) => normalized.includes(phrase));

const isHelpWelcomeMessage = (text: string): boolean => HELP_WELCOME_EXACT_PATTERNS.some((pattern) => pattern.test(text.trim()));

const computeIntentConfidence = (text: string): {
  gallerySearchConfidence: number;
  orderStatusConfidence: number;
  customerSupportConfidence: number;
} => {
  const normalized = text.trim().toLowerCase();
  const galleryKeywordCandidates = extractGalleryKeywordCandidates(text);
  const galleryStyleMatch = GALLERY_STYLE_TERMS.some((term) => normalized.includes(term));
  const hasGalleryPattern = GALLERY_SEARCH_PATTERNS.some((pattern) => pattern.test(text));
  const hasOrderPattern = ORDER_PATTERNS.some((pattern) => pattern.test(text));
  const hasSupportPattern = CUSTOMER_SUPPORT_PATTERNS.some((pattern) => pattern.test(text));
  const shortKeywordBrowsePrompt =
    galleryKeywordCandidates.length > 0 &&
    galleryKeywordCandidates.length <= 4 &&
    normalized.split(/\s+/).length <= 5 &&
    !hasOrderPattern &&
    !hasSupportPattern;

  return {
    gallerySearchConfidence:
      (hasGalleryPattern ? 0.92 : 0) +
      (galleryStyleMatch ? 0.12 : 0) +
      (shortKeywordBrowsePrompt ? (galleryStyleMatch ? 0.82 : 0.72) : 0),
    orderStatusConfidence: hasOrderPattern ? 0.97 : 0,
    customerSupportConfidence: hasSupportPattern ? 0.9 : 0,
  };
};

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

      const confidence = computeIntentConfidence(text);

      if (
        isGalleryRefreshMessage(text) &&
        confidence.customerSupportConfidence === 0 &&
        confidence.orderStatusConfidence === 0
      ) {
        path = "rule_refresh";
        resolvedIntent = "gallery_refresh";
        resolvedLanguage = fallbackLanguage;
        return {
          intent: resolvedIntent,
          language: resolvedLanguage,
        };
      }

      if (confidence.gallerySearchConfidence >= confidence.customerSupportConfidence && confidence.gallerySearchConfidence >= 0.92) {
        path = "rule_gallery_search";
        resolvedIntent = "gallery_search";
        resolvedLanguage = fallbackLanguage;
        return {
          intent: resolvedIntent,
          language: resolvedLanguage,
        };
      }

      if (confidence.orderStatusConfidence >= 0.97) {
        path = "rule_order";
        resolvedIntent = "order_status";
        resolvedLanguage = fallbackLanguage;
        return {
          intent: resolvedIntent,
          language: resolvedLanguage,
        };
      }

      if (confidence.customerSupportConfidence > 0) {
        path = "rule_customer_support";
        resolvedIntent = "customer_support";
        resolvedLanguage = fallbackLanguage;
        return {
          intent: resolvedIntent,
          language: resolvedLanguage,
        };
      }

      if (isHelpWelcomeMessage(text) || HELP_PATTERNS.some((pattern) => normalized.includes(pattern))) {
        path = "rule_help";
        resolvedIntent = "help";
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

        if (isHelpWelcomeMessage(text)) {
          resolvedIntent = "help";
          resolvedLanguage = fallback.language;
          return {
            intent: resolvedIntent,
            language: resolvedLanguage,
          };
        }

        if (
          fallback.intent === "ignore" &&
          confidence.gallerySearchConfidence === 0 &&
          confidence.customerSupportConfidence === 0 &&
          confidence.orderStatusConfidence === 0
        ) {
          resolvedIntent = "ignore";
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
      const hasExplicitSupportSignal = hasExplicitCustomerSupportSignal(text);
      const matchesNotCustomerSupportOnly = matchesAnyPhrase(normalized, NOT_CUSTOMER_SUPPORT_ONLY);

      if (
        classified.intent === "customer_support" &&
        !hasExplicitSupportSignal &&
        isHelpWelcomeMessage(text)
      ) {
        resolvedIntent = "help";
      } else if (
        classified.intent === "customer_support" &&
        !hasExplicitSupportSignal &&
        matchesNotCustomerSupportOnly
      ) {
        const fallback = fallbackIntentClassification(text, {
          hasActiveGallerySession,
        });
        resolvedIntent = fallback.intent === "customer_support" ? "gallery_search" : fallback.intent;
        resolvedLanguage = fallback.language;
        return {
          intent: resolvedIntent,
          language: resolvedLanguage,
        };
      } else if (
        classified.intent === "customer_support" &&
        confidence.gallerySearchConfidence >= confidence.customerSupportConfidence &&
        confidence.gallerySearchConfidence >= 0.85
      ) {
        resolvedIntent = "gallery_search";
      } else if (
        classified.intent === "customer_support" &&
        confidence.orderStatusConfidence >= confidence.customerSupportConfidence &&
        confidence.orderStatusConfidence >= 0.9
      ) {
        resolvedIntent = "order_status";
      } else {
        resolvedIntent = classified.intent;
      }
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
    void channelId;
    if (intent === "customer_support") {
      return {
        agentId: "customer-support",
        intent,
      };
    }

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
