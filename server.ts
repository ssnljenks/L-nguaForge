import 'dotenv/config';
import http from 'http';
import path from 'path';
import {fileURLToPath} from 'url';
import express from 'express';
import {createApp, jsonErrorHandler} from './server/app.ts';
import {loadConfig} from './server/config.ts';
import {createGeminiGenerator} from './server/gemini.ts';
import {attachLiveBridge} from './server/live.ts';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const config = loadConfig();
  const app = createApp({config, generate: createGeminiGenerator()});
  const httpServer = http.createServer(app);
  attachLiveBridge(httpServer, config);

  if (!config.isProduction) {
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

  httpServer.listen(config.port, '0.0.0.0', () => {
    console.log(`LinguaForge ILR server listening on http://0.0.0.0:${config.port}`);
  });

  // Cloud Run sends SIGTERM before stopping an instance: stop accepting connections and drain.
  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down.`);
    httpServer.close(() => process.exit(0));
    httpServer.closeIdleConnections();
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Failed to start LinguaForge ILR server:', err);
  process.exit(1);
});
