import path from 'node:path';
import {defineConfig, devices} from '@playwright/test';

/**
 * End-to-end tests against the real production build, served by `node server.ts` in the
 * GEMINI_FAKE=1 test mode (canned Gemini answers from server/fixtures/; see server/fakeGemini.ts).
 * Run `bun run e2e` (builds first). WebKit projects run when E2E_BROWSERS includes "webkit" (CI does).
 */
const PORT = Number(process.env.E2E_PORT ?? 4173);
const browsers = (process.env.E2E_BROWSERS ?? 'chromium').split(',').map((b) => b.trim());
const micWav = path.resolve('e2e/fixtures/mic.wav');

const chromiumLaunch = {
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${micWav}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
  // The cloud dev container ships one Chromium; CI installs Playwright's own.
  ...(process.env.E2E_CHROMIUM_PATH ? {executablePath: process.env.E2E_CHROMIUM_PATH} : {}),
};

const mobile = {viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true};
const desktop = {viewport: {width: 1280, height: 800}, deviceScaleFactor: 1};

export default defineConfig({
  testDir: 'e2e/tests',
  outputDir: 'e2e/test-results',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: {timeout: 10_000},
  reporter: process.env.CI ? [['list'], ['html', {outputFolder: 'e2e/report', open: 'never'}]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  },
  projects: [
    ...(browsers.includes('chromium')
      ? [
          {name: 'chromium-mobile', use: {browserName: 'chromium' as const, ...mobile, launchOptions: chromiumLaunch}},
          {
            name: 'chromium-desktop',
            use: {browserName: 'chromium' as const, ...desktop, launchOptions: chromiumLaunch},
          },
        ]
      : []),
    ...(browsers.includes('webkit')
      ? [
          {name: 'webkit-mobile', use: {...devices['iPhone 13'], ...mobile}},
          {name: 'webkit-desktop', use: {...devices['Desktop Safari'], ...desktop}},
        ]
      : []),
  ],
  webServer: {
    command: 'node server.ts',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      NODE_ENV: 'test',
      GEMINI_FAKE: '1',
      SERVE_DIST: '1',
      PORT: String(PORT),
      TRUST_PROXY: '0',
      API_RATE_LIMIT_PER_MINUTE: '100000',
      MAX_LIVE_SESSIONS_PER_IP: '50',
    },
  },
});
