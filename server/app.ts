import express, {type ErrorRequestHandler, type Express} from 'express';
import type {ServerConfig} from './config.ts';
import {clientErrorHandler} from './clientErrors.ts';
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
import {createRoleplayTokenSealerFromEnv, type RoleplayTokenSealer} from './roleplayToken.ts';
import {
  createApiRateLimiter,
  createApiRequestLogger,
  createClientErrorLimiter,
  createDailyApiLimiter,
  createSecurityHeaders,
} from './security.ts';

export interface AppOptions {
  config: ServerConfig;
  generate: GenerateStructured;
  /** Seals role-play scenarios; defaults to a sealer keyed by ROLEPLAY_TOKEN_SECRET. Tests pass their own. */
  roleplayTokens?: RoleplayTokenSealer;
}

/** Creates the Express app with security middleware and all /api routes (no static files). */
export function createApp({config, generate, roleplayTokens}: AppOptions): Express {
  const app = express();
  app.set('trust proxy', config.trustProxyHops);
  app.disable('x-powered-by');
  app.use(createSecurityHeaders({isProduction: config.serveDist, frameAncestors: config.frameAncestors}));

  app.get('/api/health', (_req, res) => {
    res.json({ok: true});
  });

  const api = express.Router();
  api.use(express.json({limit: '1mb'}));
  const deps = {generate, roleplayTokens: roleplayTokens ?? createRoleplayTokenSealerFromEnv()};
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

  // Client error reports have their own tiny limiter and body cap, and sit outside the Gemini limiters: a browser
  // stuck in a crash loop must neither flood the logs nor use up the quota that real requests need.
  app.post(
    '/api/client-error',
    createClientErrorLimiter(config.clientErrorLimitPerMinute),
    express.json({limit: '8kb'}),
    clientErrorHandler
  );

  // The limiters run before body parsing so rejected requests cost as little as possible.
  app.use(
    '/api',
    createApiRequestLogger(),
    createApiRateLimiter(config.apiRateLimitPerMinute),
    createDailyApiLimiter(config.apiDailyLimitPerIp),
    api
  );
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
  const {status, message, code} = toPublicError(err);
  res.status(status).json({error: message, ...(code ? {code} : {})});
};
