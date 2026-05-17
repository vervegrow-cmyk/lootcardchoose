export type AgentId =
  | "lootcardchoose"
  | "customer-support"
  | "lootcarddiy"
  | "support"
  | "orders"
  | "affiliate";

export type SkillId =
  | "gallery.search"
  | "gallery.refresh"
  | "gallery.selectCard"
  | "gallery.createCheckoutLink"
  | "gallery.help"
  | "customerSupport.loadQa"
  | "customerSupport.answer";

export type ServiceId =
  | "gallery"
  | "order"
  | "shopify"
  | "r2"
  | "prisma"
  | "customerSupportQa"
  | "customerSupportLlm";

export type IntentId =
  | "gallery_search"
  | "gallery_select"
  | "gallery_refresh"
  | "order_status"
  | "customer_support"
  | "help"
  | "ignore";

export type SupportedLanguage = "zh" | "en";

export type RefreshMode = "next_batch" | "refine" | "broaden" | "random_fallback" | "need_clarification";

export type HermesContext = {
  requestId: string;
  traceId?: string;
  locale?: string;
  language: SupportedLanguage;
  discordGuildId: string | null;
  isDM: boolean;
  userId?: string;
  channelId?: string;
  intent?: IntentId;
  metadata?: Record<string, unknown>;
};

export type HermesInput = {
  text: string;
};

export type GallerySearchResultCard = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string;
  price: number;
  tags: string[];
  language?: SupportedLanguage;
  refreshMode?: RefreshMode;
  reason?: string;
};

export type HermesTextOutput = {
  type: "text";
  language: SupportedLanguage;
  text: string;
  metadata?: Record<string, unknown>;
};

export type HermesGallerySearchResultsOutput = {
  type: "gallery_search_results";
  language: SupportedLanguage;
  text: string;
  cards: GallerySearchResultCard[];
  selectionPrompt: string;
  refreshMode?: RefreshMode;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export type HermesGalleryCheckoutCreatedOutput = {
  type: "gallery_checkout_created";
  language: SupportedLanguage;
  text: string;
  title: string;
  price: string;
  productUrl: string;
  purchaseUrl: string;
  shareImageUrl: string;
  productHandle: string;
  orderNumber: string;
  orderStatus: string;
  metadata?: Record<string, unknown>;
};

export type HermesOutput =
  | HermesTextOutput
  | HermesGallerySearchResultsOutput
  | HermesGalleryCheckoutCreatedOutput;

export type RouterInput = {
  text: string;
  channelId: string;
  channelName?: string | null;
  userId: string;
  discordGuildId?: string | null;
  isDM?: boolean;
};

export type RoutingDecision = {
  agentId: AgentId;
  intent: IntentId;
};

export type AgentContext = HermesContext & {
  agentId: AgentId;
};

export type AgentHandler = (input: HermesInput, context: AgentContext) => Promise<HermesOutput>;

export type AgentDefinition = {
  id: AgentId;
  name: string;
  description?: string;
  handler: AgentHandler;
};

export type SkillContext = HermesContext & {
  skillId: SkillId;
};

export type SkillHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: SkillContext
) => Promise<TOutput>;

export type SkillDefinition<TInput = unknown, TOutput = unknown> = {
  id: SkillId;
  name: string;
  description?: string;
  handler: SkillHandler<TInput, TOutput>;
};

export type RegisteredSkill = SkillDefinition<unknown, unknown>;

export type ServiceContext = HermesContext & {
  serviceId: ServiceId;
};
