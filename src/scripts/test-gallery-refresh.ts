import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import assert from "node:assert/strict";
import { HermesOutput } from "../hermes/types";
import { buildHermesRegistry } from "../hermes/registry";
import { HermesRouter } from "../hermes/router";
import { galleryRepository } from "../repositories/gallery.repository";
import { gallerySearchSessionRepository } from "../repositories/gallery-search-session.repository";
import { awaitPendingSearchSessionWrite } from "../skills/gallery/search-gallery.skill";
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

const createSessionResultCard = (card: {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string;
  price: number;
  tags: string[];
}) => ({
  id: card.id,
  title: card.title,
  description: card.description,
  imageUrl: card.imageUrl,
  price: card.price,
  tags: card.tags,
  language: "en" as const,
});

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
  const anchorUserId = `refresh-anchor-user-${suffix}`;
  const anchorChannelId = `refresh-anchor-channel-${suffix}`;
  const exhaustedUserId = `refresh-exhausted-user-${suffix}`;
  const exhaustedChannelId = `refresh-exhausted-channel-${suffix}`;

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
  await awaitPendingSearchSessionWrite({
    discordUserId: enUserId,
    discordChannelId: enChannelId,
    timeoutMs: 5000,
  });
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
  assert.equal(secondResponse.metadata?.poolExhausted, false);

  const secondBatchCardIds = secondResponse.cards.map((card) => card.id);
  ensure(secondBatchCardIds.length > 0, "Expected second English batch");
  for (const cardId of secondBatchCardIds) {
    assert.ok(!firstBatchCardIds.includes(cardId), `Expected refreshed batch to exclude ${cardId}`);
  }
  for (const badKeyword of ["previous s", "sa composition", "cha"]) {
    assert.ok(!secondResponse.metadata?.keep?.includes(badKeyword));
    assert.ok(!secondResponse.metadata?.avoid?.includes(badKeyword));
    assert.ok(!secondResponse.metadata?.broaden?.includes(badKeyword));
    assert.ok(!secondResponse.metadata?.searchKeywords?.includes(badKeyword));
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
  assert.ok(fullChainLogs.some((line) => line.includes("[REFRESH GALLERY SKILL] session metadata")));
  assert.ok(fullChainLogs.some((line) => line.includes("[GALLERY SERVICE] refresh prompt context")));
  assert.ok(fullChainLogs.some((line) => line.includes("\"userFeedback\":\"Can we switch to another batch?\"")));
  assert.ok(fullChainLogs.some((line) => line.includes("\"sessionMetadata\"")));
  assert.ok(fullChainLogs.some((line) => line.includes("[GALLERY SERVICE] refresh applied keywords")));
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

  const anchorSearch = await router.handle({
    text: "girl",
    userId: anchorUserId,
    channelId: anchorChannelId,
  });
  assert.equal(anchorSearch.type, "gallery_search_results");
  await awaitPendingSearchSessionWrite({
    discordUserId: anchorUserId,
    discordChannelId: anchorChannelId,
    timeoutMs: 5000,
  });
  const baseAnchorCards = anchorSearch.cards.slice(0, 4).map(createSessionResultCard);

  await gallerySearchSessionRepository.archiveActiveSessions({
    discordUserId: anchorUserId,
    discordChannelId: anchorChannelId,
  });

  const archivedAnchorSession = await gallerySearchSessionRepository.create({
    discordUserId: anchorUserId,
    discordChannelId: anchorChannelId,
    query: "girl",
    results: baseAnchorCards.map((card) => ({
      ...card,
      batchIndex: 2,
      refreshMode: "broaden",
      originalQuery: "girl",
    })),
    status: "archived",
  });

  const sparseDisplaySession = await gallerySearchSessionRepository.create({
    discordUserId: anchorUserId,
    discordChannelId: anchorChannelId,
    query: "girl",
    results: baseAnchorCards.slice(0, 1).map((card) => ({
      ...card,
      batchIndex: 3,
      refreshMode: "random_fallback",
      originalQuery: "girl",
      previousSessionId: archivedAnchorSession.id,
      anchorSessionId: archivedAnchorSession.id,
    })),
    status: "active",
  });

  const anchorRefreshResponse = await router.handle({
    text: "I don't like these, show me another style",
    userId: anchorUserId,
    channelId: anchorChannelId,
  });
  ensure(anchorRefreshResponse.metadata, "Expected refresh metadata for anchor test");
  assert.equal(anchorRefreshResponse.metadata?.anchorSessionId, archivedAnchorSession.id);
  assert.equal(anchorRefreshResponse.metadata?.displaySessionId, sparseDisplaySession.id);

  const exhaustedSearch = await router.handle({
    text: "girl",
    userId: exhaustedUserId,
    channelId: exhaustedChannelId,
  });
  assert.equal(exhaustedSearch.type, "gallery_search_results");
  await awaitPendingSearchSessionWrite({
    discordUserId: exhaustedUserId,
    discordChannelId: exhaustedChannelId,
    timeoutMs: 5000,
  });

  const originalSearch = galleryRepository.search;
  const originalFindActiveExcluding = galleryRepository.findActiveExcluding;
  galleryRepository.search = async () => [];
  galleryRepository.findActiveExcluding = async () => [];

  try {
    const exhaustedResponse = await router.handle({
      text: "I don't like these, show me another style",
      userId: exhaustedUserId,
      channelId: exhaustedChannelId,
    });
    assert.equal(exhaustedResponse.type, "text");
    assert.equal(
      exhaustedResponse.text,
      "I’ve already shown most of the close matches for this direction. Give me one new style, color, or theme and I’ll refine the next batch."
    );
    assert.equal(exhaustedResponse.metadata?.refreshMode, "need_clarification");
    assert.equal(exhaustedResponse.metadata?.poolExhausted, true);
    assert.ok(exhaustedResponse.metadata?.anchorSessionId);
    assert.ok(exhaustedResponse.metadata?.displaySessionId);
  } finally {
    galleryRepository.search = originalSearch;
    galleryRepository.findActiveExcluding = originalFindActiveExcluding;
  }

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
        anchorSessionId: secondResponse.metadata?.anchorSessionId,
        displaySessionId: secondResponse.metadata?.displaySessionId,
        poolExhausted: secondResponse.metadata?.poolExhausted,
      },
    })
  );
};

run().catch((error) => {
  console.error("[TEST GALLERY REFRESH] failed", error);
  process.exit(1);
});
