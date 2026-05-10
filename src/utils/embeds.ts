export type EmbedField = {
  name: string;
  value: string;
  inline?: boolean;
};

export type EmbedPayload = {
  title?: string;
  description?: string;
  fields?: EmbedField[];
};

export const buildGalleryResultsEmbed = (): EmbedPayload => {
  return { title: "Gallery Results", fields: [] };
};
