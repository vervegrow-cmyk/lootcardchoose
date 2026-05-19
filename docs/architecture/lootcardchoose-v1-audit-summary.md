# LootCardChoose V1 Audit Summary

## Document Purpose
This document is the single-summary output of the V1 Capability & Boundary Audit for LootCardChoose.

It does not propose a new architecture.
It does not change Router, Orchestrator, Agent workflow, Shopify workflow, recommendation scoring, search behavior, or Discord workflow.

Its purpose is to clearly state:
- what the current system already is
- what the current system already does
- what boundaries already exist in code
- what should not be re-optimized
- what semantic risks already exist
- what the team should do next

## Final Audit Conclusion
LootCardChoose is already beyond a simple Discord gallery search bot.

The current codebase is a real V1 end-to-end AI-enhanced discovery and commerce system with:
- Hermes layered routing
- query understanding
- metadata intelligence
- rerank recommendation
- curator narration
- Shopify checkout flow
- feedback logging
- recommendation analytics

So the correct conclusion of this audit is:

`The project is already in a V1 freeze / validation state, not in a blank-slate architecture-building state.`

The default next action should not be “continue optimizing”.
The default next action should be:

`stabilize -> validate with real users -> observe analytics -> fix only real problems`

## 2026-05-18 Incident Runbook
The `2026-05-18` runtime logs confirmed that the main funnel still worked, but they also exposed a narrow set of V1 follow-up risks that should be monitored continuously.

### Parser network failure
- Monitor `LLM QUERY PARSER` fallback events with `reason = network_error`.
- Expected V1-safe behavior:
  - parser failure still yields usable raw-query fallback keywords when the user query is meaningful
  - the gallery search log should show which keyword source was used
  - recommendation feedback should preserve parser outcome and search-result count for later analysis
- Escalate when:
  - `network_error` appears repeatedly in a short observation window
  - zero-result rate spikes specifically on parser-fallback searches

### Railway SIGTERM
- Treat isolated `npm error signal SIGTERM` events as an ops/deploy signal first, not an app-logic failure by default.
- Verify:
  - Railway deployment or restart activity at the same timestamp
  - platform healthcheck or shutdown behavior before blaming parser/search code
- Escalate when:
  - SIGTERM appears repeatedly without a matching deploy/restart explanation
  - reply failures or funnel interruption cluster immediately after restart signals

### Repeated legacy_wrong_channel access
- Monitor repeated `legacy_wrong_channel` denials grouped by guild and channel.
- Expected V1-safe behavior:
  - router policy remains unchanged
  - Discord logs should make redirect guidance countable
- Escalate when:
  - wrong-channel redirects cluster heavily in one guild or one channel
  - users repeatedly bounce between blocked channels and `#lootcardchoose`

### Duplicate checkout evidence
- Keep `search / selection / checkout_created / purchase_completed` as the only funnel truth.
- Analyze recommendation feedback for:
  - repeated `checkout_created` events for the same `orderNumber`
  - repeated `checkout_created` events for the same `sessionId`
  - session-link anomalies or orphan purchase patterns
- Escalate when:
  - duplicate checkout evidence appears repeatedly in production samples instead of isolated test noise

## What The Audit Confirmed
### 1. Current Product Identity
The system is currently a Discord-first collectible card discovery and purchase workflow.

It already supports:
- finding cards
- understanding user style / mood / archetype intent
- reordering results based on metadata intelligence
- presenting results through image-first embeds and narration
- selecting a card and creating a purchase flow
- logging recommendation outcomes
- generating analytics reports

This means the product identity is already coherent enough to be called:

`AI-enhanced gallery discovery + recommendation + checkout + analytics V1`

It should not be treated as a raw prototype search tool anymore.

### 2. Hermes Architecture Is Already Established
The live layering is already real and visible in code:

- Discord Bot handles message IO and rendering
- Router handles language, access control, and intent routing
- Orchestrator is intentionally thin
- Agent composes skills
- Skills coordinate workflow steps
- Services own domain logic and integrations
- Repositories own Prisma persistence and candidate retrieval

This means the architecture already has a usable boundary model.

The audit conclusion is not “design a better architecture”.
The audit conclusion is:

`respect the architecture that already exists and do not collapse responsibilities again`

### 3. Search Is Already Multi-Layered
The search system is not one-dimensional.

It already includes:
- lexical / exact-ish candidate retrieval
- structured field search
- parsed natural language search
- fallback search behavior
- refresh modes for next batch / refine / broaden / random fallback / clarification

So future work must stop describing search as if it is still only “keyword matching”.

The search stack already has multiple layers.
If later results are weak, the team must first determine which layer actually failed:
- parser layer
- candidate retrieval layer
- rerank layer
- refresh / recovery layer

Without that distinction, optimization will become repetitive and contradictory.

### 4. Card Intelligence Is Already V1-Complete
The audit confirmed that `metadata.intelligence` is not partial decoration.
It is already an actual V1 schema with stable usage.

