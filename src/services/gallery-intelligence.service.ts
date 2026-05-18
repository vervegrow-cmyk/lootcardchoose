import type {
  GalleryCardIntelligenceMetadata,
  GalleryCommerceNaming,
  GalleryMetadataIntelligence,
  GalleryPricingTier,
} from "../types/gallery-intelligence.types";
import type { GalleryImageMetadata } from "../utils/gallery-metadata";

type BuildGalleryIntelligenceInput = {
  title?: string | null;
  description?: string | null;
  tags?: string[] | null;
  style?: string | null;
  rarity?: string | null;
  category?: string | null;
  character?: string | null;
  color?: string | null;
  metadata?: unknown;
};

type BuildGalleryIntelligenceCandidateInput = {
  imagePath: string;
  relativePath: string;
  metadata: GalleryImageMetadata;
};

type BuildGalleryIntelligenceOutput = {
  intelligence: GalleryMetadataIntelligence;
  commerceNaming: GalleryCommerceNaming;
};

type SignalRule<T extends string> = {
  value: T;
  patterns: RegExp[];
};

const VISUAL_STYLE_RULES: Array<SignalRule<
  | "black_gold"
  | "cyberpunk"
  | "dark_fantasy"
  | "holy"
  | "gothic"
  | "anime"
  | "mecha"
  | "fantasy"
>> = [
  { value: "black_gold", patterns: [/\bblack gold\b/i, /\bblack\b/i, /\bgold\b/i, /\bluxury\b/i] },
  { value: "cyberpunk", patterns: [/\bcyberpunk\b/i, /\bneon\b/i, /\btech noir\b/i, /\bfuturistic city\b/i, /\burban sci[-\s]?fi\b/i] },
  { value: "dark_fantasy", patterns: [/\bdark fantasy\b/i, /\bdark\b/i, /\bvoid\b/i, /\bshadow\b/i, /\beclipse\b/i] },
  { value: "holy", patterns: [/\bholy\b/i, /\bdivine\b/i, /\bangel\b/i, /\bsacred\b/i, /\bcelestial\b/i] },
  { value: "gothic", patterns: [/\bgothic\b/i, /\bcathedral\b/i, /\bornate\b/i] },
  { value: "anime", patterns: [/\banime\b/i, /\bani\b/i, /\billustration\b/i, /\bmanga\b/i] },
  { value: "mecha", patterns: [/\bmecha\b/i, /\bmech\b/i, /\brobot(ic)?\b/i, /\bandroid\b/i, /\bmechanical\b/i, /\bpowered suit\b/i] },
  { value: "fantasy", patterns: [/\bfantasy\b/i, /\bdragon\b/i, /\bmagic\b/i, /\brealm\b/i, /\bmythic\b/i] },
];

const MOOD_RULES: Array<SignalRule<
  "oppressive" | "elegant" | "mysterious" | "divine" | "boss_like" | "cute" | "fierce" | "calm"
>> = [
  { value: "oppressive", patterns: [/\boppressive\b/i, /\bominous\b/i, /\bvoid\b/i, /\bdoom\b/i] },
  { value: "elegant", patterns: [/\belegant\b/i, /\bluxury\b/i, /\brefined\b/i, /\bregal\b/i] },
  { value: "mysterious", patterns: [/\bmysterious\b/i, /\benigmatic\b/i, /\bshadow\b/i, /\beclipse\b/i] },
  { value: "divine", patterns: [/\bdivine\b/i, /\bholy\b/i, /\bgoddess\b/i, /\bcelestial\b/i] },
  { value: "boss_like", patterns: [/\bboss\b/i, /\bqueen\b/i, /\bempress\b/i, /\bcommander\b/i] },
  { value: "cute", patterns: [/\bcute\b/i, /\badorable\b/i, /\bplayful\b/i, /\bchibi\b/i] },
  { value: "fierce", patterns: [/\bfierce\b/i, /\bwarrior\b/i, /\bassassin\b/i, /\bcombat\b/i] },
  { value: "calm", patterns: [/\bcalm\b/i, /\bserene\b/i, /\bpeaceful\b/i, /\bsoft\b/i] },
];

