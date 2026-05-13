import { RefreshMode, SupportedLanguage } from "../../hermes/types";

export type GalleryQuery = {
  keywords: string[];
  limit?: number;
  language?: SupportedLanguage;
};

export type GallerySelection = {
  cardId: string;
  reason?: string;
};

export type GalleryAgentOutput = {
  summary: string;
  selectedCards: GallerySelection[];
  language?: SupportedLanguage;
  refreshMode?: RefreshMode;
  reason?: string;
};
