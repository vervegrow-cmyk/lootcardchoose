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
  fields?: EmbedField[];
};

const buildCardDescription = (language: SupportedLanguage, card: GallerySearchResultCard): string => {
  const lines = [
    card.description ?? t(language, "gallery.description.empty"),
    t(language, "gallery.search.resultPrice", { price: card.price.toFixed(2) }),
  ];

  if (card.tags.length > 0) {
    lines.push(t(language, "gallery.search.resultTags", { tags: card.tags.join(" / ") }));
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
    imageUrl: card.imageUrl,
    fields: [],
  }));
};
