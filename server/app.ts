import express, {type ErrorRequestHandler, type Express} from 'express';
import type {ServerConfig} from './config.ts';
import {toPublicError} from './errors.ts';
import type {GenerateStructured} from './gemini.ts';
import {registerBriefRoutes} from './routes/brief.ts';
import {registerChatRoutes} from './routes/chat.ts';
import {registerDebriefRoutes} from './routes/debrief.ts';
import {registerFixRoutes} from './routes/fix.ts';
import {registerLabRoutes} from './routes/lab.ts';
import {registerOpiRoutes} from './routes/opi.ts';
import {registerRoleplayRoutes} from './routes/roleplay.ts';
import {registerTalkRoutes} from './routes/talk.ts';
import {registerVocabRoutes} from './routes/vocab.ts';
import {createApiRateLimiter, createSecurityHeaders} from './security.ts';

export interface AppOptions {
  config: ServerConfig;
  generate: GenerateStructured;
}

/** Creates the Express app with security middleware and all /api routes (no static files). */
export function createApp({config, generate}: AppOptions): Express {
  const app = express();
  app.set('trust proxy', config.trustProxyHops);
  app.disable('x-powered-by');
  app.use(createSecurityHeaders(config));

  app.get('/api/health', (_req, res) => {
    res.json({ok: true});
  });

  const api = express.Router();
  api.use(express.json({limit: '1mb'}));
  const deps = {generate};
  registerOpiRoutes(api, deps);
  registerRoleplayRoutes(api, deps);
  registerTalkRoutes(api, deps);
  registerVocabRoutes(api, deps);
  registerBriefRoutes(api, deps);
  registerDebriefRoutes(api, deps);
  registerLabRoutes(api, deps);
  registerChatRoutes(api, deps);
  registerFixRoutes(api, deps);
  api.use((_req, res) => {
    res.status(404).json({error: 'Not found.'});
  });

  // The limiter runs before body parsing so rejected requests cost as little as possible.
  app.use('/api', createApiRateLimiter(config.apiRateLimitPerMinute), api);
  return app;
}

/** Final error handler: malformed/oversized JSON bodies and anything else become sanitized JSON errors. */
export const jsonErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const type = (err as {type?: unknown})?.type;
  if (type === 'entity.parse.failed') {
    res.status(400).json({error: 'Malformed JSON request body.'});
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json({error: 'Request body is too large.'});
    return;
  }
  const {status, message} = toPublicError(err);
  res.status(status).json({error: message});
};
