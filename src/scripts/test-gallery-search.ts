import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import { buildStructuredGalleryKeywords, galleryService } from "../services/gallery.service";
import {
  buildRawQueryFallbackKeywords,
  getLastQueryParserTelemetry,
  parseGalleryQuery,
} from "../services/llm-query-parser.service";

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

  const originalFetch = global.fetch;
  const originalApiKey = process.env.DEEPSEEK_API_KEY;
  const originalEnableNaturalLanguageSearch = process.env.ENABLE_NATURAL_LANGUAGE_SEARCH;
  try {
    process.env.ENABLE_NATURAL_LANGUAGE_SEARCH = "true";
    process.env.DEEPSEEK_API_KEY = originalApiKey || "test-parser-key";
    global.fetch = async () => {
      throw new Error("simulated parser network failure");
    };

    const phraseQuery = "Atack on Titan";
    const phraseFallbackKeywords = buildRawQueryFallbackKeywords(phraseQuery);
    ensure(phraseFallbackKeywords.keywords.length > 0, "Expected raw fallback keywords for phrase query");
    ensure(
      phraseFallbackKeywords.fallbackKeywordSource === "raw_phrase" ||
        phraseFallbackKeywords.fallbackKeywordSource === "raw_tokens",
      "Expected raw fallback keyword source for phrase query"
    );

    const parsedFallback = await parseGalleryQuery(phraseQuery, "en");
    ensure(parsedFallback, "Expected parser fallback result for phrase query");
    ensure((parsedFallback?.keywords.length ?? 0) > 0, "Expected parser fallback keywords for phrase query");

    const parserTelemetry = getLastQueryParserTelemetry();
    ensure(parserTelemetry.parserUsedFallback, "Expected parser telemetry to record fallback");
    ensure(parserTelemetry.parserFallbackReason === "network_error", "Expected network_error fallback reason");
    ensure(
      parserTelemetry.fallbackKeywordSource === "raw_phrase" || parserTelemetry.fallbackKeywordSource === "raw_tokens",
      "Expected raw fallback keyword source in parser telemetry"
    );

    const phraseSearchResult = await galleryService.searchGalleryCards(phraseQuery, "en");
    ensure(
      phraseSearchResult.searchKeywordSource === "raw_phrase" || phraseSearchResult.searchKeywordSource === "raw_tokens",
      "Expected search to use raw fallback keyword source for phrase query"
    );

    const meaninglessQuery = "12345 ???";
    const meaninglessFallbackKeywords = buildRawQueryFallbackKeywords(meaninglessQuery);
    ensure(meaninglessFallbackKeywords.keywords.length === 0, "Expected no raw fallback keywords for meaningless query");
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey == null) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = originalApiKey;
    }
    if (originalEnableNaturalLanguageSearch == null) {
      delete process.env.ENABLE_NATURAL_LANGUAGE_SEARCH;
    } else {
      process.env.ENABLE_NATURAL_LANGUAGE_SEARCH = originalEnableNaturalLanguageSearch;
    }
  }
};

main().catch((error) => {
  console.error("[TEST GALLERY SEARCH] failed", error);
  process.exit(1);
});
