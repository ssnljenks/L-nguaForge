# AI quality eval report

**No live run has been recorded yet.** The suite was built and verified offline only (`bun run test:evals`:
datasets, scorers, budget caps, cache, and a stub-model smoke run of all eight features). No Gemini key was
available where it was built, so there are no measured pass rates, failures, or before/after numbers to report.

To produce this report:

```bash
export GEMINI_API_KEY=...            # or put it in .env
bun run eval --dry-run               # worst-case plan and caps
bun run eval --label baseline        # overwrites this file
```

After changing prompts: `bun run eval --label after --compare evals/results/baseline.json`.

## Fix candidates from code review (unmeasured; not applied)

Each is wired to a check in the suite, so a baseline run will show whether it matters. See `evals/lib/remediation.ts` for all of them.

- `server/routes/opi.ts`: `validatedPhase` accepts any valid phase the model returns and the client feeds it back (check `phase_follows_plan`).
- `server/routes/roleplay.ts`: `complicationIntroduced` is set from pacing even if the character never voiced it (check `complication_voiced`).
- Learner text is interpolated unfenced in `opi/turn`, `chat/turn`, `debrief`, `roleplay` and the gist/fix/vocab/lab graders, while feed text already uses `createUntrustedFence` (eval 8).
- `server/briefService.ts` `sanitizeFindings`: `learnerSpan`/`sourceQuote` are not checked against their sources (check `spans_verbatim`).
- `server/errorReporting.ts`: the `key` field is a free string, so invented keys are only dropped after the fact (check `keys_valid`).
- `server/talkPrompt.ts`: the Paisa tutor's `defaultRegister` is `vos`, while the brief expects usted among friends. This needs a native speaker's decision.
