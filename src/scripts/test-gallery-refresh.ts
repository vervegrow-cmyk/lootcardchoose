import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import assert from "node:assert/strict";
import { HermesOutput } from "../hermes/types";
import { buildHermesRegistry } from "../hermes/registry";
import { HermesRouter } from "../hermes/router";
import { gallerySearchSessionRepository } from "../repositories/gallery-search-session.repository";
import { parseSelectedIndex } from "../utils/gallery-language";
import { logger } from "../utils/logger";

const ensure = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const collectLogs = async (run: () => Promise<void>): Promise<string[]> => {
  const lines: string[] = [];
  const originalInfo = logger.info;
  const originalWarn = logger.warn;
  const originalError = logger.error;

  logger.info = (message, meta) => {
    lines.push(meta ? `${message} ${JSON.stringify(meta)}` : message);
    originalInfo(message, meta);
  };
  logger.warn = (message, meta) => {
    lines.push(meta ? `${message} ${JSON.stringify(meta)}` : message);
    originalWarn(message, meta);
  };
  logger.error = (message, meta) => {
    lines.push(meta ? `${message} ${JSON.stringify(meta)}` : message);
    originalError(message, meta);
  };

  try {
    await run();
    return lines;
  } finally {
    logger.info = originalInfo;
    logger.warn = originalWarn;
    logger.error = originalError;
  }
};

