import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import { Prisma } from "@prisma/client";
import { parseGalleryQuery } from "../services/llm-query-parser.service";
import { prisma } from "../services/prisma.service";
import { normalizeGalleryKeywordsToEnglish } from "../utils/gallery-language";

type GalleryCardAuditRecord = {
  id: string;
  title: string;
  style: string | null;
  character: string | null;
  tags: string[];
  isActive: boolean;
  metadata: Prisma.JsonValue | null;
};

type GalleryMetadataIntelligenceLike = {
  intelligenceVersion?: unknown;
  visualLayer?: {
    visualStyle?: unknown;
    styleTags?: unknown;
  };
  characterLayer?: {
    characterType?: unknown;
  };
  worldbuildingLayer?: {
    genreTags?: unknown;
    settingTags?: unknown;
  };
  commerceLayer?: {
    searchKeywords?: unknown;
  };
  emotionalLayer?: unknown;
};

type MetadataHealthSummary = {
  totalCards: number;
  cardsWithMetadataObject: number;
  cardsWithIntelligence: number;
  fiveLayerCompletenessRate: string;
  intelligenceVersionV1Rate: string;
};

type SparseThemeCounts = {
  cyberpunk: number;
  mecha: number;
  robotic: number;
  "sci-fi": number;
};

type SparseThemeSample = {
  id: string;
  title: string;
  style: string | null;
  character: string | null;
  tags: string[];
  visualStyle: string[];
  styleTags: string[];
  genreTags: string[];
  searchKeywords: string[];
  isActive: boolean;
};

type ParserGapRow = {
  query: string;
  parsedKeywords: string[];
  parsedStyle: string;
  parsedCharacter: string;
  intelligenceQuery: unknown;
  sparseThemeSignalSurvivedParsing: boolean;
  fallbackNormalization: string[];
  fallbackNormalizationDegraded: boolean;
};

type AuditReport = {
  metadataHealth: MetadataHealthSummary;
  activeCardCount: number;
  activeSparseThemeCounts: SparseThemeCounts;
  pollutedActiveCount: number;
  pollutedActiveSample: SparseThemeSample[];
  trueThemedTotalCount: number;
  trueThemedActiveCount: number;
  trueThemedInactiveCount: number;
  inactiveTrueThemedSample: SparseThemeSample[];
  parserGapMatrix: ParserGapRow[];
  needsMetadataRefresh: boolean;
  recommendedRefreshCommand: string;
  conclusions: {
    refreshRequired: boolean;
    parserFallbackRepairRecommended: boolean;
    recommendationV2RequiredNow: boolean;
  };
};

const PARSER_GAP_QUERIES = [
  "cyberpunk",
  "mecha",
  "cyberpunk mecha girl",
  "robotic female",
  "sci-fi girl",
] as const;

const TRUE_THEME_SURFACE_PATTERN = /\b(cyberpunk|mecha|mech|robot|robotic|android|mechanical|sci[-\s]?fi|science fiction|futuristic|neon)\b/i;
const CYBERPUNK_SURFACE_PATTERN = /\b(cyberpunk|neon|tech noir|futuristic city|urban sci[-\s]?fi)\b/i;
const MECHA_SURFACE_PATTERN = /\b(mecha|mech|robot|robotic|android|mechanical|powered suit)\b/i;
const ROBOTIC_SURFACE_PATTERN = /\b(robot|robotic|android|mechanical)\b/i;
const SCIFI_SURFACE_PATTERN = /\b(sci[-\s]?fi|science fiction|futuristic|cyberpunk)\b/i;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const uniqueStrings = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = (value ?? "").trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }

  return result;
};

const formatRate = (matched: number, total: number): string =>
  total === 0 ? "0.00%" : `${((matched / total) * 100).toFixed(2)}%`;

const readIntelligence = (metadata: Prisma.JsonValue | null): GalleryMetadataIntelligenceLike | null => {
  if (!isPlainObject(metadata)) {
    return null;
  }

  if (isPlainObject(metadata.intelligence)) {
    return metadata.intelligence as GalleryMetadataIntelligenceLike;
  }

  if (isPlainObject(metadata.metadata) && isPlainObject(metadata.metadata.intelligence)) {
    return metadata.metadata.intelligence as GalleryMetadataIntelligenceLike;
  }

  return null;
};

const readStringArray = (value: unknown): string[] => (isStringArray(value) ? uniqueStrings(value) : []);

