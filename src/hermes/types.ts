export type AgentId =
  | "lootcardchoose"
  | "lootcarddiy"
  | "support"
  | "orders"
  | "affiliate";

export type SkillId =
  | "gallery.search"
  | "gallery.selectCard"
  | "gallery.createCheckoutLink";

export type ServiceId =
  | "gallery"
  | "order"
  | "shopify"
  | "r2"
  | "prisma";

export type IntentId =
  | "gallery_search"
  | "gallery_select"
  | "order_status"
  | "help"
  | "ignore";

export type SupportedLanguage = "zh" | "en";

export type HermesContext = {
  requestId: string;
  traceId?: string;
  locale?: string;
  language: SupportedLanguage;
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
  metadata?: Record<string, unknown>;
};

export type HermesOutput = HermesTextOutput | HermesGallerySearchResultsOutput;

export type RouterInput = {
  text: string;
  channelId: string;
  userId: string;
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
