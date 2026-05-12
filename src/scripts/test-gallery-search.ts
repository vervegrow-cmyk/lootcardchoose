import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import { buildStructuredGalleryKeywords, galleryService } from "../services/gallery.service";
import { parseGalleryQuery } from "../services/llm-query-parser.service";

const query = "\u7ed9\u621110\u5f20\u9ed1\u91d1SSR\u5973\u89d2\u8272\u5361\u724c";

const main = async (): Promise<void> => {
  console.log(`[TEST GALLERY SEARCH] query=${JSON.stringify(query)}`);

  const parsed = await parseGalleryQuery(query, "zh");
  console.log(`[TEST GALLERY SEARCH] parsed=${JSON.stringify(parsed)}`);

  const structuredKeywords = parsed ? buildStructuredGalleryKeywords(parsed) : [];
  console.log(`[TEST GALLERY SEARCH] structured keywords=${JSON.stringify(structuredKeywords)}`);

  const result = await galleryService.searchGalleryCards(query, "zh");
  console.log(`[TEST GALLERY SEARCH] result count=${result.results.length}`);

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
};

main().catch((error) => {
  console.error("[TEST GALLERY SEARCH] failed", error);
  process.exit(1);
});