const CHARACTER_TYPE_RULES: Array<SignalRule<
  "queen" | "priestess" | "goddess" | "warrior" | "assassin" | "dragon_lord" | "mecha_girl" | "anime_girl"
>> = [
  { value: "queen", patterns: [/\bqueen\b/i, /\bempress\b/i, /\bruler\b/i] },
  { value: "priestess", patterns: [/\bpriestess\b/i, /\bshrine maiden\b/i, /\bcleric\b/i] },
  { value: "goddess", patterns: [/\bgoddess\b/i, /\bdivine maiden\b/i, /\bdeity\b/i] },
  { value: "warrior", patterns: [/\bwarrior\b/i, /\bknight\b/i, /\bfighter\b/i, /\bguardian\b/i] },
  { value: "assassin", patterns: [/\bassassin\b/i, /\brogue\b/i, /\bshadowblade\b/i] },
  { value: "dragon_lord", patterns: [/\bdragon lord\b/i, /\bdragon\b/i, /\bdraconic\b/i] },
  { value: "mecha_girl", patterns: [/\bmecha girl\b/i, /\bandroid girl\b/i, /\brobot girl\b/i, /\bfemale android\b/i] },
  { value: "anime_girl", patterns: [/\banime girl\b/i, /\bfemale character\b/i, /\bgirl\b/i] },
];

const UNIVERSE_RULES: Array<SignalRule<"Cyber Cathedral" | "Void Empire" | "Eclipse Queen" | "Dragon Realm" | "Mecha City">> = [
  { value: "Cyber Cathedral", patterns: [/\bcyber cathedral\b/i, /\bholy tech\b/i, /\btech cathedral\b/i] },
  { value: "Void Empire", patterns: [/\bvoid\b/i, /\bempire\b/i, /\boppressive\b/i, /\bdark\b/i] },
  { value: "Eclipse Queen", patterns: [/\beclipse\b/i, /\bqueen\b/i, /\bmoon\b/i, /\bregal\b/i] },
  { value: "Dragon Realm", patterns: [/\bdragon\b/i, /\brealm\b/i, /\bmythic\b/i] },
  { value: "Mecha City", patterns: [/\bmecha city\b/i, /\bcyber city\b/i, /\bneon city\b/i, /\burban sci[-\s]?fi\b/i] },
];

const ROLE_ARCHETYPE_RULES: Array<SignalRule<string>> = [
  { value: "ruler", patterns: [/\bqueen\b/i, /\bempress\b/i, /\bruler\b/i] },
  { value: "mage", patterns: [/\bmage\b/i, /\bsorceress\b/i, /\bspell\b/i] },
  { value: "guardian", patterns: [/\bguardian\b/i, /\bprotector\b/i, /\bpaladin\b/i] },
  { value: "fighter", patterns: [/\bwarrior\b/i, /\bfighter\b/i, /\bassassin\b/i] },
  { value: "idol", patterns: [/\bidol\b/i, /\bstar\b/i, /\bperformer\b/i] },
  { value: "commander", patterns: [/\bcommander\b/i, /\bcaptain\b/i, /\bgeneral\b/i] },
];

const ATMOSPHERE_RULES: Array<SignalRule<string>> = [
  { value: "regal", patterns: [/\bqueen\b/i, /\bregal\b/i, /\broyal\b/i] },
  { value: "cathedral", patterns: [/\bcathedral\b/i, /\bgothic\b/i, /\bholy\b/i] },
  { value: "void", patterns: [/\bvoid\b/i, /\bshadow\b/i, /\beclipse\b/i] },
  { value: "urban", patterns: [/\burban\b/i, /\bcyberpunk\b/i, /\bneon\b/i] },
  { value: "battlefield", patterns: [/\bwarrior\b/i, /\bcombat\b/i, /\bbattle\b/i] },
  { value: "celestial", patterns: [/\bdivine\b/i, /\bholy\b/i, /\bcelestial\b/i] },
  { value: "romantic", patterns: [/\bromantic\b/i, /\belegant\b/i, /\bsensual\b/i] },
  { value: "mechanical", patterns: [/\bmecha\b/i, /\brobot(ic)?\b/i, /\bandroid\b/i, /\bmechanical\b/i] },
];