It includes:
- visual layer
- emotional layer
- character layer
- worldbuilding layer
- commerce layer

These are already used by:
- recommendation rerank
- narration
- metadata coverage analytics
- commerce framing

So card intelligence is already a production semantic layer, not an experiment.

That means:
- it should not be casually renamed
- it should not be duplicated with a second intelligence model
- it should not be “reintroduced” under a different concept name

### 5. User Intent Intelligence Is Already V1-Complete
The parser layer already contains:
- LLM parsing
- rule-based fallback
- normalized keywords
- canonical token cleanup
- rarity / color / character / style / mood extraction
- deeper `intelligenceQuery` extraction

This is important because many future changes could mistakenly repeat work that is already done.

The audit conclusion is:

`User Intent Intelligence already exists in V1 and should be treated as completed infrastructure unless real production evidence proves a defect.`

### 6. Recommendation Is Already More Advanced Than Raw Search
Recommendation V1 already exists as a distinct layer on top of retrieval.

It already has:
- metadata similarity scoring
- weighted signal matching
- adaptive weight profiles
- rerank
- diversity penalty
- sparse-theme support
- recovery via `usedFallback`
- recommendation reasons
- commerce-oriented recommendation presentation

This means the project already crossed the line from “search tool” into “recommendation system”.

So later work must not:
- pretend recommendation does not already exist
- create a second recommendation system beside the current one
- retune recommendation weights just from internal opinion

### 7. Narration Is Already A Separate Capability
The audit confirmed that narration already exists as a real presentation layer:
- per-card curator narration
- embed lines
- batch summary narration
- commerce presentation copy

This matters because narration has a different job from recommendation and analytics.

Narration is for:
- presentation
- user feeling
- interpretive framing

Narration is not for:
- ranking truth
- recovery semantics
- analytics semantics

So the project must avoid mixing:
- narration reason
- recommendation reason
- analytics explanation

These are related, but they are not the same thing.

### 8. Commerce Flow Is Already End-to-End
The audit confirmed that commerce is not a stub.

The system already has:
- pending order creation
- selected card handoff
- pricing finalization
- Shopify product creation
- product URL
- cart / purchase URL
- local order update
- paid webhook verification
- order matching and dedupe
- Discord paid notification

So checkout is already a real system boundary.

That means future optimization must not casually touch this chain unless there is a real production issue.

### 9. Analytics And Feedback Already Exist
The project already has a live V1 observation layer:
- recommendation feedback JSONL
- search / selection / checkout_created / purchase_completed events
- analytics report generation
- parser telemetry
- rerank telemetry
- metadata coverage analytics
- weak-match analytics
- conversion analytics

This is one of the most important audit conclusions.

Because once analytics already exists, the correct next step is usually:

`observe before optimize`

not

`optimize first and measure later`

## What The Audit Says The System Is Not
The audit also clarified what the current project is not.

It is not:
- a blank architecture draft
- a single-pass search feature
- a pure LLM bot
- an embedding / vector recommendation system
- a personalization engine
- a multi-agent commerce platform
- a V2 adaptive learning recommender

This matters because many bad future decisions come from solving the wrong imagined problem.

If the team assumes the system is still early-stage and capability-poor, they will overbuild.
If the team assumes the system is already V2, they will overfit.

The accurate position is:

`feature-rich V1 with meaningful architecture, but still in validation rather than expansion`

## Main Semantic Risks Found By The Audit
The biggest risks are not missing modules.
The biggest risks are semantic duplication and boundary drift.

### Risk 1. Recovery Semantics Already Exist But Could Be Renamed Repeatedly
The code already heavily uses `usedFallback`.

This means recovery behavior is already real in the current system.
It is just distributed across parser fallback, rerank fallback, and refresh fallback.

The risk is that later work might add new overlapping labels like:
- recommendation recovery
- smart recovery
- fallback recommendation
- relevance repair

without preserving the existing semantics.

That would create confusion in:
- code
- logs
- analytics
- docs

### Risk 2. Recommendation And Search Could Be Discussed As If They Are The Same Layer
They are not the same layer anymore.

Current flow is already:
- parse
- retrieve
- rerank
- present

If the team keeps saying “search optimization” when the real change is “recommendation rerank tuning”, future work will become messy and contradictory.

### Risk 3. Narration And Recommendation Reasons Could Be Mixed Together
Curator narration already exists as an expressive presentation layer.

But if narration starts getting treated as:
- ranking logic
- evidence of match quality
- analytics explanation

then the product language becomes unstable.

Recommendation reason and narration line can align, but they are not interchangeable.

### Risk 4. Feedback Analytics Naming Is Split
The current codebase has strong `recommendation-feedback` and `recommendation-analytics` semantics, but not one canonical `feedbackAnalytics` code term.

That is not a runtime bug.
But it is a naming risk.

