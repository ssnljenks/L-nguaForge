# AI quality evals

Unit tests check the code around Gemini. These evals check whether Gemini's **output** is right. They call the
real API through the production routes and prompts, so they are **not** part of `bun run test` or CI.

```bash
bun run eval --dry-run                 # print the plan (calls + estimated cost) and exit
bun run eval --label baseline          # full run, writes evals/results/baseline.json + evals/REPORT.md
bun run eval --only safety,gist        # selected features
bun run eval --sample 3                # smoke run: 3 items per dataset
bun run eval --label after --compare evals/results/baseline.json   # adds a before/after section
bun run test:evals                     # offline harness tests (no API, no key)
```

Before/after on this branch: the production fixes are in the commit after the eval suite, so

```bash
git checkout 7f0cff7 && bun run eval --label baseline      # eval suite only, no fixes
git checkout eval/ai-quality && bun run eval --label after --compare evals/results/baseline.json
```

Needs `GEMINI_API_KEY` (env or `.env`). Model IDs are read from `server/config.ts` and never changed here.

## Budget, cache, safety

- **Hard caps**: `--max-calls` (default 1200, `EVAL_MAX_CALLS`) and `--max-cost` (default $8, `EVAL_MAX_COST_USD`).
  The worst-case plan is printed first; if it exceeds a cap nothing runs unless you pass `--allow-truncated`.
  Every live attempt (including SDK retries) is counted; at the cap, remaining cases are reported as NOT RUN.
- **Cost is an estimate** (token counts x the price table in `lib/budget.ts`; override with `EVAL_PRICE_STANDARD="in,out"`
  etc., USD per 1M tokens). Check the table against current Google pricing.
- **Cache**: responses are cached in `evals/.cache/` (git-ignored) by hash of model, prompts, schema, thinking level and
  item id. Re-runs with unchanged prompts are free; any prompt/schema change misses automatically. `--no-cache` bypasses it.

## Layout

| Path        | What                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------- |
| `run.ts`    | CLI                                                                                      |
| `lib/`      | budget, cache, in-process app harness, judge helpers, report writer, remediation hints   |
| `features/` | one file per eval (8)                                                                    |
| `scorers/`  | deterministic checks (language, military terms, dialect markers)                         |
| `data/`     | golden datasets: all original text written for this suite (no real test items)           |
| `results/`  | saved run JSON for `--compare`                                                           |
| `REPORT.md` | generated report: pass rate per feature, worst failures, suggested prompt/schema changes |

## What each eval does

1. **OPI rating**: 25 scripted transcripts (15 es, 10 pt, levels 1-3 incl. plus levels and tricky cases) through
   `/api/debrief/analyze`; exact / off-by-one / off-by-two agreement, misses, military/domain content in debriefs.
2. **Examiner behavior**: 10 persona-driven simulated interviews through `/api/opi/turn` with the client's state machine;
   phase order, language, no military/work lead, complexity fit, ends on a success.
3. **Role-play**: 30 scenarios (10 per level) with a deliberately vague learner script; level fit, civilian only,
   complication voiced (L2-3), character holds firm.
4. **DLPT items**: 20 original passages through `BriefService.generateDrill`; blind answerer, defensible-choice count,
   trap-tag judge, no-passage guesser.
5. **Gist grading**: 20 summaries with planted additions/distortions/omissions; detection rate (additions >= 90%) and false alarms.
6. **Talk dialects**: 7 tutors x 5 conversations; dialect markers, wrong-variety forms, slang 0 vs 4, recast without lecturing.
   Every dialect verdict is queued for native-speaker confirmation in the report.
7. **Error taxonomy**: 30 labeled sentences; correct key returned, clean sentences not flagged, invented keys captured pre-sanitising.
8. **Safety**: 20 prompt injections (learner text and feed items); canaries, prompt/secret leaks, inflated ratings, forced flags.

## Limits

- Judges and simulators are models; their verdicts are evidence, not ground truth. Expected OPI levels are the author's
  judgment (rationale lines in `data/opi_transcripts_*.txt`) and should be confirmed by a certified rater.
- Voice-only behavior (live audio, accent, cadence) is not covered; the typed `/api/chat/turn` shares the live prompt.
- Dialect marker lists (`scorers/dialects.ts`) are not a linguistic authority.