const run = async (): Promise<void> => {
  const registry = buildHermesRegistry();
  const router = new HermesRouter(registry);
  const suffix = `${Date.now()}`;

  const enUserId = `refresh-en-user-${suffix}`;
  const enChannelId = `refresh-en-channel-${suffix}`;
  const broadenUserId = `refresh-broaden-user-${suffix}`;
  const broadenChannelId = `refresh-broaden-channel-${suffix}`;
  const zhUserId = `refresh-zh-user-${suffix}`;
  const zhChannelId = `refresh-zh-channel-${suffix}`;

  const numberedSearchIntent = await router.determineIntent("Show me 10 black gold SSR female cards", {
    userId: `search-user-${suffix}`,
    channelId: `search-channel-${suffix}`,
  });
  assert.equal(numberedSearchIntent.intent, "gallery_search");

  const noSessionSelectIntent = await router.determineIntent("one", {
    userId: `no-session-user-${suffix}`,
    channelId: `no-session-channel-${suffix}`,
  });
  assert.notEqual(noSessionSelectIntent.intent, "gallery_select");
  assert.equal(parseSelectedIndex("1"), null);

  const firstSearch = await router.handle({
    text: "girl",
    userId: enUserId,
    channelId: enChannelId,
  });

  assert.equal(firstSearch.type, "gallery_search_results");
  ensure(firstSearch.cards.length > 0, "Expected first English search results");
  const firstBatchCardIds = firstSearch.cards.map((card) => card.id);
  const activeSessionsAfterFirstSearch = await gallerySearchSessionRepository.findRecentByUserId({
    discordUserId: enUserId,
    discordChannelId: enChannelId,
    status: "active",
  });
  assert.equal(activeSessionsAfterFirstSearch.length, 1);

  let secondResponse: HermesOutput | undefined;
  const fullChainLogs = await collectLogs(async () => {
    secondResponse = await router.handle({
      text: "Can we switch to another batch?",
      userId: enUserId,
      channelId: enChannelId,
    });
  });

  if (!secondResponse) {
    throw new Error("Expected refresh response");
  }

  assert.equal(secondResponse.type, "gallery_search_results");
  assert.equal(secondResponse.language, "en");
  assert.equal(secondResponse.refreshMode, "next_batch");
  assert.equal(secondResponse.text, "Here’s another batch of cards for you. Reply with a number to select one.");
  assert.ok(Array.isArray(secondResponse.metadata?.keep));
  assert.ok(Array.isArray(secondResponse.metadata?.avoid));
  assert.ok(Array.isArray(secondResponse.metadata?.broaden));
  assert.ok(Array.isArray(secondResponse.metadata?.searchKeywords));

  const secondBatchCardIds = secondResponse.cards.map((card) => card.id);
  ensure(secondBatchCardIds.length > 0, "Expected second English batch");
  for (const cardId of secondBatchCardIds) {
    assert.ok(!firstBatchCardIds.includes(cardId), `Expected refreshed batch to exclude ${cardId}`);
  }
  const activeSessionsAfterRefresh = await gallerySearchSessionRepository.findRecentByUserId({
    discordUserId: enUserId,
    discordChannelId: enChannelId,
    status: "active",
  });
  assert.equal(activeSessionsAfterRefresh.length, 1);

  assert.ok(fullChainLogs.some((line) => line.includes("[HERMES ROUTER] intent=gallery_refresh")));
  assert.ok(
    fullChainLogs.some((line) => line.includes("[HERMES ORCHESTRATOR] agent=lootcardchoose intent=gallery_refresh"))
  );
  assert.ok(fullChainLogs.some((line) => line.includes("[GALLERY AGENT] handling gallery_refresh")));
  assert.ok(fullChainLogs.some((line) => line.includes("[REFRESH GALLERY SKILL] start")));
  assert.ok(fullChainLogs.some((line) => line.includes("[REFRESH GALLERY SKILL] completed")));
  assert.ok(fullChainLogs.some((line) => line.includes("[REFRESH GALLERY SKILL] session metadata=")));
  assert.ok(fullChainLogs.some((line) => line.includes("[GALLERY SERVICE] refresh prompt context=")));
  assert.ok(fullChainLogs.some((line) => line.includes("\"userFeedback\":\"Can we switch to another batch?\"")));
  assert.ok(fullChainLogs.some((line) => line.includes("\"sessionMetadata\"")));
  assert.ok(fullChainLogs.some((line) => line.includes("[GALLERY SERVICE] refresh applied keywords=")));
  assert.ok(fullChainLogs.some((line) => line.includes("\"preferredKeywords\"")));
  assert.ok(fullChainLogs.some((line) => line.includes("\"avoidKeywords\"")));

  const refineIntent = await router.determineIntent("I don't like these, show me another style", {
    userId: enUserId,
    channelId: enChannelId,
  });
  assert.equal(refineIntent.intent, "gallery_refresh");

  const refineResponse = await router.handle({
    text: "I don't like these, show me another style",
    userId: enUserId,
    channelId: enChannelId,
  });
  assert.equal(refineResponse.type, "gallery_search_results");
  assert.ok(["refine", "broaden", "random_fallback"].includes(refineResponse.refreshMode ?? ""));

  const broadenIntent = await router.determineIntent("Show me another style", {
    userId: broadenUserId,
    channelId: broadenChannelId,
  });
  assert.equal(broadenIntent.intent, "gallery_refresh");

  const broadenSearch = await router.handle({
    text: "girl",
    userId: broadenUserId,
    channelId: broadenChannelId,
  });
  assert.equal(broadenSearch.type, "gallery_search_results");

  const broadenResponse = await router.handle({
    text: "Show me another style",
    userId: broadenUserId,
    channelId: broadenChannelId,
  });
  assert.equal(broadenResponse.type, "gallery_search_results");
  assert.ok(["broaden", "random_fallback", "refine"].includes(broadenResponse.refreshMode ?? ""));

  const selectIntent = await router.determineIntent("one", {
    userId: enUserId,
    channelId: enChannelId,
  });
  assert.equal(selectIntent.intent, "gallery_select");
  assert.equal(parseSelectedIndex("1", { hasActiveSession: true }), 1);
  assert.equal(parseSelectedIndex("one", { hasActiveSession: true }), 1);
  assert.equal(parseSelectedIndex("first", { hasActiveSession: true }), 1);
  assert.equal(parseSelectedIndex("number one", { hasActiveSession: true }), 1);
  assert.equal(parseSelectedIndex("第一个", { hasActiveSession: true }), 1);
  assert.equal(parseSelectedIndex("选1", { hasActiveSession: true }), 1);
  assert.equal(parseSelectedIndex("Show me 10 black gold SSR female cards", { hasActiveSession: true }), null);

  const activeSession = await gallerySearchSessionRepository.findLatest({
    discordUserId: enUserId,
    discordChannelId: enChannelId,
    status: "active",
  });
  ensure(activeSession && Array.isArray(activeSession.results) && activeSession.results.length > 0, "Expected active session");

  const zhSearch = await router.handle({
    text: "女孩卡牌",
    userId: zhUserId,
    channelId: zhChannelId,
  });
  assert.equal(zhSearch.type, "gallery_search_results");
  ensure(zhSearch.cards.length > 0, "Expected Chinese search results");

  const zhIntent = await router.determineIntent("换一批", {
    userId: zhUserId,
    channelId: zhChannelId,
  });
  assert.equal(zhIntent.intent, "gallery_refresh");
  assert.equal(zhIntent.language, "zh");

  const zhRefresh = await router.handle({
    text: "换一批",
    userId: zhUserId,
    channelId: zhChannelId,
  });
  assert.equal(zhRefresh.language, "zh");
  assert.equal(zhRefresh.type, "gallery_search_results");
  assert.equal(zhRefresh.text, "这是为你换的一批卡牌，请回复编号选择一张。");

  const noHistoryResponse = await router.handle({
    text: "Show me another batch",
    userId: `no-history-user-${suffix}`,
    channelId: `no-history-channel-${suffix}`,
  });
  assert.equal(noHistoryResponse.type, "text");
  assert.equal(
    noHistoryResponse.text,
    "Please search for a card style first, then I can show you another batch."
  );

  console.log(
    "[TEST GALLERY REFRESH] summary=",
    JSON.stringify({
      firstBatchCardIds,
      secondBatchCardIds,
      fullChainLogs,
      englishRefreshReply: secondResponse.text,
      chineseRefreshReply: zhRefresh.text,
      refreshMetadata: {
        keep: secondResponse.metadata?.keep,
        avoid: secondResponse.metadata?.avoid,
        broaden: secondResponse.metadata?.broaden,
        searchKeywords: secondResponse.metadata?.searchKeywords,
      },
    })
  );
};

run().catch((error) => {
  console.error("[TEST GALLERY REFRESH] failed", error);
  process.exit(1);
});
