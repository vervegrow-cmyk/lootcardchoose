import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import { buildRuleBasedGalleryQuery } from "../services/llm-query-parser.service";

type TestCase = {
  input: string;
  language: "en" | "zh";
  expected?: {
    visualStyle?: string[];
    moodTags?: string[];
    toneTags?: string[];
    characterTypes?: string[];
    archetypeTags?: string[];
    settingTags?: string[];
    genreTags?: string[];
    colorHints?: string[];
    rarity?: string;
  };
};

const TEST_CASES: TestCase[] = [
  {
    input: "给我10张黑金SSR女角色卡牌",
    language: "zh",
    expected: {
      colorHints: ["black", "gold"],
      rarity: "SSR",
      characterTypes: ["female character"],
    },
  },
  {
    input: "给我压迫感强一点的女王",
    language: "zh",
    expected: {
      moodTags: ["oppressive"],
      archetypeTags: ["queen"],
    },
  },
  {
    input: "推荐神圣感强的白金圣女",
    language: "zh",
    expected: {
      moodTags: ["divine"],
      colorHints: ["white", "gold"],
      characterTypes: ["priestess"],
    },
  },
  {
    input: "我要赛博朋克机甲少女",
    language: "zh",
    expected: {
      visualStyle: ["cyberpunk"],
      characterTypes: ["mecha girl"],
      genreTags: ["mecha"],
    },
  },
  {
    input: "给我黑暗哥特风收藏卡",
    language: "zh",
    expected: {
      visualStyle: ["gothic"],
      toneTags: ["dark"],
    },
  },
  {
    input: "give me dark fantasy queen cards",
    language: "en",
    expected: {
      visualStyle: ["dark fantasy"],
      archetypeTags: ["queen"],
      toneTags: ["dark"],
    },
  },
  {
    input: "recommend cyberpunk mecha girl cards",
    language: "en",
    expected: {
      visualStyle: ["cyberpunk"],
      characterTypes: ["mecha girl"],
      genreTags: ["mecha"],
    },
  },
];

const QUANTIFIER_PATTERNS = [/^\d+$/, /^(one|two|three|four|five|six|seven|eight|nine|ten)$/i];

const ensure = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const containsAll = (actual: string[], expected: string[]): boolean =>
  expected.every((item) => actual.includes(item));

const validateMirroredFields = (field: keyof NonNullable<ReturnType<typeof buildRuleBasedGalleryQuery>["intelligenceQuery"]>, parsed: ReturnType<typeof buildRuleBasedGalleryQuery>, errors: string[]): void => {
  const topLevel = parsed[field as keyof typeof parsed];
  const nested = parsed.intelligenceQuery?.[field];

  if (!Array.isArray(topLevel) || !Array.isArray(nested)) {
    errors.push(`field ${String(field)} missing`);
    return;
  }

  if (JSON.stringify(topLevel) !== JSON.stringify(nested)) {
    errors.push(`field ${String(field)} not mirrored with intelligenceQuery`);
  }
};

const hasInvalidKeyword = (keywords: string[]): boolean =>
  keywords.some((keyword) => {
    const normalized = keyword.trim().toLowerCase();
    return QUANTIFIER_PATTERNS.some((pattern) => pattern.test(normalized));
  });