const buildSparseBundle = (card: GalleryCardAuditRecord): SparseThemeSample => {
  const intelligence = readIntelligence(card.metadata);

  return {
    id: card.id,
    title: card.title,
    style: card.style,
    character: card.character,
    tags: card.tags.slice(0, 8),
    visualStyle: readStringArray(intelligence?.visualLayer?.visualStyle),
    styleTags: readStringArray(intelligence?.visualLayer?.styleTags).slice(0, 10),
    genreTags: readStringArray(intelligence?.worldbuildingLayer?.genreTags).slice(0, 10),
    searchKeywords: readStringArray(intelligence?.commerceLayer?.searchKeywords).slice(0, 10),
    isActive: card.isActive,
  };
};

const toLowerSet = (values: string[]): Set<string> => new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean));

const hasThemeTerm = (values: string[], matcher: (term: string) => boolean): boolean =>
  values.some((value) => matcher(value.trim().toLowerCase()));

const isCyberpunkThemed = (sample: SparseThemeSample): boolean =>
  hasThemeTerm([...sample.visualStyle, ...sample.styleTags, ...sample.genreTags, ...sample.searchKeywords], (term) =>
    term === "cyberpunk"
  );

const isMechaThemed = (sample: SparseThemeSample): boolean =>
  hasThemeTerm([...sample.visualStyle, ...sample.styleTags, ...sample.genreTags, ...sample.searchKeywords], (term) =>
    term === "mecha"
  );

const isRoboticThemed = (sample: SparseThemeSample): boolean =>
  hasThemeTerm([...sample.visualStyle, ...sample.styleTags, ...sample.genreTags, ...sample.searchKeywords], (term) =>
    term === "robotic" || term === "robot" || term === "android" || term === "mechanical"
  );

const isSciFiThemed = (sample: SparseThemeSample): boolean =>
  hasThemeTerm([...sample.visualStyle, ...sample.styleTags, ...sample.genreTags, ...sample.searchKeywords], (term) =>
    term === "sci-fi" || term === "science fiction" || term === "futuristic" || term === "technology"
  );

const hasAnySparseTheme = (sample: SparseThemeSample): boolean =>
  isCyberpunkThemed(sample) || isMechaThemed(sample) || isRoboticThemed(sample) || isSciFiThemed(sample);

const hasExplicitSparseSurfaceCue = (sample: SparseThemeSample): boolean => {
  const surface = [sample.title, sample.style ?? "", sample.character ?? "", ...sample.tags].join(" ");
  return TRUE_THEME_SURFACE_PATTERN.test(surface);
};

const isTrueThemedCard = (sample: SparseThemeSample): boolean => {
  const surface = [sample.title, sample.style ?? "", sample.character ?? "", ...sample.tags].join(" ");
  return (isCyberpunkThemed(sample) && CYBERPUNK_SURFACE_PATTERN.test(surface)) || (isMechaThemed(sample) && MECHA_SURFACE_PATTERN.test(surface));
};

const hasFiveLayers = (intelligence: GalleryMetadataIntelligenceLike | null): boolean => {
  if (!intelligence) {
    return false;
  }

  return ["visualLayer", "emotionalLayer", "characterLayer", "worldbuildingLayer", "commerceLayer"].every((key) =>
    isPlainObject(intelligence[key as keyof GalleryMetadataIntelligenceLike])
  );
};

const buildMetadataHealthSummary = (cards: GalleryCardAuditRecord[]): MetadataHealthSummary => {
  let cardsWithMetadataObject = 0;
  let cardsWithIntelligence = 0;
  let fiveLayerCompleteCards = 0;
  let intelligenceVersionV1Cards = 0;

  for (const card of cards) {
    if (isPlainObject(card.metadata)) {
      cardsWithMetadataObject += 1;
    }

    const intelligence = readIntelligence(card.metadata);
    if (!intelligence) {
      continue;
    }

    cardsWithIntelligence += 1;
    if (hasFiveLayers(intelligence)) {
      fiveLayerCompleteCards += 1;
    }
    if (intelligence.intelligenceVersion === "v1") {
      intelligenceVersionV1Cards += 1;
    }
  }

  return {
    totalCards: cards.length,
    cardsWithMetadataObject,
    cardsWithIntelligence,
    fiveLayerCompletenessRate: formatRate(fiveLayerCompleteCards, cards.length),
    intelligenceVersionV1Rate: formatRate(intelligenceVersionV1Cards, cards.length),
  };
};

const buildActiveSparseCounts = (samples: SparseThemeSample[]): SparseThemeCounts => ({
  cyberpunk: samples.filter((sample) => isCyberpunkThemed(sample)).length,
  mecha: samples.filter((sample) => isMechaThemed(sample)).length,
  robotic: samples.filter((sample) => isRoboticThemed(sample)).length,
  "sci-fi": samples.filter((sample) => isSciFiThemed(sample)).length,
});

