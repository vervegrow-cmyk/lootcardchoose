# AI Discovery V1 Freeze / Validation Stage

## Stage Definition
LootCardChoose has completed the AI Discovery V1 core loop and is now in the `AI Discovery V1 Freeze / Validation Stage`.

This stage is not for new feature expansion. It is for stabilizing the current discovery system, validating real Discord usage, observing feedback analytics, and fixing only real problems that affect production behavior.

The default strategy for this stage is:

`stable production behavior -> real user validation -> data observation -> small fixes only`

## AI Discovery V1 Completed Capabilities
- `Metadata Intelligence`
- `Base Metadata Fill`
- `Content Cleaning`
- `Title Styling`
- `Query Understanding V2`
- `Recommendation Engine V1`
- `Recommendation Logging`
- `Recommendation Feedback Layer`
- `Feedback Analytics V1`

## V1 vs V2
- `V1 = AI enhanced discovery + rule-based rerank + feedback logging + analytics`
- `V2 = real user behavior begins to influence ranking weights / recommendation logic`

Current stage guidance:
- Do not treat Recommendation V2 as the default next step.
- Do not continue proactive architecture upgrades unless real production data clearly justifies them.

## Current Stage Goals
- Keep the current discovery and recommendation system stable.
- Validate real Discord search behavior.
- Observe `recommendation-feedback` analytics regularly.
- Fix only real production problems.
- Pause active architecture optimization unless a real issue forces a narrow correction.

## Timing Guidance
This stage should be treated as a near-term stability observation period, not a hard absolute freeze window.

Recommended operating principle:
- Default to observation and small corrective fixes.
- If real production issues appear, clear user data emerges, or project priorities change, the team may do a narrow fix or re-evaluate the freeze earlier.
- If other project work completes and time becomes available later, the team may also re-evaluate whether deeper optimization is worth doing.

## Frozen Scope
The following areas are intentionally frozen during this stage:
- `recommendation score tuning`
- `metadata cleaning / title polishing`
- `embedding / pgvector`
- `Recommendation V2`
- `new Agents`
- `Prisma schema changes`
- `GalleryAgent refactor`
- `search chain rewrite`

## Allowed Change Scope
Only real-problem-driven small fixes are allowed:
- Main business chain bugs
- `checkout / paid / webhook` issues
- Severe Router misclassification
- Recommendation returning unusable results
- Feedback JSONL write failures
- Analytics read failures
- Repeated real-user complaints that clearly indicate a production issue

All allowed fixes should follow these principles:
- Minimal change
- Backward-compatible behavior
- No opportunistic refactor
- No expansion into a new recommendation optimization cycle

## Validation Commands
- `npm run build`
- `npm run gallery:test-search`
- `npm run gallery:test-query-understanding`
- `npm run gallery:test-recommendation`
- `npm run gallery:test-recommendation-feedback`
- `npm run gallery:feedback:analyze`

## Real Discord Validation Checklist
- `hi / help` should not enter `gallery_search`
- `黑金SSR女角色` should return usable recommendation results
- `final boss dark queen` should trigger `intelligenceQuery` and rerank behavior
- `choose 3` should create checkout successfully
- `paid` should write recommendation feedback successfully
- analytics should show `search / selection / checkout / purchase`

## Observation Metrics
- `fallback rate`
- `search to selection rate`
- `selection to checkout rate`
- `checkout to purchase rate`
- `orphan purchase count`
- `sessions with rerank`
- `sessions with no ranking change`
- `top live queries`
- `top selected cards`
- `top purchased cards`

## Recommendation V2 Re-evaluation Triggers
Recommendation V2 should only be re-evaluated when real production data repeatedly shows one or more of the following:
- `recommendation repeatedly poor`
- `fallback rate high`
- `search to selection weak`
- `checkout to purchase weak`
- `users repeatedly choose cards inconsistent with rerank logic`
- `analytics shows rerank rarely helps`

Current default operating rule:
- Observe first
- Collect real data first
- Fix real production issues first
- Only then decide whether Recommendation V2 is actually necessary