If future work adds a third naming style, the team will create:
- overlapping docs
- overlapping dashboards
- unclear ownership

### Risk 5. Architecture Re-optimization Would Be Mostly Repetition
The current Router / Orchestrator / Agent / Skill / Service / Repository separation is already sufficient for V1.

A new architecture pass right now would likely create:
- churn
- duplicated abstractions
- no user-facing gain

That is exactly the kind of over-optimization this audit was intended to prevent.

## What Should Not Be Re-optimized Now
Based on the audit, the following items should default to frozen:

- Router logic
- Orchestrator shape
- Agent workflow shape
- search chain rewrite
- recommendation scoring rewrite
- duplicate intelligence schema work
- duplicate narration system work
- Prisma schema expansion for speculative optimization
- embedding / vector search introduction
- personalization introduction
- new agent expansion
- Shopify flow redesign
- webhook redesign
- Discord reply workflow redesign

These are not all forbidden forever.
They are simply not justified by the current evidence.

## What Is Safe To Do In The Current Stage
The audit supports only narrow, evidence-driven work such as:
- documentation clarification
- audit tooling
- observability improvements if a real gap exists
- small bug fixes that affect real production behavior
- fixing broken analytics reads or writes
- fixing real checkout or webhook failures
- fixing severe misclassification that hurts actual user flow

The key rule is:

`small fix for proven problem`

not

`open another optimization cycle`

## What The Team Should Do Next
The audit recommendation is clear:

### Default direction
Pause proactive optimization.

### Primary next step
Use the current V1 system with real users and observe:
- search to selection
- selection to checkout
- checkout to paid
- parser fallback rate
- rerank usefulness
- weak-match families
- sparse metadata coverage

### Only re-open optimization when
- real users repeatedly fail to find valid cards
- rerank repeatedly harms or fails to help
- checkout funnel repeatedly breaks
- analytics cannot explain observed user failure
- a true observability gap is proven

## Final Interpretation
This audit does not say the system is perfect.

It says something more useful:

The system already has enough capability, enough architecture, and enough analytics to stop speculative expansion and start disciplined validation.

That is the main meaning of the audit result.

The most important takeaway is:

`LootCardChoose V1 does not need another round of broad architecture or recommendation invention right now. It needs semantic discipline, boundary discipline, and real-user validation discipline.`

## Related Audit Documents
- `docs/architecture/lootcardchoose-v1-capability-map.md`
- `docs/architecture/lootcardchoose-v1-boundary-rules.md`
- `docs/architecture/lootcardchoose-v1-optimization-gates.md`
- `docs/architecture/lootcardchoose-v1-phase-registry.md`

## Freeze Closeout And Metadata Phase 1
The current freeze-safe closeout keeps only these approved change classes:
- customer-support multi-turn context and prompt hardening
- gallery help anti-injection hardening and edge-case tests
- LLM intent classifier latency and outcome logging
- gallery service timing logs and analytics hints cache

The closeout explicitly excludes:
- inquiry telemetry expansion
- gallery session runtime drift
- any alternate `gallery_select` state machine
- any overlapping analytics truth source

### Canonical Intelligence Shape
`metadata.intelligence` is valid only when all checks below pass:
- `intelligenceVersion === "v1"`
- all 5 layers exist:
  - `visualLayer`
  - `emotionalLayer`
  - `characterLayer`
  - `worldbuildingLayer`
  - `commerceLayer`
- required canonical list fields are string arrays:
  - `visualLayer.visualStyle`
  - `visualLayer.colorPalette`
  - `visualLayer.artStyle`
  - `emotionalLayer.mood`
  - `emotionalLayer.atmosphere`
  - `characterLayer.characterType`
  - `characterLayer.roleArchetype`
  - `worldbuildingLayer.universe`
  - `worldbuildingLayer.theme`
  - `worldbuildingLayer.faction`
- `commerceLayer.pricingTier` is one of:
  - `budget`
  - `standard`
  - `premium`
  - `collector`
- `commerceLayer.collectorScore`, `waifuScore`, and `battleScore` are finite numbers

Legacy-compatible fields may remain, but they do not replace the canonical V1 shape above.

### Metadata Phase 1 Result
Phase 1 targeted the dominant repeated drift cluster rather than mixed one-off anomalies.

Batch 1 scope:
- 25 source files under `data/gallery-images/*.json`
- all from the same drift family:
  - missing canonical V1 arrays
  - missing valid `pricingTier`
  - missing valid score fields

Observed result after Batch 1:
- source-level invalid files dropped from `104` to `79`
- DB-level intelligence drift dropped from `104 / 221` to `79 / 221`

Read-only audit entrypoints:
- `npm run gallery:audit-intelligence`
- `npm run gallery:audit-intelligence:sources`

Remaining backlog after Batch 1:
- `79` cards still need the same canonical-shape repair pass
- this remains a metadata consistency issue, not a recommendation or router issue
