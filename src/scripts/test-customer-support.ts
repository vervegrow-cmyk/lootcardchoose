import assert from "node:assert/strict";
import { buildHermesRegistry } from "../hermes/registry";
import { HermesRouter } from "../hermes/router";
import { gallerySearchSessionRepository } from "../repositories/gallery-search-session.repository";
import { customerSupportQaService } from "../services/customer-support-qa.service";
import { customerSupportLlmService } from "../services/customer-support-llm.service";

const run = async (): Promise<void> => {
  const router = new HermesRouter(buildHermesRegistry());
  const knowledgeBundle = customerSupportQaService.loadKnowledgeBundle();
  assert.ok(knowledgeBundle.entries.length >= 21, "Expected expanded customer support QA entries");
  assert.match(knowledgeBundle.styleRulesText, /Match user language/i);
  assert.match(knowledgeBundle.fallbackRulesText, /do not invent/i);

  const originalFindLatest = gallerySearchSessionRepository.findLatest;
  gallerySearchSessionRepository.findLatest = async () => null;

  try {
    const galleryCases = [
      "girl",
      "anime",
      "ssr",
      "SSR",
      "black gold",
      "black gold SSR girl",
      "show me 10 cyberpunk cards",
      "recommend cards",
      "dragon",
      "queen",
      "angel",
      "red",
      "dark",
      "gold",
      "dark royal energy",
      "Give me the vibe of a corrupted angel queen",
      "Show me cards that look like legendary relics from a fallen kingdom",
      "I want something that feels forbidden but beautiful",
      "Recommend cards with dark royal energy",
      "I want a collectible that feels expensive and dangerous",
    ];

    for (const message of galleryCases) {
      const result = await router.determineIntent(message, {
        userId: "test-gallery-user",
        channelId: "test-gallery-channel",
        isDM: false,
      });
      assert.equal(result.intent, "gallery_search", `Expected gallery_search for ${message}`);
    }

    const supportCases = [
      "i want usps",
      "I want ups shipping",
      "I want to use UPS shipping",
      "Can I use USPS?",
      "shipping",
      "delivery",
      "tracking",
      "where is my order",
      "payment",
      "what payment",
      "refund",
      "checkout problem",
    ];

    for (const message of supportCases) {
      const result = await router.determineIntent(message, {
        userId: "test-support-user",
        channelId: "test-support-channel",
        isDM: false,
      });
      assert.equal(result.intent, "customer_support", `Expected customer_support for ${message}`);
    }

    const dmSupportCases = ["shipping", "refund", "tracking", "payment", "where is my order", "checkout problem"];
    for (const message of dmSupportCases) {
      const result = await router.determineIntent(message, {
        userId: "test-dm-support-user",
        channelId: "test-dm-support-channel",
        discordGuildId: null,
        isDM: true,
      });
      assert.equal(result.intent, "customer_support", `Expected DM customer_support for ${message}`);
    }

    const helpCases = ["hi", "hello", "good morning", "shopping", "browse", "looking", "help me", "I want to shop"];
    for (const message of helpCases) {
      const result = await router.determineIntent(message, {
        userId: "test-help-user",
        channelId: "test-help-channel",
        isDM: false,
      });
      assert.equal(result.intent, "help", `Expected help for ${message}`);
    }

    const ignoreCases = ["asdfgh", "???", "random meaningless text"];
    for (const message of ignoreCases) {
      const result = await router.determineIntent(message, {
        userId: "test-ignore-user",
        channelId: "test-ignore-channel",
        isDM: false,
      });
      assert.equal(result.intent, "ignore", `Expected ignore for ${message}`);
    }

    const dmIgnoreCases = ["asdfgh", "???", "random meaningless text"];
    for (const message of dmIgnoreCases) {
      const result = await router.determineIntent(message, {
        userId: "test-dm-ignore-user",
        channelId: "test-dm-ignore-channel",
        discordGuildId: null,
        isDM: true,
      });
      assert.equal(result.intent, "ignore", `Expected DM ignore for ${message}`);
    }

    const dmGalleryCases = ["girl", "show me 10 cyberpunk cards", "recommend black gold anime cards"];
    for (const message of dmGalleryCases) {
      const result = await router.determineIntent(message, {
        userId: "test-dm-gallery-user",
        channelId: "test-dm-gallery-channel",
        discordGuildId: null,
        isDM: true,
      });
      assert.equal(result.intent, "gallery_search", `Expected DM gallery_search for ${message}`);
    }

    const notCustomerSupportCases = ["hi", "shopping", "browse"];
    for (const message of notCustomerSupportCases) {
      const result = await router.determineIntent(message, {
        userId: "test-not-support-user",
        channelId: "test-not-support-channel",
        isDM: false,
      });
      assert.notEqual(result.intent, "customer_support", `Expected non-customer_support for ${message}`);
    }

    const orderCases = ["can you check my order?", "track my order", "has my order shipped?"];
    for (const message of orderCases) {
      const result = await router.determineIntent(message, {
        userId: "test-order-user",
        channelId: "test-order-channel",
        isDM: false,
      });
      assert.equal(result.intent, "order_status", `Expected order_status for ${message}`);
    }

    const movedSupportCases = ["where is my order?", "order status"];
    for (const message of movedSupportCases) {
      const result = await router.determineIntent(message, {
        userId: "test-order-support-user",
        channelId: "test-order-support-channel",
        isDM: false,
      });
      assert.equal(result.intent, "customer_support", `Expected customer_support for ${message}`);
    }

    gallerySearchSessionRepository.findLatest = async () =>
      ({
        id: "active-session",
        discordGuildId: null,
        discordUserId: "test-select-user",
        discordChannelId: "test-select-channel",
        query: "black gold",
        results: [],
        selectedGalleryCardId: null,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      }) as Awaited<ReturnType<typeof originalFindLatest>>;

    const selectionCases = ["1", "choose 3"];
    for (const message of selectionCases) {
      const result = await router.determineIntent(message, {
        userId: "test-select-user",
        channelId: "test-select-channel",
        isDM: false,
      });
      assert.equal(result.intent, "gallery_select", `Expected gallery_select for ${message}`);
    }
  } finally {
    gallerySearchSessionRepository.findLatest = async () => null;
  }

  const originalApiKey = process.env.DEEPSEEK_API_KEY;
  const originalBaseUrl = process.env.DEEPSEEK_BASE_URL;
  const originalModel = process.env.DEEPSEEK_MODEL;
  const originalFetch = global.fetch;

  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.DEEPSEEK_BASE_URL = "https://mocked.example.com/v1";
  process.env.DEEPSEEK_MODEL = "mock-model";

  global.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "Sure — if you are buying multiple cards, we can help review the best available option for you.",
            },
          },
        ],
      }),
    }) as Response) as typeof fetch;

  try {
    const englishReply = await router.handle({
      text: "can I get a discount?",
      userId: "support-user-en",
      channelId: "support-channel-en",
      discordGuildId: null,
      isDM: true,
    });
    assert.equal(englishReply.type, "text");
    assert.equal(englishReply.language, "en");
    assert.match(englishReply.text, /option|cards|help/i);

    const chineseReply = await router.handle({
      text: "可以定制卡牌吗？",
      userId: "support-user-zh",
      channelId: "support-channel-zh",
      discordGuildId: null,
      isDM: true,
    });
    assert.equal(chineseReply.type, "text");
    assert.equal(chineseReply.language, "zh");
    assert.ok(chineseReply.text.length > 0);
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey == null) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = originalApiKey;
    }
    if (originalBaseUrl == null) {
      delete process.env.DEEPSEEK_BASE_URL;
    } else {
      process.env.DEEPSEEK_BASE_URL = originalBaseUrl;
    }
    if (originalModel == null) {
      delete process.env.DEEPSEEK_MODEL;
    } else {
      process.env.DEEPSEEK_MODEL = originalModel;
    }
  }

  const fallback = await customerSupportLlmService.answerQuestion({
    message: "unsupported policy question",
    language: "en",
    topic: "general",
    qaEntries: [],
    styleRulesText: knowledgeBundle.styleRulesText,
    fallbackRulesText: knowledgeBundle.fallbackRulesText,
  });
  assert.equal(fallback.usedFallback, true);
  assert.match(fallback.text, /accurate information|guess/i);

  gallerySearchSessionRepository.findLatest = originalFindLatest;

  console.log("[TEST CUSTOMER SUPPORT] all assertions passed");
};

run().catch((error) => {
  console.error("[TEST CUSTOMER SUPPORT] failed", error);
  process.exit(1);
});
