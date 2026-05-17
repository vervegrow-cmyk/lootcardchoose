import assert from "node:assert/strict";
import { SkillContext } from "../hermes/types";
import { buildHermesRegistry } from "../hermes/registry";
import { HermesRouter } from "../hermes/router";
import { llmIntentClassifierService } from "../services/llm-intent-classifier.service";
import { galleryHelpSkill } from "../skills/gallery/gallery-help.skill";

const buildContext = (language: SkillContext["language"]): SkillContext => ({
  requestId: `help-${Date.now()}-${language}`,
  language,
  discordGuildId: null,
  isDM: false,
  userId: "test-user",
  channelId: "test-channel",
  intent: "help",
  skillId: "gallery.help",
});

const containsChinese = (value: string): boolean => /[\u4e00-\u9fff]/.test(value);
const sentenceCount = (value: string): number =>
  value
    .split(/[.!?。！？]+/)
    .map((part) => part.trim())
    .filter(Boolean).length;

const run = async (): Promise<void> => {
  const router = new HermesRouter(buildHermesRegistry());
  const englishMessage = "How do I choose a card?";
  const chineseMessage = "鎬庝箞閫夊崱锛?";
  const originalApiKey = process.env.DEEPSEEK_API_KEY;
  const originalBaseUrl = process.env.DEEPSEEK_BASE_URL;
  const originalModel = process.env.DEEPSEEK_MODEL;
  const originalFetch = global.fetch;

  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.DEEPSEEK_BASE_URL = "https://mocked.example.com/v1";
  process.env.DEEPSEEK_MODEL = "mock-model";

  global.fetch = (async (input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const systemPrompt = body.messages?.[0]?.content ?? "";
    const userPrompt = body.messages?.[1]?.content ?? "";

    if (systemPrompt.includes("intent classifier")) {
      const message = userPrompt.replace(/^Language:\s*(zh|en)\s*Message:\s*/i, "").trim().toLowerCase();
      let payload: { intent: string; language: "en" | "zh"; confidence: number; reason: string };

      switch (message) {
        case "how do i choose a card?":
        case "hi":
        case "hello":
        case "good morning":
        case "shopping":
        case "browse":
        case "looking":
        case "help me":
        case "i want to shop":
          payload = {
            intent: "help",
            language: "en",
            confidence: 0.95,
            reason: "lightweight greeting or onboarding request",
          };
          break;
        case "where is my order?":
          payload = {
            intent: "order_status",
            language: "en",
            confidence: 0.95,
            reason: "explicit order lookup",
          };
          break;
        default:
          payload = {
            intent: "ignore",
            language: /[\u4e00-\u9fff]/.test(message) ? "zh" : "en",
            confidence: 0.3,
            reason: "default mock fallback",
          };
          break;
      }

      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(payload),
              },
            },
          ],
        }),
      } as Response;
    }

    if (userPrompt.includes("How do I choose a card?")) {
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  "Tell me what card style you want, and I can help you browse some options. Then reply with a number to choose one.",
              },
            },
          ],
        }),
      } as Response;
    }

    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "告诉我你想要的卡牌风格，我可以先帮你找一些选项。然后回复编号来选择。",
            },
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  try {
    const greetingCases = ["hi", "hello", "good morning", "shopping", "browse", "looking", "help me", "I want to shop"];
    for (const message of greetingCases) {
      const result = await router.determineIntent(message);
      assert.equal(result.intent, "help", `Expected help for ${message}`);
    }

    const englishPurchaseIntent = await router.determineIntent("How do I order this card?");
    assert.equal(englishPurchaseIntent.intent, "help");

    const englishOrderStatusIntent = await router.determineIntent("Where is my order?");
    assert.equal(englishOrderStatusIntent.intent, "customer_support");

    const englishIntent = await llmIntentClassifierService.classify(englishMessage);
    console.log("[TEST GALLERY HELP] english intent=", JSON.stringify(englishIntent));
    assert.equal(englishIntent.language, "en");
    assert.equal(englishIntent.intent, "help");

    const englishReply = await galleryHelpSkill({ message: englishMessage }, buildContext("en"));
    console.log("[TEST GALLERY HELP] english reply=", JSON.stringify(englishReply));
    assert.equal(englishReply.language, "en");
    assert.ok(!containsChinese(englishReply.text));
    assert.ok(sentenceCount(englishReply.text) <= 2, "Expected short English help reply");
    assert.ok(/style|browse|number|choose/i.test(englishReply.text));
    assert.ok(!/shipping|discount|free shipping|payment policy/i.test(englishReply.text));

    const chineseReply = await galleryHelpSkill({ message: chineseMessage }, buildContext("zh"));
    console.log("[TEST GALLERY HELP] chinese reply=", JSON.stringify(chineseReply));
    assert.equal(chineseReply.language, "zh");
    assert.ok(containsChinese(chineseReply.text));
    assert.ok(sentenceCount(chineseReply.text) <= 2, "Expected short Chinese help reply");
    assert.ok(/风格|选项|编号|选择/.test(chineseReply.text));
    assert.ok(!/发货|折扣|包邮|支付政策/.test(chineseReply.text));

    console.log("[TEST GALLERY HELP] all help boundary assertions passed");
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
};

run().catch((error) => {
  console.error("[TEST GALLERY HELP] failed", error);
  process.exit(1);
});
