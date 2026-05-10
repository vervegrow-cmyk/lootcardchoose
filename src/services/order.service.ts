export type OrderService = {
  createCheckoutLink: (cardId: string, quantity?: number) => Promise<string>;
};
