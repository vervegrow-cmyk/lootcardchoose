import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import { detectPreferredLanguage } from "../utils/gallery-language";
import { galleryService, getLastRecommendationDebugSnapshot } from "../services/gallery.service";

const TEST_QUERIES = [
  "给我10张黑金SSR女角色卡牌",
  "给我压迫感强一点的女王",
  "推荐神圣感强的白金圣女",
  "我要赛博朋克机甲少女",
  "给我黑暗哥特风收藏卡",
  "give me dark fantasy queen cards",
  "recommend cyberpunk mecha girl cards",
];

type QueryResult = {
  query: string;
  candidateCount: number;
  rerankHappened: boolean;
  usedFallback: boolean;
  topResults: Array<{
    id: string;
    title: string;
    finalScore: number;
    scoreBreakdown: {
      visualMatch: number;
      moodMatch: number;
      characterMatch: number;
      archetypeMatch: number;
      settingMatch: number;
      genreMatch: number;
      commerceMatch: number;
      diversityPenalty: number;
      finalScore: number;
    } | null;
    reasons: string[];
  }>;
};

const ensure = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const runQuery = async (query: string): Promise<QueryResult> => {
  const language = detectPreferredLanguage(query);
  const result = await galleryService.searchGalleryCards(query, language);
  const debugSnapshot = getLastRecommendationDebugSnapshot();

  ensure(debugSnapshot && debugSnapshot.rawQuery === query, `Missing debug snapshot for ${query}`);
  const snapshot = debugSnapshot!;
  ensure(result.results.length > 0, `Expected at least one result for ${query}`);
  ensure(snapshot.candidateCount > 0, `Expected candidates for ${query}`);

  const topResults = snapshot.top10AfterRerank.slice(0, Math.min(5, snapshot.top10AfterRerank.length)).map((item) => ({
    id: item.id,
    title: item.title,
    finalScore: item.recommendationScore?.finalScore ?? item.scoreTotal,
    scoreBreakdown: item.recommendationScore
      ? {
          visualMatch: item.recommendationScore.visualMatch,
          moodMatch: item.recommendationScore.moodMatch,
          characterMatch: item.recommendationScore.characterMatch,
          archetypeMatch: item.recommendationScore.archetypeMatch,
          settingMatch: item.recommendationScore.settingMatch,
          genreMatch: item.recommendationScore.genreMatch,
          commerceMatch: item.recommendationScore.commerceMatch,
          diversityPenalty: item.recommendationScore.diversityPenalty,
          finalScore: item.recommendationScore.finalScore,
        }
      : null,
    reasons: item.recommendationScore?.reasons ?? item.scoreReasons,
  }));

  ensure(
    topResults.every((entry) => typeof entry.finalScore === "number"),
    `Expected finalScore in top results for ${query}`
  );
  ensure(
    topResults.every((entry) => Array.isArray(entry.reasons)),
    `Expected reasons in top results for ${query}`
  );

  const payload: QueryResult = {
    query,
    candidateCount: snapshot.candidateCount,
    rerankHappened: snapshot.rerankHappened,
    usedFallback: snapshot.usedFallback,
    topResults,
  };

  console.log(JSON.stringify(payload, null, 2));
  return payload;
};

const main = async (): Promise<void> => {
  const results: QueryResult[] = [];

  for (const query of TEST_QUERIES) {
    results.push(await runQuery(query));
  }

  const rerankCount = results.filter((item) => item.rerankHappened).length;
  const scoredCount = results.filter((item) =>
    item.topResults.some((result) => result.scoreBreakdown !== null && result.finalScore >= 0)
  ).length;

  const summary = {
    totalQueries: results.length,
    rerankCount,
    scoredCount,
    fallbackCount: results.filter((item) => item.usedFallback).length,
  };

  console.log(JSON.stringify({ summary }, null, 2));

  ensure(scoredCount === results.length, "Expected every query to expose finalScore and scoreBreakdown");
  ensure(rerankCount >= 1, "Expected at least one query to trigger detectable rerank");
};

main().catch((error) => {
  console.error("[TEST GALLERY RECOMMENDATION] failed", error);
  process.exit(1);
});
