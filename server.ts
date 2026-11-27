import 'dotenv/config';
import http from 'http';
import path from 'path';
import {fileURLToPath} from 'url';
import express from 'express';
import {createApp, jsonErrorHandler} from './server/app.ts';
import {globalBriefService} from './server/briefService.ts';
import {loadConfig} from './server/config.ts';
import {describeError, log} from './server/logger.ts';
import {geminiBudget} from './server/quota.ts';
import fs from 'fs';
import {createFakeGenerator, createFakeLiveClient, FIXTURES_DIR} from './server/fakeGemini.ts';
import {createGeminiGenerator} from './server/gemini.ts';
import {attachLiveBridge} from './server/live.ts';
import {analyzeLiveTalkTurn} from './server/talkPrompt.ts';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const BRIEF_REFRESH_INTERVAL_MS = 3 * 60 * 60 * 1000;

async function startServer() {
  const config = loadConfig();
  geminiBudget.configure(config.geminiDailyCallCap);
  const fakeGenerator = config.geminiFake ? createFakeGenerator() : null;
  const generate = fakeGenerator ?? createGeminiGenerator();
  const app = createApp({config, generate});
  const httpServer = http.createServer(app);
  if (config.geminiFake) {
    // Test-only: canned Gemini answers, fixed Brief items and their audio (see server/fakeGemini.ts).
    log.warn('gemini_fake_mode', {hint: 'GEMINI_FAKE=1: answering every Gemini call from server/fixtures/.'});
    globalBriefService.useFixtureItems(
      JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'brief-items.json'), 'utf8'))
    );
    app.use('/__fixtures', express.static(path.join(FIXTURES_DIR, 'media')));
    app.post('/__fixtures/reset', (_req, res) => {
      fakeGenerator?.reset();
      res.json({ok: true});
    });
    app.get('/__fixtures/calls', (_req, res) => {
      res.json(fakeGenerator?.callCounts() ?? {});
    });
    attachLiveBridge(httpServer, config, {
      getClient: createFakeLiveClient(),
      analyzeTalkTurn: (ctx, userText, tutorText) => analyzeLiveTalkTurn({ctx, userText, tutorText, generate}),
    });
  } else {
    attachLiveBridge(httpServer, config);
  }

  if (!config.serveDist) {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        // Vite's browser client always opens its HMR socket (and CSS modules import from it), so the
        // socket is always attached to this server on the same origin. When HMR is off, file watching
        // is disabled instead, so no updates/reloads are pushed (avoids flicker during agent edits).
        hmr: {server: httpServer},
        watch: config.hmrEnabled ? {} : null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(SERVER_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }
  app.use(jsonErrorHandler);

  let briefRefreshTimer: ReturnType<typeof setInterval> | null = null;

  httpServer.listen(config.port, '0.0.0.0', () => {
    log.info('server_listening', {port: config.port, geminiDailyCallCap: config.geminiDailyCallCap});

    // Non-blocking startup ingest + periodic refresh every 3 hours (only processes new URL hashes once).
    const runBriefIngest = () => {
      if (config.geminiFake) return;
      void globalBriefService.refreshFeeds(process.env.GEMINI_API_KEY?.trim() ? generate : undefined).catch((err) => {
        // Seed items remain available if remote RSS feeds are unreachable.
        log.warn('brief_refresh_failed', describeError(err));
      });
    };
    runBriefIngest();
    briefRefreshTimer = setInterval(runBriefIngest, BRIEF_REFRESH_INTERVAL_MS);
    briefRefreshTimer.unref();
  });

  // Cloud Run sends SIGTERM before stopping an instance: stop accepting connections and drain.
  const shutdown = (signal: string) => {
    log.info('server_shutting_down', {signal});
    if (briefRefreshTimer) clearInterval(briefRefreshTimer);
    httpServer.close(() => process.exit(0));
    httpServer.closeIdleConnections();
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  log.error('server_start_failed', describeError(err));
  process.exit(1);
});
