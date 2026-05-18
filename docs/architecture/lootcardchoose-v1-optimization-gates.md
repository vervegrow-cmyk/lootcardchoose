# LootCardChoose V1 Optimization Gates

## When Search Optimization Is Allowed
- Only when real Discord searches repeatedly fail despite valid inventory.
- Only when production evidence shows parser output or repository retrieval is blocking selection.
- Only when failures cannot be explained by bad metadata coverage, low inventory diversity, or wrong user wording.
- Not allowed for aesthetic cleanup, hypothetical precision gains, or proactive rewrites.

## When Recommendation Optimization Is Allowed
- Only when feedback analytics repeatedly show poor search-to-selection behavior on real traffic.
- Only when rerank rarely changes outcomes or changes them in the wrong direction.
- Only when weak-match analytics repeatedly expose the same archetype / theme failures.
- Not allowed when evidence is only from internal spot checks.

## When New Analytics Is Allowed
- Allowed when an existing user-facing decision cannot be validated with current events.
- Allowed when there is a proven blind spot between search, selection, checkout, and paid.
- Allowed when current reports cannot distinguish parser failure, rerank fallback, or orphan purchase causes.
- Not allowed just to create a larger dashboard footprint.

## When a New Agent Is Allowed
- Only when a workflow is truly separate in intent, state, and service ownership.
- Only when Router semantics can distinguish it cleanly.
- Only when the new workflow cannot remain a skill or service under the current agent structure.
- Not allowed for simple feature grouping or naming convenience.

## When Embedding / Vector Search Is Allowed
- Only when lexical + structured + intelligence rerank consistently miss valid cards that users expect.
- Only after real-user validation confirms metadata coverage is not the root problem.
- Only after current feedback analytics cannot explain low match quality.
- Not allowed as a prestige upgrade or default “next architecture step”.

## When Personalization Is Allowed
- Only after enough repeat-user data exists to justify user-specific ranking.
- Only after V1 baseline ranking is stable and measurable.
- Only after privacy, storage, and evaluation rules are defined.
- Not allowed while core V1 relevance is still under validation.

## When Optimization Must Stop And Validation Must Start
- When build passes, core tests pass, and the search -> selection -> checkout -> paid loop works.
- When parser, rerank, narration, and analytics already have observable telemetry.
- When further changes are mostly taste-driven rather than problem-driven.
- When multiple overlapping ideas would create semantic drift across recommendation, recovery, and analytics.

## Default V1 Gate Decision
Current default decision is:
- stop proactive optimization
- continue real-user validation
- permit only narrow fixes for proven production issues
