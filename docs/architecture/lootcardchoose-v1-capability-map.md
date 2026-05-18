# LootCardChoose V1 Capability Map

## Current Product Positioning
LootCardChoose V1 is a Discord-first gallery discovery and checkout system for collectible cards.

It is not only a keyword search bot. The live codebase already combines:
- Hermes routing and agent orchestration
- Gallery search with structured query parsing
- Metadata intelligence based recommendation rerank
- Curator narration and image-first presentation
- Shopify checkout creation
- Feedback logging and recommendation analytics

The current production posture is a V1 freeze / validation stage, not a greenfield architecture stage.

## Current System Capability Overview
### Hermes architecture
- Discord Bot receives guild and DM messages, normalizes mentions, sends typing indicators, and renders search / checkout replies.
- Router resolves channel access, detects language, classifies intent with rule-first logic plus LLM fallback, and routes to `lootcardchoose` or `customer-support`.
- Orchestrator is intentionally thin and only invokes the resolved agent.
- Registry registers live agents and reusable skills.
- GalleryAgent handles `gallery_search`, `gallery_refresh`, `gallery_select`, `help`, and `order_status`.

### Gallery search
- Exact / lexical keyword search exists through repository keyword matching across title, description, tags, style, rarity, category, character, color.
- Structured search exists through parsed fields like `style`, `rarity`, `character`, `color`, `mood`, and `scene`.
- Parsed query search exists through `LLMQueryParser` plus rule-based fallback, with mirrored `intelligenceQuery` signals.
- Fallback search exists when structured keywords are empty, rerank has no meaningful signals, refresh pool is exhausted, or planner times out.
- Refresh flow exists with `next_batch`, `refine`, `broaden`, `random_fallback`, and `need_clarification`.

### Card intelligence
- `metadata.intelligence` is a first-class input to recommendation and analytics.
- Visual layer exists: `visualStyle`, `colorPalette`, `artStyle`, `primaryColors`, `styleTags`, `subjectFocus`, `raritySignals`.
- Emotional layer exists: `mood`, `atmosphere`, `moodTags`, `toneTags`, `energyLevel`, `dramaticIntensity`.
- Character layer exists: `characterType`, `genderPresentation`, `roleArchetype`, `entityType`, `archetypeTags`.
- Worldbuilding layer exists: `universe`, `theme`, `faction`, `settingTags`, `genreTags`, `factionTags`.
- Commerce layer exists: `pricingTier`, `collectorScore`, `waifuScore`, `battleScore`, `searchKeywords`, `collectorHooks`, `marketingAngles`, `audienceTags`.

### User intent intelligence
- `LLMQueryParser` exists with timeout, non-200, parse-failure, network, disabled, and missing-key fallback paths.
- `intelligenceQuery` already exists and is not speculative.
- Keyword cleaning exists: quantifier stripping, blacklist filtering, canonical English normalization, zh/en normalization, rarity normalization.
- Extraction exists for theme / style / mood / character / color / rarity plus deeper fields like archetype, setting, genre, commerce intent, safety intent.

### Recommendation
- Metadata similarity scoring exists and uses weighted visual, mood, character, archetype, setting, genre, and commerce match.
- Rerank exists and is observable through debug snapshots and feedback logs.
- Sparse theme handling exists in repository expansion and analytics-driven commerce hinting.
- Recommendation recovery exists through `usedFallback`, rerank disablement, legacy order preservation, and refresh random fallback.
- Exact-zero / weak-signal recovery behavior exists: if no meaningful signals or no ranking movement, the system returns original ranking with `usedFallback: true`.
- Recommendation reasons exist through `recommendationScore.reasons`, commerce presentation reasons, and curator narration.

### Presentation
- Unified large image feed exists via Discord embeds and `buildGalleryLargeImageFeedEmbeds`.
- Server / DM behavior differs at router level and channel access level.
- Embed narration exists in `curatorNarration.embedLines`.
- Curator narration exists both per-card and batch summary.
- Recovery copy exists for search empty, refresh clarification, pool exhausted, invalid selection, and checkout failure.
- `imageUrl` / `setImage` behavior is already standardized for search cards and checkout share image.

### Commerce
- Session exists via `GallerySearchSession`.
- Select exists via active-session based indexed selection.
- Shopify product creation exists and uses derived product naming, product code, handle, SKU, product page, and cart URL.
- Checkout link exists and persists back to local order state.
- Order creation exists before checkout generation.
- Paid webhook notification exists with HMAC validation, dedupe, multi-strategy order resolution, order paid update, and Discord notification.

