import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import { buildRuleBasedGalleryQuery } from "../services/llm-query-parser.service";

type TestCase = {
  input: string;
  language: "en" | "zh";
  expected?: {
    visualIntent?: string[];
    emotionalIntent?: string[];
    characterIntent?: string[];
    worldbuildingIntent?: string[];
    commerceIntent?: string[];
    legacyColor?: string;
    legacyRarity?: string;
    legacyCharacter?: string;
    legacyMood?: string;
  };
};

const ENGLISH_CASES: TestCase[] = [
  { input: "Show me a black gold SSR queen card", language: "en", expected: { visualIntent: ["black_gold"], characterIntent: ["queen"], legacyRarity: "SSR" } },
  { input: "I want something dark, elegant, and powerful", language: "en", expected: { emotionalIntent: ["dark", "elegant", "boss_like"] } },
  { input: "Find me a cyberpunk anime girl card", language: "en", expected: { visualIntent: ["cyberpunk"], characterIntent: ["anime_girl"] } },
  { input: "Give me a holy goddess style card", language: "en", expected: { emotionalIntent: ["divine"], characterIntent: ["goddess"] } },
  { input: "I want a cute waifu card", language: "en", expected: { emotionalIntent: ["cute"], commerceIntent: ["waifu"] } },
  { input: "Show me a boss-like female character", language: "en", expected: { emotionalIntent: ["boss_like"] } },
  { input: "Find me a mysterious dark fantasy card", language: "en", expected: { visualIntent: ["dark_fantasy"], emotionalIntent: ["mysterious"] } },
  { input: "I want a rare collectible card with premium feeling", language: "en", expected: { commerceIntent: ["rare", "collectible", "premium"] } },
  { input: "Show me a mecha girl with neon cyberpunk style", language: "en", expected: { visualIntent: ["cyberpunk"], characterIntent: ["mecha_girl"] } },
  { input: "mecha", language: "en", expected: { visualIntent: ["mecha"] } },
  { input: "robotic female", language: "en", expected: { visualIntent: ["robotic"] } },
  { input: "sci-fi girl", language: "en", expected: { visualIntent: ["sci-fi"] } },
  { input: "cyberpunk", language: "en", expected: { visualIntent: ["cyberpunk"] } },
  { input: "Give me a divine angel card", language: "en", expected: { emotionalIntent: ["divine"], characterIntent: ["angel"] } },
  { input: "I want something gothic and elegant", language: "en", expected: { visualIntent: ["gothic"], emotionalIntent: ["elegant"] } },
  { input: "Show me a battle-ready warrior card", language: "en", expected: { emotionalIntent: ["battle"], characterIntent: ["warrior"], commerceIntent: ["battle"] } },
  { input: "Find me a dragon lord card", language: "en", expected: { characterIntent: ["dragon_lord"] } },
  { input: "I want a card that feels expensive and collectible", language: "en", expected: { commerceIntent: ["premium", "high_value", "collectible"] } },
  { input: "Show me a black and red villain queen", language: "en", expected: { characterIntent: ["queen", "villain"], legacyColor: "black red" } },
  { input: "Give me an anime girl with luxury gold design", language: "en", expected: { characterIntent: ["anime_girl"], commerceIntent: ["premium", "high_value"] } },
  { input: "I want a dark boss card with strong pressure", language: "en", expected: { emotionalIntent: ["dark", "boss_like", "oppressive"] } },
  { input: "Find me a magic priestess card", language: "en", expected: { emotionalIntent: ["magic"], characterIntent: ["priestess"] } },
  { input: "Show me a card with royal fantasy vibes", language: "en", expected: { worldbuildingIntent: ["fantasy_kingdom"] } },
  { input: "I want a high-value display card", language: "en", expected: { commerceIntent: ["high_value", "display_piece"] } },
];

