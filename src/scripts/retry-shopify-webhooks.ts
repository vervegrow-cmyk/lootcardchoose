import dotenv from "dotenv";
import { ShopifyWebhookEventStatus } from "../repositories/shopify-webhook-event.repository";
import { shopifyWebhookService } from "../services/shopify-webhook.service";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const parseStatuses = (): ShopifyWebhookEventStatus[] | undefined => {
  const raw = process.argv
    .slice(2)
    .find((value) => value.startsWith("--statuses="))
    ?.slice("--statuses=".length);

  if (!raw) {
    return undefined;
  }

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean) as ShopifyWebhookEventStatus[];
};

const parseLimit = (): number | undefined => {
  const raw = process.argv
    .slice(2)
    .find((value) => value.startsWith("--limit="))
    ?.slice("--limit=".length);

  if (!raw) {
    return undefined;
  }

  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
};

const main = async (): Promise<void> => {
  const statuses = parseStatuses();
  const limit = parseLimit();
  const result = await shopifyWebhookService.retryPendingWebhookEvents({
    statuses,
    limit,
  });

  console.log(`[WEBHOOK RETRY SCRIPT] summary=${JSON.stringify(result)}`);
};

main().catch((error) => {
  console.error("[WEBHOOK RETRY SCRIPT] failed", error);
  process.exit(1);
});
