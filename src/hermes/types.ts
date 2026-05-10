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

export type HermesContext = {
  requestId: string;
  traceId?: string;
  locale?: string;
  userId?: string;
  channelId?: string;
  intent?: IntentId;
  metadata?: Record<string, unknown>;
};

export type HermesInput = {
  text: string;
};

export type HermesOutput = {
  text: string;
  metadata?: Record<string, unknown>;
};

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