const THEME_RULES: Array<SignalRule<string>> = [
  { value: "luxury", patterns: [/\bluxury\b/i, /\bgold\b/i, /\bpremium\b/i] },
  { value: "divinity", patterns: [/\bdivine\b/i, /\bholy\b/i, /\bgoddess\b/i] },
  { value: "apocalypse", patterns: [/\bvoid\b/i, /\beclipse\b/i, /\boppressive\b/i] },
  { value: "romance", patterns: [/\bromantic\b/i, /\belegant\b/i, /\bcute\b/i] },
  { value: "power", patterns: [/\bboss\b/i, /\bqueen\b/i, /\bwarrior\b/i] },
  { value: "royalty", patterns: [/\bqueen\b/i, /\bempress\b/i, /\broyal\b/i] },
  { value: "technology", patterns: [/\bcyberpunk\b/i, /\bmecha\b/i, /\brobot(ic)?\b/i, /\bandroid\b/i, /\bsci[-\s]?fi\b/i, /\bscience fiction\b/i, /\bfuturistic\b/i] },
];

const FACTION_RULES: Array<SignalRule<string>> = [
  { value: "cathedral order", patterns: [/\bcathedral\b/i, /\bpriestess\b/i, /\bholy\b/i] },
  { value: "void legion", patterns: [/\bvoid\b/i, /\bdark\b/i, /\bempire\b/i] },
  { value: "dragon court", patterns: [/\bdragon\b/i, /\brealm\b/i] },
  { value: "mecha guard", patterns: [/\bmecha\b/i, /\brobot(ic)?\b/i, /\bandroid\b/i, /\bpowered suit\b/i] },
  { value: "queen's circle", patterns: [/\bqueen\b/i, /\bempress\b/i, /\bregal\b/i] },
];

const ART_STYLE_RULES: Array<SignalRule<string>> = [
  { value: "anime", patterns: [/\banime\b/i, /\bani\b/i] },
  { value: "illustration", patterns: [/\billustration\b/i] },
  { value: "portrait", patterns: [/\bportrait\b/i, /\bclose-up\b/i] },
  { value: "digital art", patterns: [/\bdigital art\b/i, /\bdigital\b/i] },
  { value: "fantasy art", patterns: [/\bfantasy\b/i, /\bdragon\b/i] },
  { value: "mecha art", patterns: [/\bmecha\b/i, /\brobot(ic)?\b/i, /\bandroid\b/i] },
  { value: "gothic art", patterns: [/\bgothic\b/i, /\bcathedral\b/i] },
];

const COLOR_RULES: Array<SignalRule<string>> = [
  { value: "black", patterns: [/\bblack\b/i] },
  { value: "gold", patterns: [/\bgold\b/i] },
  { value: "blue", patterns: [/\bblue\b/i, /\bazure\b/i] },
  { value: "red", patterns: [/\bred\b/i, /\bcrimson\b/i] },
  { value: "white", patterns: [/\bwhite\b/i, /\bivory\b/i] },
  { value: "purple", patterns: [/\bpurple\b/i, /\bviolet\b/i] },
  { value: "silver", patterns: [/\bsilver\b/i] },
  { value: "pink", patterns: [/\bpink\b/i] },
  { value: "green", patterns: [/\bgreen\b/i] },
];

