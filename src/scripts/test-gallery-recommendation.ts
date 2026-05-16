import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import { detectPreferredLanguage } from "../utils/gallery-language";
import { buildGalleryResultsEmbeds } from "../utils/embeds";
import type { RecommendationDebugSnapshot } from "../services/gallery.service";
import { galleryService, getLastRecommendationDebugSnapshot } from "../services/gallery.service";
import { shopifyService } from "../services/shopify.service";

const TEST_QUERIES = [
  "dark fantasy queen cards",
  "cyberpunk mecha girl cards",
  "holy priestess collectible card",
  "divine queen SSR card",
  "oppressive dark fantasy empress",
  "recommend elegant female warrior cards",
];

type TopResult = {
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
  commerceIntelligence: RecommendationDebugSnapshot["top10AfterRerank"][number]["commerceIntelligence"];
  commercePresentation: RecommendationDebugSnapshot["top10AfterRerank"][number]["commercePresentation"];
};

type QueryResult = {
  query: string;
  parsedQuery: RecommendationDebugSnapshot["intelligenceQuery"];
  candidateCount: number;
  rerankHappened: boolean;
  usedFallback: boolean;
  topResults: TopResult[];
  embedPreview: string | null;
  shopifyPreview: {
    productTitle: string;
    subtitle: string;
    rarityFraming: string;
    collectorPositioning: string;
  } | null;
  improvementCheck: string;
  passedImprovement: boolean;
};

const ensure = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const asSearchText = (entry: Pick<TopResult, "title" | "reasons">): string =>
  `${entry.title} ${entry.reasons.join(" ")}`.toLowerCase();

const includesAny = (text: string, parts: string[]): boolean =>
  parts.some((part) => text.includes(part.toLowerCase()));

const buildTopResults = (): { snapshot: RecommendationDebugSnapshot; topResults: TopResult[] } => {
  const snapshot = getLastRecommendationDebugSnapshot();
  ensure(snapshot !== null, "Missing recommendation debug snapshot");
  const resolvedSnapshot = snapshot as RecommendationDebugSnapshot;

  const topResults = resolvedSnapshot.top10AfterRerank
    .slice(0, Math.min(5, resolvedSnapshot.top10AfterRerank.length))
    .map((item) => ({
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
    commerceIntelligence: item.commerceIntelligence,
    commercePresentation: item.commercePresentation,
  }));

  return { snapshot: resolvedSnapshot, topResults };
};

const evaluateImprovement = (query: string, topResults: TopResult[]): { improvementCheck: string; passedImprovement: boolean } => {
  const top1 = topResults[0];
  const top2Text = topResults.slice(0, 2).map(asSearchText).join(" ");
  const top1Text = top1 ? asSearchText(top1) : "";

  switch (query) {
    case "cyberpunk mecha girl cards":
      return {
        improvementCheck: "top1 should show mecha or cyberpunk signal instead of generic anime-girl-only matching",
        passedImprovement: Boolean(top1 && includesAny(top1Text, ["mecha", "cyberpunk", "robot", "android"])),
      };
    case "dark fantasy queen cards":
      return {
        improvementCheck: "top results should surface queen-family or archetype-oriented reasoning",
        passedImprovement: includesAny(top2Text, ["queen archetype", "strong queen", "ruler", "queen"]),
      };
    case "divine queen SSR card":
      return {
        improvementCheck: "queen signal should remain visible alongside divine and SSR matching",
        passedImprovement: includesAny(top2Text, ["queen archetype", "strong queen", "queen"]) && includesAny(top2Text, ["ssr", "divine"]),
      };
    case "oppressive dark fantasy empress":
      return {
        improvementCheck: "empress should map into queen-family or ruler/boss-like reasoning",
        passedImprovement: includesAny(top2Text, ["queen", "ruler", "boss like", "oppressive"]),
      };
    case "recommend elegant female warrior cards":
      return {
        improvementCheck: "warrior precision should beat generic female-character-only matching",
        passedImprovement: includesAny(top2Text, ["warrior", "character aligns with warrior", "strong warrior"]),
      };
    case "holy priestess collectible card":
      return {
        improvementCheck: "top results should show priestess or divine-family reasoning",
        passedImprovement: includesAny(top2Text, ["priestess", "divine", "holy"]),
      };
    default:
      return {
        improvementCheck: "general rerank quality",
        passedImprovement: true,
      };
  }
};

