export type OrderRepository = {
  create: (input: {
    discordUserId: string;
    galleryCardId: string;
    amount: string;
  }) => Promise<{ id: string; orderNumber: string }>;
};