const runCase = (testCase: TestCase): { passed: boolean; errors: string[] } => {
  const parsed = buildRuleBasedGalleryQuery(testCase.input, testCase.language);
  const errors: string[] = [];
  const intelligenceQuery = parsed.intelligenceQuery;

  ensure(intelligenceQuery, `Expected intelligenceQuery for ${testCase.input}`);

  validateMirroredFields("visualStyle", parsed, errors);
  validateMirroredFields("moodTags", parsed, errors);
  validateMirroredFields("toneTags", parsed, errors);
  validateMirroredFields("characterTypes", parsed, errors);
  validateMirroredFields("archetypeTags", parsed, errors);
  validateMirroredFields("settingTags", parsed, errors);
  validateMirroredFields("genreTags", parsed, errors);
  validateMirroredFields("colorHints", parsed, errors);

  if (testCase.expected?.visualStyle && !containsAll(parsed.visualStyle, testCase.expected.visualStyle)) {
    errors.push(`missing visualStyle ${JSON.stringify(testCase.expected.visualStyle)}`);
  }
  if (testCase.expected?.moodTags && !containsAll(parsed.moodTags, testCase.expected.moodTags)) {
    errors.push(`missing moodTags ${JSON.stringify(testCase.expected.moodTags)}`);
  }
  if (testCase.expected?.toneTags && !containsAll(parsed.toneTags, testCase.expected.toneTags)) {
    errors.push(`missing toneTags ${JSON.stringify(testCase.expected.toneTags)}`);
  }
  if (testCase.expected?.characterTypes && !containsAll(parsed.characterTypes, testCase.expected.characterTypes)) {
    errors.push(`missing characterTypes ${JSON.stringify(testCase.expected.characterTypes)}`);
  }
  if (testCase.expected?.archetypeTags && !containsAll(parsed.archetypeTags, testCase.expected.archetypeTags)) {
    errors.push(`missing archetypeTags ${JSON.stringify(testCase.expected.archetypeTags)}`);
  }
  if (testCase.expected?.settingTags && !containsAll(parsed.settingTags, testCase.expected.settingTags)) {
    errors.push(`missing settingTags ${JSON.stringify(testCase.expected.settingTags)}`);
  }
  if (testCase.expected?.genreTags && !containsAll(parsed.genreTags, testCase.expected.genreTags)) {
    errors.push(`missing genreTags ${JSON.stringify(testCase.expected.genreTags)}`);
  }
  if (testCase.expected?.colorHints && !containsAll(parsed.colorHints, testCase.expected.colorHints)) {
    errors.push(`missing colorHints ${JSON.stringify(testCase.expected.colorHints)}`);
  }
  if (testCase.expected?.rarity && parsed.rarity !== testCase.expected.rarity) {
    errors.push(`rarity mismatch: expected ${testCase.expected.rarity}, got ${parsed.rarity}`);
  }

  if (!Array.isArray(parsed.keywords) || parsed.keywords.length === 0) {
    errors.push("keywords missing");
  }
  if (hasInvalidKeyword(parsed.keywords)) {
    errors.push(`quantifier leaked into keywords: ${JSON.stringify(parsed.keywords)}`);
  }

  console.log(
    JSON.stringify(
      {
        input: testCase.input,
        parsedQuery: {
          keywords: parsed.keywords,
          rarity: parsed.rarity,
          style: parsed.style,
          character: parsed.character,
          color: parsed.color,
          visualStyle: parsed.visualStyle,
          moodTags: parsed.moodTags,
          toneTags: parsed.toneTags,
          characterTypes: parsed.characterTypes,
          archetypeTags: parsed.archetypeTags,
          settingTags: parsed.settingTags,
          genreTags: parsed.genreTags,
          colorHints: parsed.colorHints,
        },
        intelligenceQuery: parsed.intelligenceQuery,
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
  const failures: Array<{ input: string; errors: string[] }> = [];

  for (const testCase of TEST_CASES) {
    const result = runCase(testCase);
    if (!result.passed) {
      failures.push({ input: testCase.input, errors: result.errors });
    }
  }

  console.log(
    JSON.stringify(
      {
        summary: {
          total: TEST_CASES.length,
          passed: TEST_CASES.length - failures.length,
          failed: failures.length,
          failures,
        },
      },
      null,
      2
    )
  );

  ensure(failures.length === 0, `Query intelligence validation failed for ${failures.length} case(s).`);
};

main().catch((error) => {
  console.error("[TEST QUERY INTELLIGENCE] failed", error);
  process.exit(1);
});
