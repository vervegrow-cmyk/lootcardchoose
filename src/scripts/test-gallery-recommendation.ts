import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import {
  galleryService,
  getLastRecommendationDebugSnapshot,
  RecommendationDebugCardSummary,
} from "../services/gallery.service";
import { detectPreferredLanguage } from "../utils/gallery-language";

const TEST_QUERIES = [
  "黑金SSR女王",
  "像最终Boss一样的黑暗女王",
  "圣洁神秘的白金女神",
  "blue hair anime maid",
  "gothic vampire queen",
  "elegant kimono goddess",
  "cyberpunk mecha girl",
];

const buildIndexMap = (cards: RecommendationDebugCardSummary[]): Map<string, number> =>
  new Map(cards.map((card, index) => [card.id, index]));

const computeMoves = (
  before: RecommendationDebugCardSummary[],
  after: RecommendationDebugCardSummary[]
) => {
  const beforeIndex = buildIndexMap(before);
  const afterIndex = buildIndexMap(after);

  const promoted = after
    .filter((card) => beforeIndex.has(card.id) && (beforeIndex.get(card.id) ?? 0) > (afterIndex.get(card.id) ?? 0))
    .map((card) => ({
      id: card.id,
      title: card.title,
      from: beforeIndex.get(card.id),
      to: afterIndex.get(card.id),
      scoreTotal: card.scoreTotal,
      scoreReasons: card.scoreReasons,
    }));

  const demoted = before
    .filter((card) => afterIndex.has(card.id) && (afterIndex.get(card.id) ?? 0) > (beforeIndex.get(card.id) ?? 0))
    .map((card) => {
      const afterCard = after.find((item) => item.id === card.id);
      return {
        id: card.id,
        title: card.title,
        from: beforeIndex.get(card.id),
        to: afterIndex.get(card.id),
        scoreTotal: afterCard?.scoreTotal ?? 0,
        scoreReasons: afterCard?.scoreReasons ?? [],
      };
    });

  return {
    promoted: promoted.slice(0, 10),
    demoted: demoted.slice(0, 10),
  };
};

const main = async (): Promise<void> => {
  for (const query of TEST_QUERIES) {
    const language = detectPreferredLanguage(query);
    const result = await galleryService.searchGalleryCards(query, language);
    const debugSnapshot = getLastRecommendationDebugSnapshot();

    if (!debugSnapshot || debugSnapshot.rawQuery !== query) {
      throw new Error(`Missing recommendation debug snapshot for query=${query}`);
    }

    const moves = computeMoves(debugSnapshot.top10BeforeRerank, debugSnapshot.top10AfterRerank);

    console.log(
      JSON.stringify(
        {
          query,
          resultCount: result.results.length,
          parsedOldFields: debugSnapshot.parsedOldFields,
          intelligenceQuery: debugSnapshot.intelligenceQuery,
          candidateCount: debugSnapshot.candidateCount,
          usedFallback: debugSnapshot.usedFallback,
          top10BeforeRerank: debugSnapshot.top10BeforeRerank,
          top10AfterRerank: debugSnapshot.top10AfterRerank,
          promotedItems: moves.promoted.length > 0 ? moves.promoted : "no ranking change",
          demotedItems: moves.demoted.length > 0 ? moves.demoted : "no ranking change",
          scoreReasons: debugSnapshot.scoreBreakdowns,
        },
        null,
        2
      )
    );
  }
};

main().catch((error) => {
  console.error("[TEST GALLERY RECOMMENDATION] failed", error);
  process.exit(1);
});
