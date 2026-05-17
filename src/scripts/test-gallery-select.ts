import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import assert from "node:assert/strict";
import { buildHermesRegistry } from "../hermes/registry";
import { HermesRouter } from "../hermes/router";
import { gallerySearchSessionRepository } from "../repositories/gallery-search-session.repository";
import { guildConfigRepository } from "../repositories/guild-config.repository";
import { galleryRepository } from "../repositories/gallery.repository";
import { orderService } from "../services/order.service";
import { shopifyService } from "../services/shopify.service";
import { awaitPendingSearchSessionWrite } from "../skills/gallery/search-gallery.skill";
import { GallerySearchSessionRecord } from "../repositories/gallery-search-session.repository";

const ensure = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const LEGACY_CHANNEL_DENIAL_TEXT = "Please use #lootcardchoose to search and choose cards.";
const CONFIGURED_CHANNEL_DENIAL_TEXT =
  "This bot is not enabled in this channel. Please use the configured card channel.";
const EMPTY_GALLERY_TEXT = "Sorry, I couldn't find matching cards.";
const LEGACY_SUCCESS_PREFIX = "I found 10 cards for you.";
const ZERO_RESULT_QUERY = "show me 10 qwertyuiop cards";
const RECOVERY_QUERY = "show me 10 cyberpunk cards";

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

const getFirstSessionCardId = (session: GallerySearchSessionRecord | null): string | null => {
  if (!session || !Array.isArray(session.results) || session.results.length === 0) {
    return null;
  }

  const firstResult = session.results[0];
  if (!firstResult || typeof firstResult !== "object" || Array.isArray(firstResult)) {
    return null;
  }

  return typeof (firstResult as { id?: unknown }).id === "string" ? ((firstResult as { id: string }).id) : null;
};