### Analytics / feedback
- Existing feedback logs exist in `reports/recommendation-feedback.jsonl`.
- Recommendation analytics exists from JSONL to generated report plus Prisma daily snapshot persistence.
- Selection / checkout / purchase tracking exists through `search`, `selection`, `checkout_created`, and `purchase_completed` events.
- Debug flags / telemetry exist for parser outcome, timeout, parser fallback reason, rerank happened, and candidate count.
- Recovery metadata exists through `usedFallback`, parser fallback reason, refresh mode, pool exhausted, and weak-match analytics.
- Narration metadata exists in recommendation debug summaries and card-level narration fields.

### Infrastructure
- R2 sync exists through `sync-gallery-r2.ts` and `r2.service.ts`.
- R2 consistency checks exist through upload, expected public URL checks, and placeholder cleanup scripts.
- Railway support exists through `railway.json`, env config, and ops insight scripts.
- Prisma is the persistence layer for gallery cards, sessions, orders, webhook events, guild config, and analytics snapshots.
- Env requirements already include Discord, DB, DeepSeek, Shopify, R2, SiliconFlow, and Railway log variables.
- Scripts already cover search tests, recommendation tests, feedback tests, analytics generation, metadata audit, R2 sync, and webhook retry.

## Module Responsibilities
### Discord Bot
- Owns Discord IO only.
- Should render responses, not invent new business logic.
- Should not own recommendation logic or checkout resolution.

### Router
- Owns intent and agent routing only.
- Should not execute search, rerank, checkout, or analytics logic.

### Orchestrator
- Owns agent invocation only.
- Should remain thin; no hidden workflow state machine belongs here in V1.

### GalleryAgent
- Owns gallery workflow composition across search, refresh, select, help, and checkout transition.
- Should not duplicate repository search logic or rerank scoring internals.

### Skills
- Own discrete reusable workflow steps.
- `gallery.search`: search + session persistence handoff.
- `gallery.refresh`: refresh planning context + new active session.
- `gallery.selectCard`: active session selection + pending order creation.
- `gallery.createCheckoutLink`: pricing + Shopify product creation + local order update.

### Services
- Own domain logic and external integrations.
- `gallery.service`: parsed search, recommendation rerank, refresh planning, debug snapshot, narration.
- `gallery-recommendation.service`: metadata similarity scoring, reasons, commerce presentation, curator narration.
- `llm-query-parser.service`: natural language parsing and rule fallback.
- `recommendation-feedback.service`: event logging and linkage.
- `recommendation-analytics.service`: report generation and commerce insights.
- `shopify.service` / `shopify-webhook.service` / `order.service`: commerce chain.
- `gallery-intelligence.service`: V1 card intelligence schema builder.

### Repositories
- Own Prisma reads / writes and query ranking candidates.
- Must remain persistence-focused and not absorb agent orchestration.

## Module Capabilities Already Present
### Already completed in code
- Rule-first Router with LLM fallback
- Customer support agent alongside GalleryAgent
- Search session persistence and refresh chaining
- `metadata.intelligence` powered rerank
- Sparse-theme repository expansion
- Curator embed narration
- Shopify commerce naming and analytics-informed presentation
- Feedback JSONL logging
- Recommendation analytics reports and Prisma snapshots
- Webhook dedupe and retry flow

## What Each Module Must Not Do
### Discord Bot must not
- Re-score cards
- Rewrite narration
- Decide recommendation recovery

### Router must not
- Change search ranking
- Trigger direct DB writes beyond access checks indirectly
- Become a second orchestrator

### Orchestrator must not
- Grow business branching that duplicates agent logic

### GalleryAgent must not
- Re-implement parser / repository / webhook logic
- Add hidden alternate recommendation pipelines

### Services must not
- Cross-collapse semantics between search, recommendation, narration, analytics, and checkout
- Rebrand logging fields with overlapping names unless migration is intentional

### Repositories must not
- Embed narration or recommendation policy
- Add side effects outside persistence scope

## Completed Phase Registry
- Phase 01 Card Intelligence: completed
- Phase 02 User Intent Intelligence: completed
- Phase 03 Metadata Similarity Recommendation: completed
- Phase 04 Feedback / Analytics: partially completed but already live enough to freeze
- Phase 07 Recommendation Recovery: completed
- Phase 08 Curator Narration: completed
- Phase 09: default paused

## Items That Should Not Be Re-optimized Now
- Query parser field extraction
- Legacy searchable field mirroring from `intelligenceQuery`
- Metadata similarity rerank weights
- Sparse theme repository expansion
- Curator narration generation
- Commerce-facing product title / collector framing generation
- Feedback event schema for search / selection / checkout / purchase
- Analytics report dimensions already wired to `metadata.intelligence`
- Router / Orchestrator layering
- Search chain architecture rewrite

## Current Recommendation
Default posture should remain: pause proactive optimization and continue real-user validation, unless audit evidence shows a production bug, severe semantic conflict, or missing observability that blocks user verification.