const hasSparseSignalInParsedQuery = (parsed: Awaited<ReturnType<typeof parseGalleryQuery>>): boolean => {
  if (!parsed) {
    return false;
  }

  const values = uniqueStrings([
    parsed.style,
    parsed.character,
    ...parsed.keywords,
    ...(parsed.intelligenceQuery?.visualStyle ?? []),
    ...(parsed.intelligenceQuery?.characterTypes ?? []),
    ...(parsed.intelligenceQuery?.genreTags ?? []),
    ...(parsed.intelligenceQuery?.visualIntent ?? []),
    ...(parsed.intelligenceQuery?.characterIntent ?? []),
  ]).map((value) => value.toLowerCase());

  const valueSet = toLowerSet(values);
  return (
    valueSet.has("cyberpunk") ||
    valueSet.has("mecha") ||
    valueSet.has("mecha girl") ||
    valueSet.has("mecha_girl") ||
    valueSet.has("robotic") ||
    valueSet.has("robot") ||
    valueSet.has("android") ||
    valueSet.has("mechanical") ||
    valueSet.has("sci-fi") ||
    valueSet.has("science fiction") ||
    valueSet.has("futuristic")
  );
};

const buildParserGapMatrix = async (): Promise<ParserGapRow[]> => {
  const rows: ParserGapRow[] = [];

  for (const query of PARSER_GAP_QUERIES) {
    const parsed = await parseGalleryQuery(query);
    const fallbackNormalization = normalizeGalleryKeywordsToEnglish([query]);
    const normalizedJoined = fallbackNormalization.join(" ").toLowerCase();

    rows.push({
      query,
      parsedKeywords: parsed?.keywords ?? [],
      parsedStyle: parsed?.style ?? "",
      parsedCharacter: parsed?.character ?? "",
      intelligenceQuery: parsed?.intelligenceQuery ?? null,
      sparseThemeSignalSurvivedParsing: hasSparseSignalInParsedQuery(parsed),
      fallbackNormalization,
      fallbackNormalizationDegraded:
        (query === "mecha" && fallbackNormalization.length === 1 && fallbackNormalization[0]?.toLowerCase() === "cha") ||
        (query === "robotic female" && !/robot|android|mechanical/.test(normalizedJoined)) ||
        (query === "sci-fi girl" && !/sci[- ]?fi|science fiction|futuristic|cyberpunk/.test(normalizedJoined)),
    });
  }

  return rows;
};

const main = async (): Promise<void> => {
  try {
    const cards = (await prisma.galleryCard.findMany({
      select: {
        id: true,
        title: true,
        style: true,
        character: true,
        tags: true,
        isActive: true,
        metadata: true,
      },
      orderBy: { createdAt: "desc" },
    })) as GalleryCardAuditRecord[];

    const metadataHealth = buildMetadataHealthSummary(cards);
    const samples = cards.map(buildSparseBundle);
    const activeSamples = samples.filter((sample) => sample.isActive);
    const activeSparseSamples = activeSamples.filter(hasAnySparseTheme);
    const pollutedActiveSamples = activeSparseSamples.filter((sample) => !hasExplicitSparseSurfaceCue(sample));
    const trueThemedSamples = samples.filter(isTrueThemedCard);
    const inactiveTrueThemedSamples = trueThemedSamples.filter((sample) => !sample.isActive);
    const parserGapMatrix = await buildParserGapMatrix();

    const report: AuditReport = {
      metadataHealth,
      activeCardCount: activeSamples.length,
      activeSparseThemeCounts: buildActiveSparseCounts(activeSparseSamples),
      pollutedActiveCount: pollutedActiveSamples.length,
      pollutedActiveSample: pollutedActiveSamples.slice(0, 12),
      trueThemedTotalCount: trueThemedSamples.length,
      trueThemedActiveCount: trueThemedSamples.filter((sample) => sample.isActive).length,
      trueThemedInactiveCount: inactiveTrueThemedSamples.length,
      inactiveTrueThemedSample: inactiveTrueThemedSamples.slice(0, 12),
      parserGapMatrix,
      needsMetadataRefresh: pollutedActiveSamples.length > 0,
      recommendedRefreshCommand: "npm run gallery:enrich-metadata -- --force",
      conclusions: {
        refreshRequired: pollutedActiveSamples.length > 0,
        parserFallbackRepairRecommended: parserGapMatrix.some((row) => row.fallbackNormalizationDegraded),
        recommendationV2RequiredNow: false,
      },
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error) => {
  console.error("[AUDIT SPARSE THEMES] failed", error);
  process.exit(1);
});
