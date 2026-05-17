import { GallerySearchResultCard, SupportedLanguage } from "../hermes/types";
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
};

const buildCardDescription = (language: SupportedLanguage, card: GallerySearchResultCard): string => {
  const commerceLines = card.tags
    .filter((tag) => tag.startsWith("commerce:"))
    .map((tag) => tag.slice("commerce:".length).trim())
    .filter(Boolean);
  const visibleTags = card.tags.filter((tag) => !tag.startsWith("commerce:"));
  const lines = [
    card.description ?? t(language, "gallery.description.empty"),
  ];

  if (commerceLines.length > 0) {
    lines.push(...commerceLines.slice(0, 3));
  }

  lines.push(t(language, "gallery.search.resultPrice", { price: card.price.toFixed(2) }));

  if (visibleTags.length > 0) {
    lines.push(t(language, "gallery.search.resultTags", { tags: visibleTags.join(" / ") }));
  }

  return lines.join("\n");
};

export const buildGalleryResultsEmbeds = (
  language: SupportedLanguage,
  results: GallerySearchResultCard[]
): EmbedPayload[] => {
  return results.slice(0, 10).map((card, index) => ({
    title: t(language, "gallery.search.resultTitle", {
      index: index + 1,
      title: card.title,
    }),
    description: buildCardDescription(language, card),
    imageUrl: index === 0 ? card.imageUrl : undefined,
    thumbnailUrl: index === 0 ? undefined : card.imageUrl,
    fields: [],
  }));
};
