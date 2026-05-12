import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import { buildStructuredGalleryKeywords, galleryService } from "../services/gallery.service";
import { parseGalleryQuery } from "../services/llm-query-parser.service";

const TEST_CASES = [
  "美女",
  "黑金 SSR 女角色",
  "给我10张黑金SSR女角色卡牌",
];

const ensure = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async (): Promise<void> => {
  for (const query of TEST_CASES) {
    console.log(`[TEST GALLERY SEARCH] query=${JSON.stringify(query)}`);

    const parsed = await parseGalleryQuery(query, "zh");
    console.log(`[TEST GALLERY SEARCH] parsed=${JSON.stringify(parsed)}`);

    const structuredKeywords = parsed ? buildStructuredGalleryKeywords(parsed) : [];
    console.log(`[TEST GALLERY SEARCH] structured keywords=${JSON.stringify(structuredKeywords)}`);

    const result = await galleryService.searchGalleryCards(query, "zh");
    console.log(
      `[TEST GALLERY SEARCH] summary=${JSON.stringify({
        query,
        limit: result.limit,
        resultCount: result.results.length,
      })}`
    );

    ensure(result.limit > 0, `Expected search limit > 0 for query=${query}`);
    ensure(result.results.length > 0, `Expected search results > 0 for query=${query}`);

    result.results.forEach((card, index) => {
      console.log(
        `[TEST GALLERY SEARCH] result ${index + 1}=${JSON.stringify({
          title: card.title,
          rarity: card.rarity,
          color: card.color,
          character: card.character,
          score: card.score ?? null,
        })}`
      );
    });
  }
};

main().catch((error) => {
  console.error("[TEST GALLERY SEARCH] failed", error);
  process.exit(1);
});
