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
