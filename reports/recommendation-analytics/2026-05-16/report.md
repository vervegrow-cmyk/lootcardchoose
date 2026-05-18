# Recommendation Analytics Report

## Summary
- date: 2026-05-16
- source file: D:\桌面文件下载\LOOTCARDCHOOSE\reports\recommendation-feedback.jsonl
- parsed lines: 60
- invalid lines: 0

## Selection Analytics
- totalSelections: 28
- rankedSelections: 28
- top1SelectionRate: numerator=28, denominator=28, rate=100.0%, insufficientData=false
- top3SelectionRate: numerator=28, denominator=28, rate=100.0%, insufficientData=false
- top5SelectionRate: numerator=28, denominator=28, rate=100.0%, insufficientData=false

## Conversion Analytics
- searchCount: 14
- selectionCount: 28
- checkoutCreatedCount: 14
- paidCount: 0
- searchToSelect: numerator=28, denominator=14, rate=200.0%, insufficientData=false
- selectToCheckout: numerator=14, denominator=28, rate=50.0%, insufficientData=false
- checkoutToPaid: numerator=0, denominator=14, rate=0.0%, insufficientData=false

## Weak Match Analytics
- query=show me 10 black gold ssr female cards, searches=14, selections=28, checkouts=14, paid=0, top1Miss=0, top3Miss=0, observation=show me 10 black gold ssr female cards checkouts are not converting to paid
- archetypes: none

## Metadata Coverage Analytics
- totalActiveCards: 104
- cardsWithAnyIntelligence: 104
- field=visualStyle, cardsWithField=104, totalActiveCards=104, coverageRate=100.0%, insufficientData=false
- field=moodTags, cardsWithField=104, totalActiveCards=104, coverageRate=100.0%, insufficientData=false
- field=toneTags, cardsWithField=68, totalActiveCards=104, coverageRate=65.4%, insufficientData=false
- field=characterTypes, cardsWithField=104, totalActiveCards=104, coverageRate=100.0%, insufficientData=false
- field=archetypeTags, cardsWithField=28, totalActiveCards=104, coverageRate=26.9%, insufficientData=false
- field=settingTags, cardsWithField=104, totalActiveCards=104, coverageRate=100.0%, insufficientData=false
- field=genreTags, cardsWithField=93, totalActiveCards=104, coverageRate=89.4%, insufficientData=false
- field=colorHints, cardsWithField=102, totalActiveCards=104, coverageRate=98.1%, insufficientData=false
- sparseFamilies:
- family=boss_like, cardsMatched=0, totalActiveCards=104, coverageRate=0.0%, insufficientData=false
- family=cyberpunk, cardsMatched=0, totalActiveCards=104, coverageRate=0.0%, insufficientData=false
- family=empress, cardsMatched=0, totalActiveCards=104, coverageRate=0.0%, insufficientData=false
- family=mecha, cardsMatched=0, totalActiveCards=104, coverageRate=0.0%, insufficientData=false
- family=priestess, cardsMatched=1, totalActiveCards=104, coverageRate=1.0%, insufficientData=false
- family=goddess, cardsMatched=12, totalActiveCards=104, coverageRate=11.5%, insufficientData=false
- family=warrior, cardsMatched=15, totalActiveCards=104, coverageRate=14.4%, insufficientData=false
- family=holy, cardsMatched=18, totalActiveCards=104, coverageRate=17.3%, insufficientData=false

## Parser Stability Analytics
- searchEvents: 14
- telemetryKnownEvents: 1
- unknownTelemetryEvents: 13
- timeoutRatio: numerator=1, denominator=14, rate=7.1%, insufficientData=false
- fallbackRatio: numerator=1, denominator=14, rate=7.1%, insufficientData=false
- rerankEffectivenessRatio: numerator=1, denominator=14, rate=7.1%, insufficientData=false
- outcomeBreakdown:
- outcome=unknown, count=13
- outcome=timeout_fallback, count=1
- fallbackReasonBreakdown:
- fallbackReason=timeout, count=1