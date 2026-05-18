# LootCardChoose V1 Boundary Rules

## Hermes Layer Boundaries
### Discord Bot boundary
- Allowed: normalize Discord input, call router, render embeds, send fallback copy, notify on paid orders.
- Forbidden: ranking logic, query parsing logic, Shopify business logic, analytics computation.

### Router boundary
- Allowed: channel access check, language detection, intent classification, agent selection.
- Forbidden: repository search, recommendation scoring, refresh planning, checkout creation.

### Orchestrator boundary
- Allowed: invoke resolved agent.
- Forbidden: hidden workflow branching, retries that mutate business semantics, cross-agent policy logic.

### Agent boundary
- Allowed: compose skills according to intent.
- Forbidden: replace service-layer algorithms with inline copies.

### Skill boundary
- Allowed: transactional workflow steps and persistence coordination.
- Forbidden: re-owning long-term recommendation semantics, router semantics, or webhook semantics.

### Service boundary
- Allowed: domain logic, parser, rerank, narration, analytics, commerce integration.
- Forbidden: duplicating router policy or Discord rendering policy.

### Repository boundary
- Allowed: Prisma persistence and lexical / structured candidate retrieval.
- Forbidden: LLM parsing, recommendation narration, webhook notification, agent workflow branching.

## Recommendation Boundary
- V1 recommendation already means `parsed query + intelligenceQuery + metadata.intelligence + rerank + reasons`.
- Do not add a second recommendation engine beside `gallery-recommendation.service`.
- Do not split “search score” and “recommendation score” into competing truth sources without a formal migration.
- Do not retune weights just because an internal intuition feels better.
- Do not add embeddings, vectors, personalization, or learned weights without real-user evidence that V1 is insufficient.

## Recovery Boundary
- `usedFallback` already has semantic meaning: rerank did not safely improve ranking or the system deliberately preserved legacy order.
- `gallery_refresh` random fallback is recovery, not a new recommendation mode.
- Parser fallback, rerank fallback, and pool-exhausted refresh fallback must stay distinguishable.
- Do not rename recovery concepts casually or merge them into narration / analytics wording.

## Narration Boundary
- Curator narration is presentation, not ranking truth.
- Narration may reflect recommendation signals, but it must not become the scoring source.
- `curatorNarration`, `summaryText`, and commerce presentation should stay descriptive, not policy-bearing.
- Do not introduce a second narration stack with different semantics for the same card list.

## Analytics Boundary
- Analytics is observational, not a live ranking controller in V1.
- `recommendation-feedback.jsonl` and generated analytics reports are the current source of recommendation feedback truth.
- Commerce insight hints may shape presentation copy, but they must not silently rewrite ranking weights.
- Do not add analytics events that overlap existing `search / selection / checkout_created / purchase_completed` semantics without an explicit schema decision.

## Checkout Boundary
- Checkout flow already spans pending order creation, Shopify product creation, local order update, webhook paid confirmation, and Discord notification.
- Do not alter Shopify / checkout / order / webhook semantics during this audit stage.
- Product presentation optimization is subordinate to checkout correctness.

## Forbidden Modification List
- Router behavior changes
- Orchestrator changes
- Agent workflow redesign
- Shopify install / checkout / order / webhook flow redesign
- Recommendation scoring changes
- Search behavior changes
- Discord workflow redesign
- Prisma schema changes for speculative optimization
- New agent architecture for proactive expansion

## Allowed Modification List
- Docs
- Read-only audit scripts
- Build-safe npm script wiring for audit visibility
- Narrow bug fixes only if they are production blockers and separately approved

## Future Feature Gate Before Any New Work
Any future feature must pass all checks below before implementation:

1. Is there a real user or production validation problem, not just an architectural preference?
2. Does the issue already have coverage in existing feedback logs or analytics?
3. Can the issue be solved by docs, ops, or measurement instead of algorithm change?
4. Will the change duplicate an existing capability under a new name?
5. Will the change blur semantics between recommendation, analytics, narration, recovery, or checkout?
6. Will the change require a second source of truth for search, recommendation, or purchase state?
7. Can the change remain backward-compatible with current V1 logs and session flow?

If any answer is unclear, stop and audit before coding.
