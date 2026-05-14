# OpsInsight Runbook

## Purpose
OpsInsightAgent pulls real Railway production logs every day, uses an LLM to analyze system health, issue causes, and optimization suggestions, and generates a Markdown operations report artifact.

## Success Flow
`GitHub Actions -> npm run ops:daily -> RailwayLogService -> railway logs --service lootcardchoose --environment production -> OpsLogAnalysisService -> DeepSeek LLM -> reports/ops-insights/YYYY-MM-DD.md -> GitHub Actions artifact`

## Required GitHub Secrets
- `RAILWAY_TOKEN`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`

## Required GitHub Variables
- `RAILWAY_PROJECT_ID`
- `RAILWAY_LOG_SERVICE=lootcardchoose`
- `RAILWAY_LOG_ENVIRONMENT=production`

## Manual Trigger
`Actions -> Daily Ops Insight -> Run workflow -> main`

## Artifact Download
`workflow run -> Artifacts -> ops-insight-report-${run_id}`

## Success Criteria
The generated report should show:
- `Log Source: railway`
- `Analysis source: llm`

## Fallback Triage Order
1. Check `Railway CLI fallback` in the artifact report first.
2. Check the `Generate Ops Insight Report` step next.
3. Do not treat `railway link/status` Unauthorized messages as a prerequisite failure for `ops:daily`.
4. The current production success path does not depend on `railway link`.

## Important Principles
- Do not replace the current `RAILWAY_TOKEN` unless there is a verified production failure.
- Do not treat `railway link` as a success prerequisite.
- Use `ops:daily` successfully fetching `railway logs` as the source of truth.
- Do not modify the Discord, Gallery, or CustomerSupport main business chains while troubleshooting OpsInsight.
