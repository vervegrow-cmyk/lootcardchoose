import assert from "node:assert/strict";
import path from "node:path";
import { inquiryTelemetryService } from "../services/inquiry-telemetry.service";

const main = async (): Promise<void> => {
  const outputPath = path.join(process.cwd(), "reports", `inquiry-telemetry-test-${Date.now()}.jsonl`);

  inquiryTelemetryService.setOutputPathForTesting(outputPath);
  await inquiryTelemetryService.resetForTesting();

  try {
    await inquiryTelemetryService.recordEvent({
      requestId: "req-success",
      userId: "discord-user-1",
      channelId: "discord-channel-1",
      discordGuildId: "discord-guild-1",
      isDM: false,
      normalizedContent: "show me dark queen cards",
      intent: "gallery_search",
      agentId: "lootcardchoose",
      responseType: "gallery_search_results",
      replySuccess: true,
      replyText: "A".repeat(500),
      usedBusinessFallback: false,
      usedDeliveryFallback: false,
      sessionId: "session-1",
      orderNumber: null,
      selectedCardId: null,
      query: "show me dark queen cards",
    });

    await inquiryTelemetryService.recordEvent({
      requestId: "req-failed",
      userId: "discord-user-2",
      channelId: "discord-channel-2",
      discordGuildId: null,
      isDM: true,
      normalizedContent: "help",
      intent: "help",
      agentId: "lootcardchoose",
      responseType: "error_fallback",
      replySuccess: false,
      replyText: "Temporary error reply",
      usedBusinessFallback: null,
      usedDeliveryFallback: false,
      sessionId: null,
      orderNumber: null,
      selectedCardId: null,
      query: null,
    });

    const events = await inquiryTelemetryService.readEventsForTesting();
    assert.equal(events.length, 2);
    assert.equal(events[0]?.logVersion, 1);
    assert.equal(events[0]?.responseType, "gallery_search_results");
    assert.equal(events[0]?.replySuccess, true);
    assert.equal(events[0]?.sessionId, "session-1");
    assert.equal(events[0]?.usedBusinessFallback, false);
    assert.ok((events[0]?.replyText.length ?? 0) <= 400);
    assert.equal(events[1]?.responseType, "error_fallback");
    assert.equal(events[1]?.replySuccess, false);
    assert.equal(events[1]?.intent, "help");
    assert.equal(events[1]?.isDM, true);

    console.log("[TEST INQUIRY TELEMETRY] all assertions passed");
  } finally {
    await inquiryTelemetryService.resetForTesting();
    inquiryTelemetryService.setOutputPathForTesting(null);
  }
};

main().catch((error) => {
  console.error("[TEST INQUIRY TELEMETRY] failed", error);
  process.exit(1);
});