const main = async (): Promise<void> => {
  const registry = buildHermesRegistry();
  const router = new HermesRouter(registry);
  const suffix = `${Date.now()}`;
  const discordUserId = `test-select-user-${suffix}`;
  const discordChannelId = `test-select-channel-${suffix}`;
  const discordGuildId = `test-select-guild-${suffix}`;
  const discordChannelName = "lootcardchoose";
  const query = "Show me 10 black gold SSR female cards";
  const zeroResultUserId = `test-zero-user-${suffix}`;
  const zeroResultChannelId = `test-zero-channel-${suffix}`;
  const zeroResultGuildId = `test-zero-guild-${suffix}`;
  const staleSessionUserId = `test-stale-user-${suffix}`;
  const staleSessionChannelId = `test-stale-channel-${suffix}`;
  const staleSessionGuildId = `test-stale-guild-${suffix}`;
  const recoveryUserId = `test-recovery-user-${suffix}`;
  const recoveryChannelId = `test-recovery-channel-${suffix}`;
  const recoveryGuildId = `test-recovery-guild-${suffix}`;
  const narrationUserId = `test-narration-user-${suffix}`;
  const narrationChannelId = `test-narration-channel-${suffix}`;
  const narrationGuildId = `test-narration-guild-${suffix}`;

  const legacyGuildId = `test-legacy-guild-${suffix}`;
  const configuredGuildId = `test-configured-guild-${suffix}`;
  const disabledGuildId = `test-disabled-guild-${suffix}`;
  const configuredChannelId = `configured-channel-${suffix}`;
  const configuredNameChannel = "card-browse";
  const blockedChannelId = `blocked-channel-${suffix}`;
  const blockedChannelName = "general";

  await guildConfigRepository.deleteByGuildId(legacyGuildId);
  await guildConfigRepository.deleteByGuildId(configuredGuildId);
  await guildConfigRepository.deleteByGuildId(disabledGuildId);

  const legacyAllowedResponse = await router.handle({
    text: "help me",
    discordGuildId: legacyGuildId,
    userId: `legacy-user-${suffix}`,
    channelId: `legacy-channel-${suffix}`,
    channelName: "lootcardchoose",
  });
  assert.equal(legacyAllowedResponse.type, "text");
  assert.notEqual(legacyAllowedResponse.text, LEGACY_CHANNEL_DENIAL_TEXT);

  const legacyGeneralResponse = await router.handle({
    text: "help me",
    discordGuildId: legacyGuildId,
    userId: `legacy-general-user-${suffix}`,
    channelId: `legacy-general-channel-${suffix}`,
    channelName: "general",
  });
  assert.equal(legacyGeneralResponse.type, "text");
  assert.equal(legacyGeneralResponse.text, LEGACY_CHANNEL_DENIAL_TEXT);

  const legacyChineseNamedChannelResponse = await router.handle({
    text: "help me",
    discordGuildId: legacyGuildId,
    userId: `legacy-zh-user-${suffix}`,
    channelId: `legacy-zh-channel-${suffix}`,
    channelName: "常规",
  });
  assert.equal(legacyChineseNamedChannelResponse.type, "text");
  assert.equal(
    legacyChineseNamedChannelResponse.text,
    LEGACY_CHANNEL_DENIAL_TEXT
  );

  await guildConfigRepository.upsert({
    discordGuildId: configuredGuildId,
    enabledChannelIds: [configuredChannelId],
    enabledChannelNames: [configuredNameChannel],
    enabledAgents: [],
    isEnabled: true,
    defaultLanguage: null,
  });

  const configuredAllowedById = await router.handle({
    text: "help me",
    discordGuildId: configuredGuildId,
    userId: `configured-id-user-${suffix}`,
    channelId: configuredChannelId,
    channelName: blockedChannelName,
  });
  assert.equal(configuredAllowedById.type, "text");
  assert.notEqual(configuredAllowedById.text, LEGACY_CHANNEL_DENIAL_TEXT);

  const configuredAllowedByName = await router.handle({
    text: "help me",
    discordGuildId: configuredGuildId,
    userId: `configured-name-user-${suffix}`,
    channelId: `configured-name-id-${suffix}`,
    channelName: configuredNameChannel,
  });
  assert.equal(configuredAllowedByName.type, "text");
  assert.notEqual(configuredAllowedByName.text, LEGACY_CHANNEL_DENIAL_TEXT);

  const configuredBlockedResponse = await router.handle({
    text: "help me",
    discordGuildId: configuredGuildId,
    userId: `configured-blocked-user-${suffix}`,
    channelId: blockedChannelId,
    channelName: blockedChannelName,
  });
  assert.equal(configuredBlockedResponse.type, "text");
  assert.equal(configuredBlockedResponse.text, CONFIGURED_CHANNEL_DENIAL_TEXT);

  await guildConfigRepository.upsert({
    discordGuildId: disabledGuildId,
    enabledChannelIds: [configuredChannelId],
    enabledChannelNames: [configuredNameChannel],
    enabledAgents: [],
    isEnabled: false,
    defaultLanguage: null,
  });

  const disabledGuildResponse = await router.handle({
    text: "help me",
    discordGuildId: disabledGuildId,
    userId: `disabled-user-${suffix}`,
    channelId: configuredChannelId,
    channelName: configuredNameChannel,
  });
  assert.equal(disabledGuildResponse.type, "text");
  assert.match(disabledGuildResponse.text, /disabled for this server/i);

  const searchResult = await router.handle({
    text: query,
    discordGuildId,
    userId: discordUserId,
    channelId: discordChannelId,
    channelName: discordChannelName,
  });

  assert.equal(searchResult.type, "gallery_search_results");
  ensure(searchResult.cards.length > 0, "Expected gallery search results for select test");

  await awaitPendingSearchSessionWrite({
    discordGuildId,
    discordUserId,
    discordChannelId,
    timeoutMs: 5000,
  });

  const activeSessionsAfterSearch = await gallerySearchSessionRepository.findRecentByUserId({
    discordGuildId,
    discordUserId,
    discordChannelId,
    status: "active",
  });
    assert.equal(activeSessionsAfterSearch.length, 1);
    assert.equal(activeSessionsAfterSearch[0]?.discordGuildId, discordGuildId);

    const zeroResultSearchResponse = await router.handle({
      text: ZERO_RESULT_QUERY,
      discordGuildId: zeroResultGuildId,
      userId: zeroResultUserId,
      channelId: zeroResultChannelId,
      channelName: discordChannelName,
    });
    assert.equal(zeroResultSearchResponse.type, "text");
    assert.equal(zeroResultSearchResponse.text, EMPTY_GALLERY_TEXT);

    const zeroResultActiveSessions = await gallerySearchSessionRepository.findRecentByUserId({
      discordGuildId: zeroResultGuildId,
      discordUserId: zeroResultUserId,
      discordChannelId: zeroResultChannelId,
      status: "active",
    });
    assert.equal(zeroResultActiveSessions.length, 0);

    const staleSessionSearch = await router.handle({
      text: query,
      discordGuildId: staleSessionGuildId,
      userId: staleSessionUserId,
      channelId: staleSessionChannelId,
      channelName: discordChannelName,
    });
    assert.equal(staleSessionSearch.type, "gallery_search_results");

    await awaitPendingSearchSessionWrite({
      discordGuildId: staleSessionGuildId,
      discordUserId: staleSessionUserId,
      discordChannelId: staleSessionChannelId,
      timeoutMs: 5000,
    });

    const staleSessionBeforeZeroResult = await gallerySearchSessionRepository.findRecentByUserId({
      discordGuildId: staleSessionGuildId,
      discordUserId: staleSessionUserId,
      discordChannelId: staleSessionChannelId,
      status: "active",
    });
    assert.equal(staleSessionBeforeZeroResult.length, 1);

    const staleSessionZeroResultResponse = await router.handle({
      text: ZERO_RESULT_QUERY,
      discordGuildId: staleSessionGuildId,
      userId: staleSessionUserId,
      channelId: staleSessionChannelId,
      channelName: discordChannelName,
    });
    assert.equal(staleSessionZeroResultResponse.type, "text");
    assert.equal(staleSessionZeroResultResponse.text, EMPTY_GALLERY_TEXT);

    const staleSessionAfterZeroResult = await gallerySearchSessionRepository.findRecentByUserId({
      discordGuildId: staleSessionGuildId,
      discordUserId: staleSessionUserId,
      discordChannelId: staleSessionChannelId,
      status: "active",
    });
    assert.equal(staleSessionAfterZeroResult.length, 0);

    const zeroResultSelectResponse = await router.handle({
      text: "1",
      discordGuildId: staleSessionGuildId,
      userId: staleSessionUserId,
      channelId: staleSessionChannelId,
      channelName: discordChannelName,
    });
    assert.notEqual(zeroResultSelectResponse.type, "gallery_checkout_created");
    if (zeroResultSelectResponse.type === "text") {
      assert.notEqual(zeroResultSelectResponse.text, "Please choose a number from 1 to 0.");
    }

    const girlNarrationResponse = await router.handle({
      text: "girl",
      discordGuildId: narrationGuildId,
      userId: narrationUserId,
      channelId: narrationChannelId,
      channelName: discordChannelName,
    });
    assert.equal(girlNarrationResponse.type, "gallery_search_results");
    assert.ok(girlNarrationResponse.text.trim().length > 0);
    assert.notEqual(girlNarrationResponse.text, LEGACY_SUCCESS_PREFIX);
    assert.equal(girlNarrationResponse.metadata?.curatorNarrationUsed, true);
    assert.equal(girlNarrationResponse.metadata?.responseTextSource, "curator_summary");
    assert.ok((girlNarrationResponse.cards[0]?.curatorNarration?.embedLines?.length ?? 0) >= 2);

    const originalGallerySearch = galleryRepository.search;
    let recoveryPrimarySearchConsumed = false;
    galleryRepository.search = async (query) => {
      const normalizedKeywords = query.keywords.map((keyword) => keyword.trim().toLowerCase());
      const isRecoveryTarget = normalizedKeywords.includes("cyberpunk");

      if (isRecoveryTarget && !recoveryPrimarySearchConsumed) {
        recoveryPrimarySearchConsumed = true;
        return [];
      }

      if (isRecoveryTarget) {
        return originalGallerySearch({
          ...query,
          keywords: ["girl"],
          tags: [],
          style: "",
          rarity: "",
          category: "",
          character: "female character",
          color: "",
          mood: "",
          scene: "",
        });
      }

      return originalGallerySearch(query);
    };

    try {
      const recoveryResponse = await router.handle({
        text: RECOVERY_QUERY,
        discordGuildId: recoveryGuildId,
        userId: recoveryUserId,
        channelId: recoveryChannelId,
        channelName: discordChannelName,
      });
      assert.equal(recoveryResponse.type, "gallery_search_results");
      assert.match(recoveryResponse.text, /similar vibe/i);
      assert.equal(recoveryResponse.metadata?.recoveryTriggered, true);
      assert.ok(Number(recoveryResponse.metadata?.recoveryResultCount) > 0);
      assert.notEqual(recoveryResponse.metadata?.responseTextSource, "legacy_empty");

      await awaitPendingSearchSessionWrite({
        discordGuildId: recoveryGuildId,
        discordUserId: recoveryUserId,
        discordChannelId: recoveryChannelId,
        timeoutMs: 5000,
      });

      const recoveryActiveSession = await gallerySearchSessionRepository.findLatest({
        discordGuildId: recoveryGuildId,
        discordUserId: recoveryUserId,
        discordChannelId: recoveryChannelId,
        status: "active",
      });
      ensure(recoveryActiveSession, "Expected recovery session to be persisted");
      assert.ok((recoveryResponse.cards.length ?? 0) > 0);
      assert.equal(Array.isArray(recoveryActiveSession?.results), true);
      assert.equal(getFirstSessionCardId(recoveryActiveSession), recoveryResponse.cards[0]?.id ?? null);
    } finally {
      galleryRepository.search = originalGallerySearch;
    }

  const originalCreateProductFromGalleryCard = shopifyService.createProductFromGalleryCard;
  let capturedCheckoutPrice: string | null = null;
  shopifyService.createProductFromGalleryCard = async (selectedCard, order) => {
    capturedCheckoutPrice = selectedCard.price;
    return {
      orderNumber: order.orderNumber,
      galleryCardId: selectedCard.galleryCardId,
      shopifyProductId: "mock-shopify-product-id",
      productTitle: "Crimson Neon Valkyrie | LC-000001-BUEZ",
      productCode: "LC-000001-BUEZ",
      productHandle: "crimson-neon-valkyrie-lc-000001-buez",
      sku: "LC-000001-BUEZ",
      productUrl: "https://example.com/products/crimson-neon-valkyrie-lc-000001-buez",
      purchaseUrl: "https://example.com/cart/mock-variant:1?note=mock-order",
      shareImageUrl: selectedCard.imageUrl,
    };
  };

  try {
    const checkoutResponse = await router.handle({
      text: "1",
      discordGuildId,
      userId: discordUserId,
      channelId: discordChannelId,
      channelName: discordChannelName,
    });

    assert.equal(checkoutResponse.type, "gallery_checkout_created");
    assert.equal(checkoutResponse.title, "Crimson Neon Valkyrie | LC-000001-BUEZ");
    assert.equal(checkoutResponse.productUrl, "https://example.com/products/crimson-neon-valkyrie-lc-000001-buez");
    assert.equal(checkoutResponse.purchaseUrl, "https://example.com/cart/mock-variant:1?note=mock-order");
    assert.equal(checkoutResponse.productHandle, "crimson-neon-valkyrie-lc-000001-buez");
    assert.ok(checkoutResponse.shareImageUrl);
    assert.equal(checkoutResponse.metadata?.productCode, "LC-000001-BUEZ");

    const persistedOrder = await orderService.findByOrderNumber(checkoutResponse.orderNumber);
    ensure(persistedOrder, "Expected created order to be persisted");
    if (!persistedOrder) {
      throw new Error("Expected created order to be persisted");
    }
    ensure(capturedCheckoutPrice !== null, "Expected mocked Shopify checkout price to be captured");
    const numericCheckoutPrice = Number(capturedCheckoutPrice);
    ensure(Number.isFinite(numericCheckoutPrice), "Expected checkout price to be numeric");
    ensure(
      numericCheckoutPrice >= 9.0 && numericCheckoutPrice <= 20.1,
      `Expected safe checkout price band, got ${capturedCheckoutPrice}`
    );
    assert.equal(persistedOrder.status, "checkout_created");
    assert.equal(persistedOrder.shopifyProductId, "mock-shopify-product-id");
    assert.equal(persistedOrder.shopifyCheckoutUrl, checkoutResponse.purchaseUrl);
    assert.equal(persistedOrder.shopifyProductUrl, checkoutResponse.productUrl);
    assert.equal(persistedOrder.shopifyShareImageUrl, checkoutResponse.shareImageUrl);
    assert.equal(persistedOrder.shopifyProductHandle, checkoutResponse.productHandle);
    assert.equal(persistedOrder.preferredLanguage, "en");
    assert.equal(persistedOrder.amount, capturedCheckoutPrice);
    assert.equal(checkoutResponse.price, capturedCheckoutPrice);

    console.log(`[TEST GALLERY SELECT] productUrl=${checkoutResponse.productUrl}`);
    console.log(`[TEST GALLERY SELECT] purchaseUrl=${checkoutResponse.purchaseUrl}`);
    console.log(`[TEST GALLERY SELECT] shareImageUrl=${checkoutResponse.shareImageUrl}`);

    await gallerySearchSessionRepository.archiveActiveSessions({
      discordGuildId,
      discordUserId,
      discordChannelId,
    });
    await gallerySearchSessionRepository.create({
      discordGuildId,
      discordUserId,
      discordChannelId,
      query,
      results: searchResult.cards.slice(0, 3).map(createSessionResultCard),
      status: "active",
    });

    const outOfRangeResponse = await router.handle({
      text: "5",
      discordGuildId,
      userId: discordUserId,
      channelId: discordChannelId,
      channelName: discordChannelName,
    });
    assert.equal(outOfRangeResponse.type, "text");
    assert.equal(outOfRangeResponse.text, "Please choose a number from 1 to 3.");

    shopifyService.createProductFromGalleryCard = async () => {
      throw new Error("Simulated Shopify creation failure");
    };

    const checkoutFailureResponse = await router.handle({
      text: "1",
      discordGuildId,
      userId: discordUserId,
      channelId: discordChannelId,
      channelName: discordChannelName,
    });
    assert.equal(checkoutFailureResponse.type, "text");
    assert.equal(
      checkoutFailureResponse.text,
      "Unable to create a product link right now. Please try again later."
    );

    const activeSessionsAfterFailure = await gallerySearchSessionRepository.findRecentByUserId({
      discordGuildId,
      discordUserId,
      discordChannelId,
      status: "active",
    });
    assert.equal(activeSessionsAfterFailure.length, 1);

    const multiGuildUserId = "test-user-001";
    const multiGuildChannelId = "test-channel-001";
    const guildA = "test-guild-A";
    const guildB = "test-guild-B";
    const guildAQuery = "Show me 10 black gold queen cards";
    const guildBQuery = "Show me 10 dark angel cards";

    await gallerySearchSessionRepository.archiveActiveSessions({
      discordGuildId: guildA,
      discordUserId: multiGuildUserId,
      discordChannelId: multiGuildChannelId,
    });
    await gallerySearchSessionRepository.archiveActiveSessions({
      discordGuildId: guildB,
      discordUserId: multiGuildUserId,
      discordChannelId: multiGuildChannelId,
    });
    await gallerySearchSessionRepository.archiveActiveSessions({
      discordGuildId: null,
      discordUserId: multiGuildUserId,
      discordChannelId: multiGuildChannelId,
    });

    const guildASearch = await router.handle({
      text: guildAQuery,
      discordGuildId: guildA,
      userId: multiGuildUserId,
      channelId: multiGuildChannelId,
      channelName: "lootcardchoose",
    });
    assert.equal(guildASearch.type, "gallery_search_results");

    const guildBSearch = await router.handle({
      text: guildBQuery,
      discordGuildId: guildB,
      userId: multiGuildUserId,
      channelId: multiGuildChannelId,
      channelName: "lootcardchoose",
    });
    assert.equal(guildBSearch.type, "gallery_search_results");

    await awaitPendingSearchSessionWrite({
      discordGuildId: guildA,
      discordUserId: multiGuildUserId,
      discordChannelId: multiGuildChannelId,
      timeoutMs: 5000,
    });
    await awaitPendingSearchSessionWrite({
      discordGuildId: guildB,
      discordUserId: multiGuildUserId,
      discordChannelId: multiGuildChannelId,
      timeoutMs: 5000,
    });

    const guildAActiveSession = await gallerySearchSessionRepository.findLatest({
      discordGuildId: guildA,
      discordUserId: multiGuildUserId,
      discordChannelId: multiGuildChannelId,
      status: "active",
    });
    const guildBActiveSession = await gallerySearchSessionRepository.findLatest({
      discordGuildId: guildB,
      discordUserId: multiGuildUserId,
      discordChannelId: multiGuildChannelId,
      status: "active",
    });
    ensure(guildAActiveSession, "Expected guild A active session");
    ensure(guildBActiveSession, "Expected guild B active session");
    assert.equal(guildAActiveSession?.discordGuildId, guildA);
    assert.equal(guildBActiveSession?.discordGuildId, guildB);
    assert.notEqual(guildAActiveSession?.id, guildBActiveSession?.id);
    assert.equal(guildAActiveSession?.query, guildAQuery);
    assert.equal(guildBActiveSession?.query, guildBQuery);

    const guildARecentSessions = await gallerySearchSessionRepository.findRecentByUserId({
      discordGuildId: guildA,
      discordUserId: multiGuildUserId,
      discordChannelId: multiGuildChannelId,
      status: "active",
    });
    const guildBRecentSessions = await gallerySearchSessionRepository.findRecentByUserId({
      discordGuildId: guildB,
      discordUserId: multiGuildUserId,
      discordChannelId: multiGuildChannelId,
      status: "active",
    });
    assert.equal(guildARecentSessions.length, 1);
    assert.equal(guildBRecentSessions.length, 1);

    const guildAExpectedCardId = getFirstSessionCardId(guildAActiveSession);
    const guildBExpectedCardId = getFirstSessionCardId(guildBActiveSession);
    ensure(guildAExpectedCardId, "Expected guild A session first card id");
    ensure(guildBExpectedCardId, "Expected guild B session first card id");

    const guildASelect = await router.handle({
      text: "1",
      discordGuildId: guildA,
      userId: multiGuildUserId,
      channelId: multiGuildChannelId,
      channelName: "lootcardchoose",
    });
    const guildBSelect = await router.handle({
      text: "1",
      discordGuildId: guildB,
      userId: multiGuildUserId,
      channelId: multiGuildChannelId,
      channelName: "lootcardchoose",
    });
    assert.equal(guildASelect.type, "text");
    assert.equal(
      guildASelect.text,
      "Unable to create a product link right now. Please try again later."
    );
    assert.equal(guildBSelect.type, "text");
    assert.equal(
      guildBSelect.text,
      "Unable to create a product link right now. Please try again later."
    );

    const guildASelectedSession = await gallerySearchSessionRepository.findLatest({
      discordGuildId: guildA,
      discordUserId: multiGuildUserId,
      discordChannelId: multiGuildChannelId,
      status: "active",
    });
    const guildBSelectedSession = await gallerySearchSessionRepository.findLatest({
      discordGuildId: guildB,
      discordUserId: multiGuildUserId,
      discordChannelId: multiGuildChannelId,
      status: "active",
    });
    assert.equal(guildASelectedSession?.query, guildAQuery);
    assert.equal(guildBSelectedSession?.query, guildBQuery);
    assert.equal(guildASelectedSession?.selectedGalleryCardId, guildAExpectedCardId);
    assert.equal(guildBSelectedSession?.selectedGalleryCardId, guildBExpectedCardId);
    assert.notEqual(guildASelectedSession?.selectedGalleryCardId, null);
    assert.notEqual(guildBSelectedSession?.selectedGalleryCardId, null);

    const nullGuildLookupAgainstSharedIds = await gallerySearchSessionRepository.findLatest({
      discordGuildId: null,
      discordUserId: multiGuildUserId,
      discordChannelId: multiGuildChannelId,
      status: "active",
    });
    assert.equal(nullGuildLookupAgainstSharedIds, null);

    const legacyUserId = multiGuildUserId;
    const legacyChannelId = multiGuildChannelId;
    const legacySession = await gallerySearchSessionRepository.create({
      discordGuildId: null,
      discordUserId: legacyUserId,
      discordChannelId: legacyChannelId,
      query,
      results: searchResult.cards.slice(0, 1).map(createSessionResultCard),
      status: "active",
    });
    const legacyLookup = await gallerySearchSessionRepository.findLatest({
      discordGuildId: null,
      discordUserId: legacyUserId,
      discordChannelId: legacyChannelId,
      status: "active",
    });
    assert.equal(legacyLookup?.id, legacySession.id);
    assert.equal(legacyLookup?.discordGuildId, null);
    assert.notEqual(legacyLookup?.id, guildASelectedSession?.id);
    assert.notEqual(legacyLookup?.id, guildBSelectedSession?.id);
  } finally {
    shopifyService.createProductFromGalleryCard = originalCreateProductFromGalleryCard;
    await guildConfigRepository.deleteByGuildId(legacyGuildId);
    await guildConfigRepository.deleteByGuildId(configuredGuildId);
    await guildConfigRepository.deleteByGuildId(disabledGuildId);
  }
};

main().catch((error) => {
  console.error("[TEST GALLERY SELECT] failed", error);
  process.exit(1);
});
