import assert from "node:assert/strict";
import { SkillContext } from "../hermes/types";
import { buildHermesRegistry } from "../hermes/registry";
import { HermesRouter } from "../hermes/router";
import { llmIntentClassifierService } from "../services/llm-intent-classifier.service";
import { galleryHelpSkill } from "../skills/gallery/gallery-help.skill";

const buildContext = (language: SkillContext["language"]): SkillContext => ({
  requestId: `help-${Date.now()}-${language}`,
  language,
  userId: "test-user",
  channelId: "test-channel",
  intent: "help",
  skillId: "gallery.help",
});

const containsChinese = (value: string): boolean => /[\u4e00-\u9fff]/.test(value);

const run = async (): Promise<void> => {
  const router = new HermesRouter(buildHermesRegistry());
  const englishMessage = "How do I choose a card?";
  const chineseMessage = "怎么选卡？";

  const englishPurchaseIntent = await router.determineIntent("How do I order this card?");
  assert.equal(englishPurchaseIntent.intent, "help");

  const englishOrderStatusIntent = await router.determineIntent("Where is my order?");
  assert.equal(englishOrderStatusIntent.intent, "order_status");

  const chinesePurchaseIntent = await router.determineIntent("怎么购买这张卡？");
  assert.equal(chinesePurchaseIntent.intent, "help");

  const chineseOrderStatusIntent = await router.determineIntent("查询订单状态");
  assert.equal(chineseOrderStatusIntent.intent, "order_status");

  const englishIntent = await llmIntentClassifierService.classify(englishMessage);
  console.log("[TEST GALLERY HELP] english intent=", JSON.stringify(englishIntent));
  assert.equal(englishIntent.language, "en");
  assert.equal(englishIntent.intent, "help");

  const englishReply = await galleryHelpSkill({ message: englishMessage }, buildContext("en"));
  console.log("[TEST GALLERY HELP] english reply=", JSON.stringify(englishReply));
  assert.equal(englishReply.language, "en");
  assert.ok(!containsChinese(englishReply.text));
  assert.ok(/choose|style|color|rarity|search/i.test(englishReply.text));

  const chineseIntent = await llmIntentClassifierService.classify(chineseMessage);
  console.log("[TEST GALLERY HELP] chinese intent=", JSON.stringify(chineseIntent));
  assert.equal(chineseIntent.language, "zh");
  assert.equal(chineseIntent.intent, "help");

  const chineseReply = await galleryHelpSkill({ message: chineseMessage }, buildContext("zh"));
  console.log("[TEST GALLERY HELP] chinese reply=", JSON.stringify(chineseReply));
  assert.equal(chineseReply.language, "zh");
  assert.ok(containsChinese(chineseReply.text));
  assert.ok(/选卡|搜索|风格|颜色|卡/.test(chineseReply.text));

  console.log("[TEST GALLERY HELP] all bilingual help assertions passed");
};

run().catch((error) => {
  console.error("[TEST GALLERY HELP] failed", error);
  process.exit(1);
});
