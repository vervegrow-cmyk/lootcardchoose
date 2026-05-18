import assert from "node:assert/strict";
import { Message } from "discord.js";
import { buildCheckoutFallbackText, replyWithFallback } from "../bot/discord.bot";
import { HermesGalleryCheckoutCreatedOutput } from "../hermes/types";

const response: HermesGalleryCheckoutCreatedOutput = {
  type: "gallery_checkout_created",
  language: "en",
  text: "Your card page is ready. You can share it or buy it now.",
  title: "Crimson Neon Valkyrie | LC-345678-BRA1",
  price: "150.00",
  productUrl: "https://example.com/products/crimson-neon-valkyrie-lc-345678-bra1",
  purchaseUrl: "https://example.com/cart/mock-variant:1?note=mock-order",
  shareImageUrl: "https://example.com/share-image.jpg",
  productHandle: "crimson-neon-valkyrie-lc-345678-bra1",
  orderNumber: "LC-1234567890",
  orderStatus: "checkout_created",
  metadata: {
    productCode: "LC-345678-BRA1",
  },
};

const main = async (): Promise<void> => {
  const calls: unknown[] = [];
  const fakeMessage = {
    author: { id: "discord-user-1" },
    channelId: "discord-channel-1",
    reply: async (payload: unknown) => {
      calls.push(payload);
      if (calls.length === 1) {
        throw new Error("Simulated embed send failure");
      }
    },
  } as unknown as Message;

  const fallbackText = buildCheckoutFallbackText(response);

  const deliveryResult = await replyWithFallback(
    fakeMessage,
    async () => {
      await fakeMessage.reply({
        content: response.text,
        embeds: [{ title: response.title }],
      });
    },
    fallbackText,
    {
      responseType: "gallery_checkout_created",
      orderNumber: response.orderNumber,
      productUrl: response.productUrl,
      purchaseUrl: response.purchaseUrl,
      startAt: Date.now(),
    }
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], fallbackText);
  assert.equal(deliveryResult.replySuccess, true);
  assert.equal(deliveryResult.usedDeliveryFallback, true);
};

main().catch((error) => {
  console.error("[TEST DISCORD BOT] failed", error);
  process.exit(1);
});
