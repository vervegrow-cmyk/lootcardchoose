import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import assert from "node:assert/strict";
import { buildHermesRegistry } from "../hermes/registry";
import { HermesRouter } from "../hermes/router";
import { refreshGallerySkill } from "../skills/gallery/refresh-gallery.skill";
import { searchGallerySkill } from "../skills/gallery/search-gallery.skill";

const ensure = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const hasChinese = (value: string): boolean => /[\u4e00-\u9fff]/.test(value);

const run = async (): Promise<void> => {
  const registry = buildHermesRegistry();
  const router = new HermesRouter(registry);
  const testSuffix = `${Date.now()}`;
  const englishUserId = `refresh-en-user-${testSuffix}`;
  const englishChannelId = `refresh-en-channel-${testSuffix}`;
  const chineseUserId = `refresh-zh-user-${testSuffix}`;
  const chineseChannelId = `refresh-zh-channel-${testSuffix}`;

  const englishIntent = await router.determineIntent("Can we switch to another batch?");
  console.log("[TEST GALLERY REFRESH] english intent=", JSON.stringify(englishIntent));
  assert.equal(englishIntent.intent, "gallery_refresh");
  assert.equal(englishIntent.language, "en");

  const englishSearch = await searchGallerySkill(
    {
      query: "Show me 10 black gold SSR female cards",
      discordUserId: englishUserId,
      discordChannelId: englishChannelId,
    },
    {
      requestId: `refresh-en-search-${Date.now()}`,
      language: "en",
      userId: englishUserId,
      channelId: englishChannelId,
      intent: "gallery_search",
      skillId: "gallery.search",
    }
  );

  ensure(englishSearch.results.length > 0, "Expected initial English search results");

  const englishRefresh = await refreshGallerySkill(
    {
      discordUserId: englishUserId,
      discordChannelId: englishChannelId,
      currentMessage: "Can we switch to another batch?",
    },
    {
      requestId: `refresh-en-refresh-${Date.now()}`,
      language: "en",
      userId: englishUserId,
      channelId: englishChannelId,
      intent: "gallery_refresh",
      skillId: "gallery.refresh",
    }
  );

  console.log(
    "[TEST GALLERY REFRESH] english refresh=",
    JSON.stringify({
      language: englishRefresh.language,
      refreshMode: englishRefresh.refreshMode,
      firstBatchCardIds: englishRefresh.firstBatchCardIds,
      secondBatchCardIds: englishRefresh.secondBatchCardIds,
    })
  );

  assert.equal(englishRefresh.language, "en");
  assert.ok(englishRefresh.results.length <= 10);
  for (const cardId of englishRefresh.secondBatchCardIds) {
    assert.ok(!englishRefresh.firstBatchCardIds.includes(cardId), `Expected refreshed batch to exclude ${cardId}`);
  }

  const refineIntent = await router.determineIntent("I don't like these, show me another style");
  console.log("[TEST GALLERY REFRESH] refine intent=", JSON.stringify(refineIntent));
  assert.equal(refineIntent.intent, "gallery_refresh");

  const refineRefresh = await refreshGallerySkill(
    {
      discordUserId: englishUserId,
      discordChannelId: englishChannelId,
      currentMessage: "I don't like these, show me another style",
    },
    {
      requestId: `refresh-en-refine-${Date.now()}`,
      language: "en",
      userId: englishUserId,
      channelId: englishChannelId,
      intent: "gallery_refresh",
      skillId: "gallery.refresh",
    }
  );

  console.log("[TEST GALLERY REFRESH] refine mode=", refineRefresh.refreshMode);
  assert.ok(["refine", "broaden", "random_fallback"].includes(refineRefresh.refreshMode));

  const chineseIntent = await router.determineIntent("换一批");
  console.log("[TEST GALLERY REFRESH] chinese intent=", JSON.stringify(chineseIntent));
  assert.equal(chineseIntent.intent, "gallery_refresh");
  assert.equal(chineseIntent.language, "zh");

  const chineseSearch = await searchGallerySkill(
    {
      query: "给我10张黑金SSR女角色卡牌",
      discordUserId: chineseUserId,
      discordChannelId: chineseChannelId,
    },
    {
      requestId: `refresh-zh-search-${Date.now()}`,
      language: "zh",
      userId: chineseUserId,
      channelId: chineseChannelId,
      intent: "gallery_search",
      skillId: "gallery.search",
    }
  );

  ensure(chineseSearch.results.length > 0, "Expected initial Chinese search results");

  const chineseRefresh = await refreshGallerySkill(
    {
      discordUserId: chineseUserId,
      discordChannelId: chineseChannelId,
      currentMessage: "换一批",
    },
    {
      requestId: `refresh-zh-refresh-${Date.now()}`,
      language: "zh",
      userId: chineseUserId,
      channelId: chineseChannelId,
      intent: "gallery_refresh",
      skillId: "gallery.refresh",
    }
  );

  console.log(
    "[TEST GALLERY REFRESH] chinese refresh=",
    JSON.stringify({
      language: chineseRefresh.language,
      refreshMode: chineseRefresh.refreshMode,
      firstBatchCardIds: chineseRefresh.firstBatchCardIds,
      secondBatchCardIds: chineseRefresh.secondBatchCardIds,
    })
  );

  assert.equal(chineseRefresh.language, "zh");
  for (const cardId of chineseRefresh.secondBatchCardIds) {
    assert.ok(!chineseRefresh.firstBatchCardIds.includes(cardId), `Expected zh refreshed batch to exclude ${cardId}`);
  }

  const noHistoryRefresh = await refreshGallerySkill(
    {
      discordUserId: "refresh-empty-user",
      discordChannelId: "refresh-empty-channel",
      currentMessage: "Show me another batch",
    },
    {
      requestId: `refresh-empty-${Date.now()}`,
      language: "en",
      userId: "refresh-empty-user",
      channelId: "refresh-empty-channel",
      intent: "gallery_refresh",
      skillId: "gallery.refresh",
    }
  );

  console.log("[TEST GALLERY REFRESH] no history=", JSON.stringify(noHistoryRefresh));
  assert.equal(noHistoryRefresh.previousSessionFound, false);
  assert.equal(noHistoryRefresh.language, "en");

  const agentNoHistory = await router.handle({
    text: "Show me another batch",
    userId: "refresh-empty-user-2",
    channelId: "refresh-empty-channel-2",
  });

  console.log("[TEST GALLERY REFRESH] no history agent reply=", JSON.stringify(agentNoHistory));
  assert.equal(agentNoHistory.language, "en");
  assert.equal(agentNoHistory.type, "text");
  assert.ok(typeof agentNoHistory.text === "string" && !hasChinese(agentNoHistory.text));

  console.log("[TEST GALLERY REFRESH] all refresh assertions passed");
};

run().catch((error) => {
  console.error("[TEST GALLERY REFRESH] failed", error);
  process.exit(1);
});
