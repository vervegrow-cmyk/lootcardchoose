import assert from "node:assert/strict";
import { buildHermesRegistry } from "../hermes/registry";
import { HermesRouter } from "../hermes/router";
import { gallerySearchSessionRepository } from "../repositories/gallery-search-session.repository";
import { customerSupportQaService } from "../services/customer-support-qa.service";
import { customerSupportLlmService } from "../services/customer-support-llm.service";

const run = async (): Promise<void> => {
  const router = new HermesRouter(buildHermesRegistry());
  const knowledgeBundle = customerSupportQaService.loadKnowledgeBundle();
  assert.ok(knowledgeBundle.entries.length >= 9, "Expected migrated customer support QA entries");
  assert.match(knowledgeBundle.styleRulesText, /Match user language/i);
  assert.match(knowledgeBundle.fallbackRulesText, /do not invent/i);

  const originalFindLatest = gallerySearchSessionRepository.findLatest;
  gallerySearchSessionRepository.findLatest = async () => null;

  try {
    const galleryCases = [
      "ssr",
      "girl",
      "red",
      "anime",
      "one piece",
      "black gold",
      "recommend cyberpunk cards",
      "do you have black gold cards?",
      "I want cool cards",
      "recommend some SSR cards",
      "black gold anime girls",
      "give me 10 black gold SSR female cards",
      "show me 10 cyberpunk anime cards",
      "I want anime girl cards",
      "show me dragon cards",
      "do you have dragon cards?",
      "recommend some dark fantasy cards",
      "any SSR female character cards?",
      "cyberpunk warrior",
    ];

    for (const message of galleryCases) {
      const result = await router.determineIntent(message, {
        userId: "test-gallery-user",
        channelId: "test-gallery-channel",
      });
      assert.equal(result.intent, "gallery_search", `Expected gallery_search for ${message}`);
    }

    const supportCases = [
      "can I get a discount?",
      "do you offer free shipping?",
      "how long does delivery take?",
      "how do I pay?",
      "can I buy multiple cards?",
      "can I customize a card?",
      "what if I entered the wrong address?",
      "is there a bulk discount?",
      "can I get a better price if I buy more?",
    ];

    for (const message of supportCases) {
      const result = await router.determineIntent(message, {
        userId: "test-support-user",
        channelId: "test-support-channel",
      });
      assert.equal(result.intent, "customer_support", `Expected customer_support for ${message}`);
    }

    const helpCases = ["hi", "hello", "good morning", "shopping", "browse", "looking", "help me", "I want to shop"];
    for (const message of helpCases) {
      const result = await router.determineIntent(message, {
        userId: "test-help-user",
        channelId: "test-help-channel",
      });
      assert.equal(result.intent, "help", `Expected help for ${message}`);
    }

    const ignoreCases = ["asdfgh", "???", "random meaningless text"];
    for (const message of ignoreCases) {
      const result = await router.determineIntent(message, {
        userId: "test-ignore-user",
        channelId: "test-ignore-channel",
      });
      assert.equal(result.intent, "ignore", `Expected ignore for ${message}`);
    }

    const notCustomerSupportCases = ["hi", "shopping", "browse"];
    for (const message of notCustomerSupportCases) {
      const result = await router.determineIntent(message, {
        userId: "test-not-support-user",
        channelId: "test-not-support-channel",
      });
      assert.notEqual(result.intent, "customer_support", `Expected non-customer_support for ${message}`);
    }

    const orderCases = [
      "where is my order?",
      "can you check my order?",
      "track my order",
      "order status",
      "has my order shipped?",
    ];
    for (const message of orderCases) {
      const result = await router.determineIntent(message, {
        userId: "test-order-user",
        channelId: "test-order-channel",
      });
      assert.equal(result.intent, "order_status", `Expected order_status for ${message}`);
    }

    gallerySearchSessionRepository.findLatest = async () =>
      ({
        id: "active-session",
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
    });
    assert.equal(englishReply.type, "text");
    assert.equal(englishReply.language, "en");
    assert.match(englishReply.text, /option|cards|help/i);

    const chineseReply = await router.handle({
      text: "可以定制卡牌吗？",
      userId: "support-user-zh",
      channelId: "support-channel-zh",
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
