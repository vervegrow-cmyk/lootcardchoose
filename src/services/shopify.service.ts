export type ShopifyCreateProductInput = {
  title: string;
  description: string | null;
  imageUrl: string;
  price: string;
  tags: string[];
};

export type ShopifyCreateProductOutput = {
  checkoutUrl: string;
};

export const shopifyService = {
  async createCheckoutLink(input: ShopifyCreateProductInput): Promise<ShopifyCreateProductOutput> {
    void input;
    return { checkoutUrl: "https://example.com/checkout" };
  },
};
