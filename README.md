# LinguaForge ILR

Speaking, listening and reading practice for Spanish and Portuguese, aimed at ILR 2 → 2+/3. React + Vite client, Express server; every Gemini call goes through the server.

```bash
bun install
bun run dev        # http://localhost:3000 (needs GEMINI_API_KEY in .env)
bun run test       # unit tests
```

## End-to-end tests

The Playwright suite in `e2e/` drives the real production build through every main flow on a 390×844 mobile viewport and a 1280×800 desktop viewport, checks each main screen with axe (serious and critical violations fail), and saves screenshots for design review.

```bash
bun run e2e                        # Chromium: builds, starts the test server, runs the suite
bun run e2e e2e/tests/03-opi.spec.ts --project chromium-mobile     # one file, one viewport
bun run e2e:webkit                 # WebKit (needs: npx playwright install --with-deps webkit)
```

- **No Gemini key or network needed.** The test server runs with `GEMINI_FAKE=1`: every Gemini call is answered from `server/fixtures/` and `/ws/live` replays a canned exchange. Only the model call is replaced, so request validation, the classification guard and client parsing are exercised. The server refuses to start with `GEMINI_FAKE=1` and `NODE_ENV=production`.
- **Audio.** Chromium gets a fake microphone fed from `e2e/fixtures/mic.wav`; browser speech recognition and synthesis are stubbed in `e2e/support.ts`. The live-voice step runs on Chromium only.
- **Screenshots** of main screens go to `e2e/screens/<project>/` (CI uploads them as the `e2e-screens-<browser>` artifact). On failure, the HTML report and failure screenshots are in `e2e/report/` and `e2e/test-results/`; rerun one test with `--trace on` to debug it.
- **Changing a canned answer:** edit the fixture in `server/fixtures/`. `server/fakeGemini.test.ts` checks every fixture against its route's response schema.
- Locally, a server already running on port 4173 is reused; start it with the `webServer.env` values from `playwright.config.ts`.

## Running a beta

- **[READINESS.md](READINESS.md)** is the beta-readiness review: what fails on iPhone and Android, error and empty states, Gemini cost and quota, Cloud Run settings, logging.
- **[TESTING.md](TESTING.md)** is the manual test plan (15-minute smoke test, per-tab checklists, "try to break it", bug-report template).
- `deploy/cloud-run.service.yaml` holds the Cloud Run settings (one instance, 20-minute request timeout for Live voice).

### Server settings

All optional except `GEMINI_API_KEY`; every cap is per server process (use one Cloud Run instance).

| Variable                        | Default | What it does                                                                                                                                                  |
| ------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`                | –       | The Gemini key. Never sent to the browser.                                                                                                                    |
| `ROLEPLAY_TOKEN_SECRET`         | random  | Key for sealed role-play scenarios (any long random string; a comma-separated list rotates: first one seals). Without it a restart expires running scenarios. |
| `TRUST_PROXY`                   | `1`     | Reverse-proxy hops in front of the app (Cloud Run = 1), so limits see the real client IP.                                                                     |
| `API_RATE_LIMIT_PER_MINUTE`     | `40`    | Per-IP requests per minute on `/api`.                                                                                                                         |
| `API_DAILY_LIMIT_PER_IP`        | `800`   | Per-IP POST requests (the Gemini-backed ones) per 24 hours. `0` = off.                                                                                        |
| `GEMINI_DAILY_CALL_CAP`         | `3000`  | Upstream Gemini attempts per UTC day, everyone together; retries count. `0` = off.                                                                            |
| `MAX_LIVE_SESSIONS`             | `20`    | Concurrent Live voice sessions.                                                                                                                               |
| `MAX_LIVE_SESSIONS_PER_IP`      | `2`     | Concurrent Live voice sessions per IP.                                                                                                                        |
| `LIVE_DAILY_SESSIONS_PER_IP`    | `10`    | Live voice sessions one IP may start per UTC day. `0` = off.                                                                                                  |
| `MAX_LIVE_SESSION_MINUTES`      | `15`    | Length cap for one Live voice session (keep the Cloud Run request timeout above it).                                                                          |
| `CLIENT_ERROR_LIMIT_PER_MINUTE` | `10`    | Per-IP browser error reports accepted per minute.                                                                                                             |

### Logs

One JSON object per line on stdout (`severity`, `event`, `route`, …), which Cloud Logging parses. Events: `gemini_call` (model, attempts, ms, token counts), `gemini_attempt_failed`, `gemini_failure`, `api_request`, `api_rate_limited`, `client_error`, `live_*`. Logs never contain prompts, transcripts, learner text, request bodies, IP addresses or API keys; error messages are scrubbed and truncated (`server/logger.ts`).