const runQuery = async (query: string): Promise<QueryResult> => {
  const language = detectPreferredLanguage(query);
  const result = await galleryService.searchGalleryCards(query, language);
  const { snapshot, topResults } = buildTopResults();
  const embedCards = result.results.map((card) => ({ ...card, language }));
  const embedPreview =
    embedCards.length > 0 ? buildGalleryResultsEmbeds(language, embedCards)[0]?.description ?? null : null;

  const topCard = result.results[0];
  const shopifyPreview = topCard
    ? await shopifyService.previewProductPresentationFromGalleryCard(
        {
          galleryCardId: topCard.id,
          title: topCard.title,
          description: topCard.description,
          imageUrl: topCard.imageUrl,
          price: topCard.price.toFixed(2),
          tags: topCard.tags,
        },
        {
          id: "preview-order",
          orderNumber: "LC-1778944000000",
          amount: topCard.price.toFixed(2),
          status: "pending",
        }
      )
    : null;

  ensure(snapshot.rawQuery === query, `Snapshot/query mismatch for ${query}`);
  ensure(result.results.length > 0, `Expected at least one result for ${query}`);
  ensure(snapshot.candidateCount > 0, `Expected candidates for ${query}`);
  ensure(topResults.every((entry) => typeof entry.finalScore === "number"), `Expected finalScore for ${query}`);
  ensure(topResults.every((entry) => Array.isArray(entry.reasons)), `Expected reasons for ${query}`);
  ensure(topResults.some((entry) => entry.commerceIntelligence), `Expected commerce intelligence for ${query}`);
  ensure(Boolean(shopifyPreview?.productTitle), `Expected Shopify preview title for ${query}`);

  const improvement = evaluateImprovement(query, topResults);
  const payload: QueryResult = {
    query,
    parsedQuery: snapshot.intelligenceQuery,
    candidateCount: snapshot.candidateCount,
    rerankHappened: snapshot.rerankHappened,
    usedFallback: snapshot.usedFallback,
    topResults,
    embedPreview,
    shopifyPreview: shopifyPreview
      ? {
          productTitle: shopifyPreview.productTitle,
          subtitle: shopifyPreview.subtitle,
          rarityFraming: shopifyPreview.rarityFraming,
          collectorPositioning: shopifyPreview.collectorPositioning,
        }
      : null,
    improvementCheck: improvement.improvementCheck,
    passedImprovement: improvement.passedImprovement,
  };

  console.log(JSON.stringify(payload, null, 2));
  return payload;
};

const main = async (): Promise<void> => {
  const results: QueryResult[] = [];

  for (const query of TEST_QUERIES) {
    results.push(await runQuery(query));
  }

  const summary = {
    totalQueries: results.length,
    rerankCount: results.filter((item) => item.rerankHappened).length,
    fallbackCount: results.filter((item) => item.usedFallback).length,
    passedImprovementCount: results.filter((item) => item.passedImprovement).length,
  };

  console.log(JSON.stringify({ summary }, null, 2));

  ensure(
    results.every((item) => item.topResults.some((entry) => entry.scoreBreakdown !== null)),
    "Expected every query to expose finalScore and scoreBreakdown"
  );
  ensure(
    results.every((item) => item.shopifyPreview?.productTitle?.includes("—")),
    "Expected every query to expose upgraded Shopify commerce title preview"
  );
  ensure(
    results.filter((item) => item.query !== "holy priestess collectible card").every((item) => item.passedImprovement),
    "Expected English precision improvement checks to pass"
  );
};

main().catch((error) => {
  console.error("[TEST GALLERY RECOMMENDATION] failed", error);
  process.exit(1);
});