const CHINESE_CASES: TestCase[] = [
  { input: "给我黑金SSR女王卡", language: "zh", expected: { visualIntent: ["black_gold"], characterIntent: ["queen"], legacyRarity: "SSR" } },
  { input: "我要压迫感强一点的黑金女角色", language: "zh", expected: { visualIntent: ["black_gold"], emotionalIntent: ["oppressive"] } },
  { input: "给我神圣感强的女神卡", language: "zh", expected: { emotionalIntent: ["divine"], characterIntent: ["goddess"] } },
  { input: "找一张可爱系动漫女孩", language: "zh", expected: { emotionalIntent: ["cute"], characterIntent: ["anime_girl"] } },
  { input: "我要赛博朋克机甲少女", language: "zh", expected: { visualIntent: ["cyberpunk"], characterIntent: ["mecha_girl"] } },
  { input: "找一张暗黑幻想风卡牌", language: "zh", expected: { visualIntent: ["dark_fantasy"] } },
  { input: "我要收藏价值高一点的卡", language: "zh", expected: { commerceIntent: ["collectible", "high_value"] } },
  { input: "给我战斗感强的角色", language: "zh", expected: { emotionalIntent: ["battle"], commerceIntent: ["battle"] } },
  { input: "我要哥特优雅风格", language: "zh", expected: { visualIntent: ["gothic"], emotionalIntent: ["elegant"] } },
  { input: "找一张像最终 boss 的卡", language: "zh", expected: { emotionalIntent: ["boss_like"] } },
];

const ALL_CASES = [...ENGLISH_CASES, ...CHINESE_CASES];

const QUANTIFIER_PATTERNS = [/^\d+$/, /^(一|二|三|四|五|六|七|八|九|十)$/, /^(张|个|些|套)$/, /^(one|two|three|four|five|six|seven|eight|nine|ten)$/i];

const ensure = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const containsAll = (actual: string[], expected: string[]): boolean =>
  expected.every((item) => actual.includes(item));

const hasInvalidKeyword = (keywords: string[]): boolean =>
  keywords.some((keyword) => {
    const normalized = keyword.trim().toLowerCase();
    return QUANTIFIER_PATTERNS.some((pattern) => pattern.test(normalized));
  });