const PRICING_TIER_BY_RARITY: Record<string, GalleryPricingTier> = {
  ur: "collector",
  ssr: "collector",
  sr: "premium",
  r: "standard",
  n: "budget",
};

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(Math.max(value, minimum), maximum);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const normalizeText = (value: string): string =>
  normalizeWhitespace(value.normalize("NFKD").replace(/[^\x00-\x7F]/g, " ").replace(/[^a-zA-Z0-9\s'/-]+/g, " "));

const uniqueStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = normalizeWhitespace(value);
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }

  return result;
};

const collectMetadataStrings = (value: unknown, depth = 0): string[] => {
  if (depth > 3 || value == null) {
    return [];
  }
  if (typeof value === "string") {
    return [value];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectMetadataStrings(item, depth + 1));
  }
  if (!isPlainObject(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => [key, ...collectMetadataStrings(nestedValue, depth + 1)]);
};

const buildSignalText = (input: BuildGalleryIntelligenceInput): string[] => {
  const metadataStrings = collectMetadataStrings(input.metadata);
  const rawValues = [
    input.title ?? "",
    input.description ?? "",
    ...(input.tags ?? []),
    input.style ?? "",
    input.rarity ?? "",
    input.category ?? "",
    input.character ?? "",
    input.color ?? "",
    ...metadataStrings,
  ];

  return uniqueStrings(rawValues.map(normalizeText).filter(Boolean));
};

const matchesAnyRule = (haystack: string, patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(haystack));

const collectSignals = <T extends string>(signalText: string, rules: Array<SignalRule<T>>): T[] =>
  uniqueStrings(
    rules.filter((rule) => matchesAnyRule(signalText, rule.patterns)).map((rule) => rule.value)
  ) as T[];

const removeSignal = <T extends string>(values: T[], value: T): T[] => values.filter((entry) => entry !== value);

const hasAnyMatch = (signalText: string, patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(signalText));

const hasStrongCyberpunkCue = (signalText: string): boolean =>
  hasAnyMatch(signalText, [/\bcyberpunk\b/i, /\bneon\b/i, /\btech noir\b/i]) ||
  (/\bfuturistic\b/i.test(signalText) && /\b(city|urban|megacity)\b/i.test(signalText)) ||
  (/\burban\b/i.test(signalText) && /\b(sci[-\s]?fi|science fiction)\b/i.test(signalText));

const hasStrongMechaCue = (signalText: string): boolean =>
  hasAnyMatch(signalText, [/\bmecha\b/i, /\bmech\b/i, /\brobot(ic)?\b/i, /\bandroid\b/i, /\bmechanical\b/i, /\bpowered suit\b/i]);

const hasStrongSciFiCue = (signalText: string): boolean =>
  hasStrongCyberpunkCue(signalText) || hasStrongMechaCue(signalText) || hasAnyMatch(signalText, [/\bsci[-\s]?fi\b/i, /\bscience fiction\b/i, /\bfuturistic\b/i]);

const hasFeminineCue = (signalText: string): boolean =>
  hasAnyMatch(signalText, [/\bgirl\b/i, /\bfemale\b/i, /\bwoman\b/i, /\bheroine\b/i, /\bmaiden\b/i]);

const parseNumericMetadataPrice = (metadata: unknown): number | null => {
  if (!isPlainObject(metadata)) {
    return null;
  }

  const raw = metadata.price;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const inferPricingTier = (rarity: string | null | undefined, metadata: unknown): GalleryPricingTier => {
  const normalizedRarity = normalizeWhitespace(rarity ?? "").toLowerCase();
  if (normalizedRarity && PRICING_TIER_BY_RARITY[normalizedRarity]) {
    return PRICING_TIER_BY_RARITY[normalizedRarity];
  }

  const metadataPrice = parseNumericMetadataPrice(metadata);
  if (metadataPrice != null) {
    if (metadataPrice >= 150) {
      return "collector";
    }
    if (metadataPrice >= 100) {
      return "premium";
    }
    if (metadataPrice >= 50) {
      return "standard";
    }
  }

  return "budget";
};

const tierBaseScore: Record<GalleryPricingTier, number> = {
  budget: 25,
  standard: 45,
  premium: 70,
  collector: 85,
};

const countMatches = (values: string[], matchers: RegExp[]): number =>
  values.reduce((sum, value) => sum + (matchers.some((matcher) => matcher.test(value)) ? 1 : 0), 0);

const computeCollectorScore = (input: {
  pricingTier: GalleryPricingTier;
  rarity: string | null | undefined;
  visualStyle: string[];
  universe: string[];
  theme: string[];
  signalValues: string[];
}): number => {
  let score = tierBaseScore[input.pricingTier];
  if (normalizeWhitespace(input.rarity ?? "").toLowerCase() === "ur") {
    score += 10;
  }
  score += input.visualStyle.includes("black_gold") ? 5 : 0;
  score += input.theme.includes("luxury") ? 5 : 0;
  score += input.universe.length > 0 ? 4 : 0;
  score += countMatches(input.signalValues, [/\bcollectible\b/i, /\blimited\b/i, /\bpremium\b/i]) * 2;
  return clamp(score, 0, 100);
};

const computeWaifuScore = (input: {
  pricingTier: GalleryPricingTier;
  characterType: string[];
  mood: string[];
  signalValues: string[];
}): number => {
  let score = input.pricingTier === "collector" ? 55 : input.pricingTier === "premium" ? 45 : 35;
  score += input.characterType.includes("anime_girl") ? 18 : 0;
  score += input.characterType.includes("goddess") ? 10 : 0;
  score += input.mood.includes("cute") ? 12 : 0;
  score += input.mood.includes("elegant") ? 8 : 0;
  score += countMatches(input.signalValues, [/\bgirl\b/i, /\bfemale\b/i, /\bbeauty\b/i, /\bcute\b/i]) * 3;
  return clamp(score, 0, 100);
};

const computeBattleScore = (input: {
  pricingTier: GalleryPricingTier;
  characterType: string[];
  mood: string[];
  signalValues: string[];
}): number => {
  let score = input.pricingTier === "collector" ? 60 : input.pricingTier === "premium" ? 52 : 40;
  score += input.characterType.includes("warrior") ? 18 : 0;
  score += input.characterType.includes("assassin") ? 14 : 0;
  score += input.characterType.includes("dragon_lord") ? 14 : 0;
  score += input.characterType.includes("mecha_girl") ? 12 : 0;
  score += input.mood.includes("fierce") ? 10 : 0;
  score += input.mood.includes("boss_like") ? 8 : 0;
  score += countMatches(input.signalValues, [/\bwarrior\b/i, /\bbattle\b/i, /\bcombat\b/i, /\bassassin\b/i]) * 3;
  return clamp(score, 0, 100);
};

const inferGenderPresentation = (signalText: string): string | undefined => {
  if (/\bfemale\b/i.test(signalText) || /\bgirl\b/i.test(signalText) || /\bwoman\b/i.test(signalText)) {
    return "female";
  }
  if (/\bmale\b/i.test(signalText) || /\bboy\b/i.test(signalText) || /\bman\b/i.test(signalText)) {
    return "male";
  }
  if (/\bandrogynous\b/i.test(signalText)) {
    return "androgynous";
  }
  return undefined;
};

const inferDefaultCharacterType = (signalText: string): "anime_girl" | "warrior" => {
  if (/\banime\b/i.test(signalText) || /\bgirl\b/i.test(signalText) || /\bfemale\b/i.test(signalText)) {
    return "anime_girl";
  }
  return "warrior";
};

const inferEnergyLevel = (mood: string[]): "low" | "medium" | "high" => {
  if (mood.includes("fierce") || mood.includes("boss_like")) {
    return "high";
  }
  if (mood.includes("calm")) {
    return "low";
  }
  return "medium";
};

const inferDramaticIntensity = (mood: string[]): number => {
  if (mood.includes("oppressive") || mood.includes("boss_like")) {
    return 0.85;
  }
  if (mood.includes("fierce") || mood.includes("divine")) {
    return 0.7;
  }
  if (mood.includes("cute") || mood.includes("calm")) {
    return 0.35;
  }
  return 0.5;
};

const buildLegacyKeywords = (input: {
  visualStyle: string[];
  mood: string[];
  characterType: string[];
  universe: string[];
  theme: string[];
  tags: string[];
}): string[] =>
  uniqueStrings([
    ...input.visualStyle,
    ...input.mood,
    ...input.characterType,
    ...input.universe,
    ...input.theme,
    ...input.tags.map((tag) => normalizeText(tag)).filter(Boolean),
  ]).slice(0, 12);

const buildConfidence = (input: {
  visualStyle: string[];
  mood: string[];
  characterType: string[];
  universe: string[];
}): number => {
  const matchedBuckets = [input.visualStyle, input.mood, input.characterType, input.universe].filter(
    (bucket) => bucket.length > 0
  ).length;
  return clamp(0.55 + matchedBuckets * 0.1, 0, 0.95);
};

const slugify = (value: string): string =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const buildCommerceNaming = (input: BuildGalleryIntelligenceInput): GalleryCommerceNaming => {
  const displayTitle = normalizeWhitespace(input.title ?? "") || "Gallery Card";
  const rarity = normalizeWhitespace(input.rarity ?? "");
  const shortName = displayTitle.split(/\s+/).slice(0, 4).join(" ");
  const shopifyTitle = rarity ? `${displayTitle} - ${rarity} Collectible Card` : `${displayTitle} - Collectible Card`;

  return {
    displayTitle,
    shopifyTitle,
    shortName,
    slug: slugify(shortName || displayTitle) || "gallery-card",
    namingVersion: "v1",
    confidence: 0.8,
    source: "vision-intelligence-v1",
  };
};

const buildMetadataIntelligence = (input: BuildGalleryIntelligenceInput): GalleryMetadataIntelligence => {
  const signalValues = buildSignalText(input);
  const signalText = signalValues.join(" ");

  let visualStyle = collectSignals(signalText, VISUAL_STYLE_RULES);
  const mood = collectSignals(signalText, MOOD_RULES);
  let characterType = collectSignals(signalText, CHARACTER_TYPE_RULES);
  let universe = collectSignals(signalText, UNIVERSE_RULES);
  let artStyle = collectSignals(signalText, ART_STYLE_RULES);
  let atmosphere = collectSignals(signalText, ATMOSPHERE_RULES);
  let theme = collectSignals(signalText, THEME_RULES);
  let faction = collectSignals(signalText, FACTION_RULES);
  const roleArchetype = collectSignals(signalText, ROLE_ARCHETYPE_RULES);
  const colorPalette = collectSignals(signalText, COLOR_RULES);

  const cyberpunkAllowed = hasStrongCyberpunkCue(signalText);
  const mechaAllowed = hasStrongMechaCue(signalText);
  const sciFiAllowed = hasStrongSciFiCue(signalText);
  const mechaGirlAllowed = mechaAllowed && hasFeminineCue(signalText);

  if (!cyberpunkAllowed) {
    visualStyle = removeSignal(visualStyle, "cyberpunk");
    universe = removeSignal(universe, "Cyber Cathedral");
    atmosphere = removeSignal(atmosphere, "urban");
  }

  if (!(cyberpunkAllowed || mechaAllowed)) {
    universe = removeSignal(universe, "Mecha City");
  }

  if (!mechaAllowed) {
    visualStyle = removeSignal(visualStyle, "mecha");
    characterType = removeSignal(characterType, "mecha_girl");
    atmosphere = removeSignal(atmosphere, "mechanical");
    faction = removeSignal(faction, "mecha guard");
    artStyle = removeSignal(artStyle, "mecha art");
  }

  if (!mechaGirlAllowed) {
    characterType = removeSignal(characterType, "mecha_girl");
  }

  if (!sciFiAllowed) {
    theme = removeSignal(theme, "technology");
  }

  const resolvedVisualStyle = visualStyle.length > 0 ? visualStyle : ["fantasy"];
  const resolvedMood = mood.length > 0 ? mood : ["mysterious"];
  const resolvedCharacterType = characterType.length > 0 ? characterType : [inferDefaultCharacterType(signalText)];
  const resolvedUniverse = universe.length > 0 ? universe : ["Eclipse Queen"];
  const resolvedPricingTier = inferPricingTier(input.rarity, input.metadata);

  const collectorScore = computeCollectorScore({
    pricingTier: resolvedPricingTier,
    rarity: input.rarity,
    visualStyle: resolvedVisualStyle,
    universe: resolvedUniverse,
    theme,
    signalValues,
  });
  const waifuScore = computeWaifuScore({
    pricingTier: resolvedPricingTier,
    characterType: resolvedCharacterType,
    mood: resolvedMood,
    signalValues,
  });
  const battleScore = computeBattleScore({
    pricingTier: resolvedPricingTier,
    characterType: resolvedCharacterType,
    mood: resolvedMood,
    signalValues,
  });

  const legacySearchKeywords = buildLegacyKeywords({
    visualStyle: resolvedVisualStyle,
    mood: resolvedMood,
    characterType: resolvedCharacterType,
    universe: resolvedUniverse,
    theme,
    tags: input.tags ?? [],
  });
  const confidence = buildConfidence({
    visualStyle: resolvedVisualStyle,
    mood: resolvedMood,
    characterType: resolvedCharacterType,
    universe: resolvedUniverse,
  });

  return {
    intelligenceVersion: "v1",
    confidence,
    visualLayer: {
      visualStyle: resolvedVisualStyle,
      colorPalette,
      artStyle,
      primaryColors: colorPalette,
      styleTags: uniqueStrings([...resolvedVisualStyle, ...artStyle]),
      compositionTags: [],
      subjectFocus: resolvedCharacterType[0] ?? "",
      raritySignals: uniqueStrings([normalizeWhitespace(input.rarity ?? ""), resolvedPricingTier].filter(Boolean)),
    },
    emotionalLayer: {
      mood: resolvedMood,
      atmosphere,
      moodTags: resolvedMood,
      toneTags: atmosphere,
      energyLevel: inferEnergyLevel(resolvedMood),
      dramaticIntensity: inferDramaticIntensity(resolvedMood),
    },
    characterLayer: {
      characterType: resolvedCharacterType,
      ...(inferGenderPresentation(signalText) ? { genderPresentation: inferGenderPresentation(signalText) } : {}),
      roleArchetype,
      entityType: resolvedCharacterType[0] ?? "",
      agePresentation: "",
      archetypeTags: roleArchetype,
      poseTags: [],
    },
    worldbuildingLayer: {
      universe: resolvedUniverse,
      theme,
      faction,
      settingTags: resolvedUniverse,
      genreTags: theme,
      factionTags: faction,
      propTags: [],
      powerSystemTags: [],
    },
    commerceLayer: {
      ...(normalizeWhitespace(input.rarity ?? "") ? { rarity: normalizeWhitespace(input.rarity ?? "") } : {}),
      pricingTier: resolvedPricingTier,
      collectorScore,
      waifuScore,
      battleScore,
      searchKeywords: legacySearchKeywords,
      collectorHooks: uniqueStrings([resolvedPricingTier, normalizeWhitespace(input.rarity ?? "")].filter(Boolean)),
      marketingAngles: theme,
      audienceTags: uniqueStrings(resolvedCharacterType.map((value) => value.replace(/_/g, " "))),
      safetyFlags: [],
      category: normalizeWhitespace(input.category ?? "") || undefined,
    },
    audit: {
      needsHumanReview: false,
      missingFields: [],
      lowConfidenceFields: [],
      invalidTags: [],
      formatIssues: [],
      notes: [],
    },
  };
};

export const galleryIntelligenceService = {
  build(input: BuildGalleryIntelligenceInput): GalleryCardIntelligenceMetadata {
    return buildMetadataIntelligence(input);
  },

  buildMetadata(input: BuildGalleryIntelligenceInput): GalleryMetadataIntelligence {
    return buildMetadataIntelligence(input);
  },

  async buildCandidates(input: BuildGalleryIntelligenceCandidateInput): Promise<BuildGalleryIntelligenceOutput> {
    const intelligence = buildMetadataIntelligence({
      title: input.metadata.title ?? "",
      description: input.metadata.description ?? null,
      tags: input.metadata.tags ?? [],
      style: input.metadata.style ?? null,
      rarity: input.metadata.rarity ?? null,
      category: input.metadata.category ?? null,
      character: input.metadata.character ?? null,
      color: input.metadata.color ?? null,
      metadata: input.metadata.metadata ?? null,
    });

    return {
      intelligence,
      commerceNaming: buildCommerceNaming({
        title: input.metadata.title ?? input.relativePath,
        rarity: input.metadata.rarity ?? null,
      }),
    };
  },

  isMetadataObject(value: unknown): value is Record<string, unknown> {
    return isPlainObject(value);
  },
};
