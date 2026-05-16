import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import { parseGalleryQuery, buildRuleBasedGalleryQuery } from "../services/llm-query-parser.service";

const TEST_CASES = [
  "给我10张黑金SSR女角色卡牌",
  "像最终Boss一样的黑暗女王",
  "圣洁神秘的白金女神",
  "blue hair anime maid",
  "cyberpunk mecha girl",
  "gothic vampire queen",
  "elegant kimono goddess",
  "one piece style warrior",
];

const ensure = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async (): Promise<void> => {
  for (const query of TEST_CASES) {
    const parsed = await parseGalleryQuery(query);
    const fallback = buildRuleBasedGalleryQuery(query, /[\u4e00-\u9fff]/.test(query) ? "zh" : "en");

    console.log(
      JSON.stringify(
        {
          query,
          parsed,
          fallback,
        },
        null,
        2
      )
    );

    ensure(parsed, `Expected parsed result for ${query}`);
    if (!parsed) {
      continue;
    }
    const intelligenceQuery = parsed.intelligenceQuery;
    ensure(intelligenceQuery, `Expected intelligenceQuery for ${query}`);
    if (!intelligenceQuery) {
      continue;
    }

    ensure(Array.isArray(parsed.keywords), `Expected keywords array for ${query}`);
    ensure(Array.isArray(intelligenceQuery.visualStyle), `Expected visualStyle array for ${query}`);
    ensure(Array.isArray(intelligenceQuery.moodTags), `Expected moodTags array for ${query}`);
    ensure(Array.isArray(intelligenceQuery.colorHints), `Expected colorHints array for ${query}`);
    ensure(["safe", "neutral", "adult", "unknown"].includes(intelligenceQuery.safetyIntent), `Invalid safetyIntent for ${query}`);
  }

  const blackGold = await parseGalleryQuery("给我10张黑金SSR女角色卡牌");
  ensure(blackGold, "Expected parsed black gold query");
  if (blackGold) {
    ensure(blackGold.rarity === "SSR", "Expected rarity SSR");
    ensure(
      blackGold.color.includes("black") || blackGold.color.includes("gold"),
      `Expected black/gold color, got ${blackGold.color}`
    );
    ensure(
      blackGold.character.toLowerCase().includes("female character"),
      `Expected female character, got ${blackGold.character}`
    );
    ensure(blackGold.limit === 10, `Expected limit 10, got ${blackGold.limit}`);
  }

  const bossLike = await parseGalleryQuery("像最终Boss一样的黑暗女王");
  ensure(bossLike, "Expected parsed boss-like query");
  if (bossLike) {
    ensure(
      !bossLike.keywords.some((keyword) => ["boss_like", "oppressive"].includes(keyword)),
      `Expected boss_like/oppressive excluded from keywords, got ${JSON.stringify(bossLike.keywords)}`
    );
  }

  const fallback = buildRuleBasedGalleryQuery("给我10张黑金SSR女角色卡牌", "zh");
  ensure(fallback.intelligenceQuery !== undefined, "Expected fallback intelligenceQuery");
};

main().catch((error) => {
  console.error("[TEST QUERY UNDERSTANDING] failed", error);
  process.exit(1);
});
