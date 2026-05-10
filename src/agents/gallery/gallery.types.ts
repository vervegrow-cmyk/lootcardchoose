export type GalleryQuery = {
  keywords: string[];
  limit?: number;
};

export type GallerySelection = {
  cardId: string;
  reason?: string;
};

export type GalleryAgentOutput = {
  summary: string;
  selectedCards: GallerySelection[];
};
