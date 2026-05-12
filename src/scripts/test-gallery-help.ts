import assert from "node:assert/strict";
import { llmIntentClassifierService } from "../services/llm-intent-classifier.service";
import { galleryHelpSkill } from "../skills/gallery/gallery-help.skill";
import { SkillContext } from "../hermes/types";

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
  const englishMessage = "How do I buy this card?";
  const chineseMessage = "怎么买这张卡？";

  const englishIntent = await llmIntentClassifierService.classify(englishMessage);
  console.log("[TEST GALLERY HELP] english intent=", JSON.stringify(englishIntent));
  assert.equal(englishIntent.language, "en");
  assert.equal(englishIntent.intent, "help");

  const englishReply = await galleryHelpSkill({ message: englishMessage }, buildContext("en"));
  console.log("[TEST GALLERY HELP] english reply=", JSON.stringify(englishReply));
  assert.equal(englishReply.language, "en");
  assert.ok(!containsChinese(englishReply.text));
  assert.ok(/buy|checkout|product page|search/i.test(englishReply.text));

  const chineseIntent = await llmIntentClassifierService.classify(chineseMessage);
  console.log("[TEST GALLERY HELP] chinese intent=", JSON.stringify(chineseIntent));
  assert.equal(chineseIntent.language, "zh");
  assert.equal(chineseIntent.intent, "help");

  const chineseReply = await galleryHelpSkill({ message: chineseMessage }, buildContext("zh"));
  console.log("[TEST GALLERY HELP] chinese reply=", JSON.stringify(chineseReply));
  assert.equal(chineseReply.language, "zh");
  assert.ok(containsChinese(chineseReply.text));
  assert.ok(/购买|搜索|编号|卡牌/.test(chineseReply.text));

  console.log("[TEST GALLERY HELP] all bilingual help assertions passed");
};

run().catch((error) => {
  console.error("[TEST GALLERY HELP] failed", error);
  process.exit(1);
});
