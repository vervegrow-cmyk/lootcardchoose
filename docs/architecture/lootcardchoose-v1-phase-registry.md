# LootCardChoose V1 Phase Registry

## Phase 01 Card Intelligence
### Completed content
- `gallery-intelligence.service` builds V1 `metadata.intelligence`.
- Visual / emotional / character / worldbuilding / commerce layers already exist.
- Confidence, audit fields, pricing tier, collector / waifu / battle scores already exist.
- Commerce naming support already exists as a related metadata output.

### Boundary
- This phase is metadata enrichment, not live recommendation tuning.

### Do not repeat
- Do not rebuild a parallel intelligence schema.
- Do not rename existing layer semantics casually.

## Phase 02 User Intent Intelligence
### Completed content
- `llm-query-parser.service` already parses natural language into legacy fields plus `intelligenceQuery`.
- Rule-based fallback exists for timeout, parse failure, network failure, missing API key, and disabled mode.
- Keyword cleaning and canonical token normalization already exist.
- Theme / style / mood / character / color / rarity extraction already exists.

### Boundary
- This phase is about query understanding and structured intent extraction.

### Do not repeat
- Do not add a second parser pipeline with overlapping fields.
- Do not split `intelligenceQuery` semantics from top-level searchable fields without migration.

## Phase 03 Metadata Similarity Recommendation
### Completed content
- `gallery-recommendation.service` already scores visual, mood, character, archetype, setting, genre, and commerce match.
- Weight profiles already adapt to role-heavy vs theme-heavy queries.
- Diversity penalty already exists.
- Recommendation reasons, commerce intelligence, commerce presentation, and rerank debug output already exist.

### Boundary
- This phase is metadata-driven rerank on top of repository candidates.

### Do not repeat
- Do not create another “smart ranking” layer beside current rerank.
- Do not retune weights without real-user evidence.

## Phase 04 Feedback / Analytics
### Existing content
- Search / selection / checkout_created / purchase_completed logging already exists.
- JSONL feedback persistence already exists.
- Recommendation analytics report generation already exists.
- Parser stability, weak-match analytics, metadata coverage analytics, conversion analytics, and commerce insight extraction already exist.

### Boundary
- Analytics is observational in V1.

### Do not repeat
- Do not add overlapping feedback event names for the same funnel step.
- Do not turn analytics into silent live ranking control.

## Phase 07 Recommendation Recovery
### Completed content
- Parser fallback exists.
- Rerank fallback via `usedFallback` exists.
- No-ranking-change preservation exists.
- Refresh `random_fallback` and `need_clarification` recovery exists.
- Zero / weak signal recovery behavior already exists.

### Boundary
- Recovery exists to preserve usable output, not to mask ranking bugs.

### Do not repeat
- Do not introduce new recovery names for the same behavior.
- Do not blur parser fallback, rerank fallback, and refresh fallback.

## Phase 08 Curator Narration
### Completed content
- Per-card curator narration exists.
- Batch curator summary exists.
- Embed-ready narration lines exist.
- Commerce presentation text and curator narration already coexist.

### Boundary
- Narration is presentation, not ranking policy.

### Do not repeat
- Do not add another narration system with different truth semantics.
- Do not let narration become the explanation for bugs in ranking.

## Phase 09 Need Assessment
### Default status
- Paused by default.

### Only resume if
- analytics cannot explain real-user failures
- current event model cannot answer a necessary product question
- there is a validated observability gap blocking production decisions

### Do not repeat
- Do not start Phase 09 because “more analytics sounds useful”.
