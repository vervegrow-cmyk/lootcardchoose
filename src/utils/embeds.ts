import { GallerySearchResultCard, SupportedLanguage } from "../hermes/types";
import { canonicalizeGalleryTerm } from "./gallery-language";
import { t } from "./i18n";

export type EmbedField = {
  name: string;
  value: string;
  inline?: boolean;
};

export type EmbedPayload = {
  title?: string;
  description?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  fields?: EmbedField[];
  footerText?: string;
};

const ENGLISH_STYLE_TAGS = new Set([
  "cyberpunk",
  "anime",
  "gothic",
  "fantasy",
  "dark fantasy",
  "divine",
  "mecha",
]);

const ENGLISH_DETAIL_TAGS = new Set([
  "neon",
  "sci-fi",
  "digital art",
  "action",
  "black",
  "gold",
  "dark",
  "red",
  "blue",
  "purple",
]);

const FEATURE_TAG_PHRASES: Record<string, string> = {
  female: "a female character",
  "female character": "a female character",
  girl: "a female character",
  angel: "an angel",
  queen: "a queen",
  dragon: "a dragon",
  mecha: "a mecha character",
  samurai: "a samurai character",
  warrior: "a warrior character",
};

const DISPLAY_TAG_ALIASES: Record<string, string> = {
  "female character": "female",
  "male character": "male",
  "anime girl": "anime",
};

const containsCjk = (value: string): boolean => /[\u4e00-\u9fff]/.test(value);

const isAsciiLike = (value: string): boolean => /^[\x20-\x7E]+$/.test(value);

const isEnglishLikeDescription = (description: string | null | undefined): boolean => {
  if (!description) {
    return false;
  }

  const trimmed = description.trim();
  if (!trimmed || containsCjk(trimmed)) {
    return false;
  }

  return /[a-z]/i.test(trimmed);
};

const dedupeCaseInsensitive = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    const normalized = trimmed.toLowerCase();
    if (!trimmed || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(trimmed);
  }

  return result;
};

const localizeEnglishDisplayTag = (tag: string): string | null => {
  const trimmed = tag.trim();
  if (!trimmed) {
    return null;
  }

  const canonical = canonicalizeGalleryTerm(trimmed).trim();
  const preferred = containsCjk(trimmed) ? canonical : trimmed;
  const englishSafe = isAsciiLike(preferred) ? preferred : isAsciiLike(canonical) ? canonical : "";
  if (!englishSafe) {
    return null;
  }

  const aliased = DISPLAY_TAG_ALIASES[englishSafe.toLowerCase()] ?? englishSafe;
  return aliased.trim() || null;
};

const buildVisibleTags = (language: SupportedLanguage, tags: string[]): string[] => {
  const visibleTags = tags.filter((tag) => !tag.startsWith("commerce:"));

  if (language !== "en") {
    return visibleTags;
  }

  const englishPreferred = dedupeCaseInsensitive(
    visibleTags
      .map(localizeEnglishDisplayTag)
      .filter((value): value is string => Boolean(value))
  );

  if (englishPreferred.length > 0) {
    return englishPreferred;
  }

  return dedupeCaseInsensitive(visibleTags.filter((tag) => isAsciiLike(tag)));
};

const buildEnglishFallbackSummary = (card: GallerySearchResultCard, englishTags: string[]): string => {
  const normalizedTags = englishTags.map((tag) => tag.toLowerCase());
  const styleTerms = englishTags.filter((tag) => ENGLISH_STYLE_TAGS.has(tag.toLowerCase())).slice(0, 2);
  const feature =
    normalizedTags.map((tag) => FEATURE_TAG_PHRASES[tag]).find((phrase): phrase is string => Boolean(phrase)) ?? null;
  const detailTerms = englishTags
    .filter((tag) => ENGLISH_DETAIL_TAGS.has(tag.toLowerCase()))
    .filter((tag) => !styleTerms.some((styleTag) => styleTag.toLowerCase() === tag.toLowerCase()))
    .slice(0, 2);

  const stylePrefix = styleTerms.length > 0 ? `${styleTerms.join(" ")} ` : "";
  const subjectClause = feature ? ` featuring ${feature}` : card.title.trim() ? ` inspired by ${card.title.trim()}` : "";
  const detailClause = detailTerms.length > 0 ? ` with ${detailTerms.join(" ")} styling` : "";

  return `A ${stylePrefix}collectible card${subjectClause}${detailClause}.`;
};

const buildCardDescription = (language: SupportedLanguage, card: GallerySearchResultCard): string => {
  const commerceLines = card.tags
    .filter((tag) => tag.startsWith("commerce:"))
    .map((tag) => tag.slice("commerce:".length).trim())
    .filter(Boolean);
  const curatorLines = Array.isArray(card.curatorNarration?.embedLines)
    ? card.curatorNarration.embedLines.map((line) => line.trim()).filter(Boolean).slice(0, 2)
    : [];
  const visibleTags = buildVisibleTags(language, card.tags);
  const baseDescription =
    language === "en"
      ? isEnglishLikeDescription(card.description)
        ? card.description?.trim() ?? t(language, "gallery.description.empty")
        : visibleTags.length > 0
          ? buildEnglishFallbackSummary(card, visibleTags)
          : t(language, "gallery.description.empty")
      : card.description ?? t(language, "gallery.description.empty");
  const lines = [baseDescription];

  if (curatorLines.length > 0) {
    lines.push(...curatorLines);
  }

  if (commerceLines.length > 0) {
    lines.push(...commerceLines.slice(0, 3));
  }

  lines.push(t(language, "gallery.search.resultPrice", { price: card.price.toFixed(2) }));

  if (visibleTags.length > 0) {
    lines.push(t(language, "gallery.search.resultTags", { tags: visibleTags.join(" / ") }));
  }

  return lines.join("\n");
};

const normalizeHttpImageUrl = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("http://") && !trimmed.startsWith("https://"))) {
    return null;
  }

  return trimmed;
};

export const resolveGalleryCardImageUrl = (card: GallerySearchResultCard): string | null => {
  const extendedCard = card as GallerySearchResultCard & {
    shareImageUrl?: unknown;
    metadata?: {
      imageUrl?: unknown;
      r2Url?: unknown;
      publicUrl?: unknown;
      originalImageUrl?: unknown;
    } | null;
  };

  const candidates = [
    card.imageUrl,
    extendedCard.shareImageUrl,
    extendedCard.metadata?.imageUrl,
    extendedCard.metadata?.r2Url,
    extendedCard.metadata?.publicUrl,
    extendedCard.metadata?.originalImageUrl,
  ];

  for (const candidate of candidates) {
    const normalizedUrl = normalizeHttpImageUrl(candidate);
    if (normalizedUrl) {
      return normalizedUrl;
    }
  }

  return null;
};

export const buildGalleryLargeImageFeedEmbeds = (
  language: SupportedLanguage,
  results: GallerySearchResultCard[]
): EmbedPayload[] => {
  return results.slice(0, 10).map((card, index) => {
    const imageUrl = resolveGalleryCardImageUrl(card);

    return {
      title: t(language, "gallery.search.resultTitle", {
        index: index + 1,
        title: card.title,
      }),
      description: buildCardDescription(language, card),
      imageUrl: imageUrl ?? undefined,
      thumbnailUrl: undefined,
      fields: [],
      footerText: imageUrl ? undefined : "Image unavailable",
    };
  });
};

export const buildGalleryResultsEmbeds = buildGalleryLargeImageFeedEmbeds;
