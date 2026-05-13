import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import { buildStructuredGalleryKeywords, galleryService } from "../services/gallery.service";
import { parseGalleryQuery } from "../services/llm-query-parser.service";

const TEST_CASES = [
  {
    query: "Show me 10 black gold SSR female cards",
    expectedLanguage: "en" as const,
    expectedKeywords: ["black gold", "SSR", "female character"],
  },
  {
    query: "给我10张黑金SSR女角色卡牌",
    expectedLanguage: "zh" as const,
    expectedKeywords: ["black gold", "SSR", "female character"],
  },
  {
    query: "美女",
    expectedLanguage: "zh" as const,
    expectedKeywords: ["female character", "beauty"],
  },
];

const ensure = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const includesKeyword = (keywords: string[], expected: string): boolean =>
  keywords.map((keyword) => keyword.toLowerCase()).includes(expected.toLowerCase());

const isSafeDisplayPrice = (price: number): boolean => price >= 9.0 && price <= 20.1;

const main = async (): Promise<void> => {
  for (const testCase of TEST_CASES) {
    console.log(`[TEST GALLERY SEARCH] query=${JSON.stringify(testCase.query)}`);

    const parsed = await parseGalleryQuery(testCase.query);
    console.log(`[TEST GALLERY SEARCH] parsed=${JSON.stringify(parsed)}`);
    ensure(parsed, `Expected parsed query for ${testCase.query}`);
    if (!parsed) {
      continue;
    }

    ensure(parsed.language === testCase.expectedLanguage, `Expected language=${testCase.expectedLanguage}`);
    ensure(parsed.limit > 0, `Expected parsed limit > 0 for query=${testCase.query}`);
    ensure(parsed.limit <= 10, `Expected parsed limit <= 10 for query=${testCase.query}`);

    const structuredKeywords = buildStructuredGalleryKeywords(parsed);
    console.log(`[TEST GALLERY SEARCH] structured keywords=${JSON.stringify(structuredKeywords)}`);

    for (const expectedKeyword of testCase.expectedKeywords) {
      ensure(
        includesKeyword(structuredKeywords, expectedKeyword),
        `Expected keyword ${expectedKeyword} for query=${testCase.query}`
      );
    }

    const result = await galleryService.searchGalleryCards(testCase.query, parsed.language);
    console.log(
      `[TEST GALLERY SEARCH] summary=${JSON.stringify({
        query: testCase.query,
        language: result.language,
        limit: result.limit,
        resultCount: result.results.length,
      })}`
    );

    ensure(result.language === testCase.expectedLanguage, `Expected result language=${testCase.expectedLanguage}`);
    ensure(result.limit > 0, `Expected search limit > 0 for query=${testCase.query}`);
    ensure(result.limit <= 10, `Expected search limit <= 10 for query=${testCase.query}`);
    ensure(result.results.length > 0, `Expected search results > 0 for query=${testCase.query}`);

    result.results.forEach((card, index) => {
      ensure(isSafeDisplayPrice(card.price), `Expected safe display price for ${card.title}, got ${card.price}`);
      console.log(
        `[TEST GALLERY SEARCH] result ${index + 1}=${JSON.stringify({
          title: card.title,
          price: card.price,
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