const runCase = (testCase: TestCase): { passed: boolean; errors: string[] } => {
  const parsed = buildRuleBasedGalleryQuery(testCase.input, testCase.language);
  const errors: string[] = [];
  const intelligenceQuery = parsed.intelligenceQuery;

  if (!Array.isArray(parsed.keywords)) errors.push("keywords missing");
  if (!Array.isArray(parsed.tags)) errors.push("tags missing");
  if (typeof parsed.color !== "string") errors.push("color missing");
  if (typeof parsed.rarity !== "string") errors.push("rarity missing");
  if (typeof parsed.character !== "string") errors.push("character missing");
  if (typeof parsed.mood !== "string") errors.push("mood missing");
  if (typeof parsed.scene !== "string") errors.push("scene missing");

  if (!intelligenceQuery) {
    errors.push("intelligenceQuery missing");
  } else {
    if (!Array.isArray(intelligenceQuery.visualIntent)) errors.push("visualIntent missing");
    if (!Array.isArray(intelligenceQuery.emotionalIntent)) errors.push("emotionalIntent missing");
    if (!Array.isArray(intelligenceQuery.characterIntent)) errors.push("characterIntent missing");
    if (!Array.isArray(intelligenceQuery.worldbuildingIntent)) errors.push("worldbuildingIntent missing");
    if (!Array.isArray(intelligenceQuery.commerceIntent)) errors.push("commerceIntent missing");
    if (typeof intelligenceQuery.confidence !== "number" || intelligenceQuery.confidence < 0 || intelligenceQuery.confidence > 1) {
      errors.push(`confidence out of range: ${intelligenceQuery.confidence}`);
    }
    if (!["en", "zh", "unknown"].includes(intelligenceQuery.language)) {
      errors.push(`invalid intelligence language: ${intelligenceQuery.language}`);
    }
    if (typeof intelligenceQuery.reason !== "string" || !intelligenceQuery.reason.trim()) {
      errors.push("reason missing");
    }

    if (testCase.expected?.visualIntent && !containsAll(intelligenceQuery.visualIntent, testCase.expected.visualIntent)) {
      errors.push(`missing visualIntent ${JSON.stringify(testCase.expected.visualIntent)}`);
    }
    if (testCase.expected?.emotionalIntent && !containsAll(intelligenceQuery.emotionalIntent, testCase.expected.emotionalIntent)) {
      errors.push(`missing emotionalIntent ${JSON.stringify(testCase.expected.emotionalIntent)}`);
    }
    if (testCase.expected?.characterIntent && !containsAll(intelligenceQuery.characterIntent, testCase.expected.characterIntent)) {
      errors.push(`missing characterIntent ${JSON.stringify(testCase.expected.characterIntent)}`);
    }
    if (
      testCase.expected?.worldbuildingIntent &&
      !containsAll(intelligenceQuery.worldbuildingIntent, testCase.expected.worldbuildingIntent)
    ) {
      errors.push(`missing worldbuildingIntent ${JSON.stringify(testCase.expected.worldbuildingIntent)}`);
    }
    if (testCase.expected?.commerceIntent && !containsAll(intelligenceQuery.commerceIntent, testCase.expected.commerceIntent)) {
      errors.push(`missing commerceIntent ${JSON.stringify(testCase.expected.commerceIntent)}`);
    }
  }

  if (testCase.expected?.legacyColor && parsed.color !== testCase.expected.legacyColor) {
    errors.push(`legacy color mismatch: expected ${testCase.expected.legacyColor}, got ${parsed.color}`);
  }
  if (testCase.expected?.legacyRarity && parsed.rarity !== testCase.expected.legacyRarity) {
    errors.push(`legacy rarity mismatch: expected ${testCase.expected.legacyRarity}, got ${parsed.rarity}`);
  }
  if (testCase.expected?.legacyCharacter && !parsed.character.includes(testCase.expected.legacyCharacter)) {
    errors.push(`legacy character mismatch: expected ${testCase.expected.legacyCharacter}, got ${parsed.character}`);
  }
  if (testCase.expected?.legacyMood && parsed.mood !== testCase.expected.legacyMood) {
    errors.push(`legacy mood mismatch: expected ${testCase.expected.legacyMood}, got ${parsed.mood}`);
  }

  if (parsed.keywords.some((keyword) => /^\d+$/.test(keyword.trim()))) {
    errors.push(`numeric keyword leaked: ${JSON.stringify(parsed.keywords)}`);
  }
  if (hasInvalidKeyword(parsed.keywords)) {
    errors.push(`quantifier keyword leaked: ${JSON.stringify(parsed.keywords)}`);
  }

  console.log(
    JSON.stringify(
      {
        input: testCase.input,
        legacyParsedFields: {
          keywords: parsed.keywords,
          tags: parsed.tags,
          color: parsed.color,
          rarity: parsed.rarity,
          character: parsed.character,
          mood: parsed.mood,
          scene: parsed.scene,
        },
        intelligenceQuery: parsed.intelligenceQuery,
        language: parsed.intelligenceQuery?.language ?? "unknown",
        confidence: parsed.intelligenceQuery?.confidence ?? 0,
        result: errors.length === 0 ? "PASS" : "FAIL",
        errors,
      },
      null,
      2
    )
  );

  return { passed: errors.length === 0, errors };
};

const main = async (): Promise<void> => {
  let englishPassed = 0;
  let chinesePassed = 0;
  const failures: Array<{ input: string; errors: string[] }> = [];

  for (const testCase of ALL_CASES) {
    const result = runCase(testCase);
    if (result.passed) {
      if (testCase.language === "en") {
        englishPassed += 1;
      } else {
        chinesePassed += 1;
      }
    } else {
      failures.push({ input: testCase.input, errors: result.errors });
    }
  }

  const summary = {
    english: { passed: englishPassed, total: ENGLISH_CASES.length },
    chinese: { passed: chinesePassed, total: CHINESE_CASES.length },
    totalPassed: englishPassed + chinesePassed,
    total: ALL_CASES.length,
    failures,
  };

  console.log(JSON.stringify({ summary }, null, 2));

  ensure(failures.length === 0, `Query intelligence validation failed for ${failures.length} case(s).`);
};

main().catch((error) => {
  console.error("[TEST QUERY INTELLIGENCE] failed", error);
  process.exit(1);
});
