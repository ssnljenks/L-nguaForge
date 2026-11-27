/**
 * Server configuration. Everything is read from environment variables once at startup;
 * `loadConfig` is pure so it can be unit tested with a fake environment.
 */

export const MODELS = {
  /** Examiner turns, debriefs, PREP/interpretation generation and grading. */
  standard: 'gemini-3.8-flash',
  /** Free conversation and sentence coaching. */
  chat: 'gemini-4-hydrogen',
  /** Low-latency word lookups and "how do I say" helper. */
  fastLookup: 'gemini-3.1-flash-lite',
  /** Real-time bidirectional voice. */
  live: 'gemini-3.8-live',
} as const;

export const VALID_LIVE_VOICES = ['Zephyr', 'Puck', 'Kore', 'Fenrir', 'Charon'] as const;

export const LIVE_WS_MAX_PAYLOAD_BYTES = 128 * 1024;

export interface ServerConfig {
  isProduction: boolean;
  /**
   * Serve the built app from dist/ (with the production CSP) instead of the Vite dev server. Always on in
   * production; SERVE_DIST=1 turns it on for end-to-end tests, which need the real build and service worker.
   */
  serveDist: boolean;
  /**
   * GEMINI_FAKE=1: deterministic test mode. Every Gemini call is answered from server/fixtures/ (see
   * server/fakeGemini.ts); request validation, the classification guard and client parsing still run.
   * Never allowed in production: loadConfig throws.
   */
  geminiFake: boolean;
  port: number;
  /** Number of reverse-proxy hops in front of this server (Cloud Run = 1). 0 = trust no X-Forwarded-* headers. */
  trustProxyHops: number;
  apiRateLimitPerMinute: number;
  maxLiveSessions: number;
  maxLiveSessionsPerIp: number;
  maxLiveSessionMinutes: number;
  /** Live voice sessions one IP may start per UTC day (0 = unlimited). */
  liveDailySessionsPerIp: number;
  /** Gemini-backed POST requests one IP may make per UTC day (0 = unlimited). */
  apiDailyLimitPerIp: number;
  /** Upstream Gemini attempts, all users together, per UTC day (0 = unlimited). Retries count. */
  geminiDailyCallCap: number;
  /** POST /api/client-error reports one IP may send per minute. */
  clientErrorLimitPerMinute: number;
  /** Extra hosts (besides the server's own) whose pages may open /ws/live. */
  extraAllowedHosts: string[];
  /** CSP frame-ancestors (production only). AI Studio embeds the app in an iframe. */
  frameAncestors: string[];
  hmrEnabled: boolean;
}

type Env = Record<string, string | undefined>;

function readNonNegativeInt(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function parseHostList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      try {
        return [new URL(entry).host];
      } catch {
        return [];
      }
    });
}

export const GEMINI_FAKE_IN_PRODUCTION_MESSAGE =
  'GEMINI_FAKE=1 is a test-only mode and cannot be used with NODE_ENV=production. Refusing to start.';

export function loadConfig(env: Env = process.env): ServerConfig {
  const isProduction = env.NODE_ENV === 'production';
  const geminiFake = env.GEMINI_FAKE === '1';
  if (isProduction && geminiFake) throw new Error(GEMINI_FAKE_IN_PRODUCTION_MESSAGE);
  return {
    isProduction,
    serveDist: isProduction || env.SERVE_DIST === '1',
    geminiFake,
    port: readNonNegativeInt(env, 'PORT', 3000),
    trustProxyHops: readNonNegativeInt(env, 'TRUST_PROXY', 1),
    apiRateLimitPerMinute: readNonNegativeInt(env, 'API_RATE_LIMIT_PER_MINUTE', 40),
    maxLiveSessions: readNonNegativeInt(env, 'MAX_LIVE_SESSIONS', 20),
    maxLiveSessionsPerIp: readNonNegativeInt(env, 'MAX_LIVE_SESSIONS_PER_IP', 2),
    maxLiveSessionMinutes: readNonNegativeInt(env, 'MAX_LIVE_SESSION_MINUTES', 15),
    liveDailySessionsPerIp: readNonNegativeInt(env, 'LIVE_DAILY_SESSIONS_PER_IP', 10),
    apiDailyLimitPerIp: readNonNegativeInt(env, 'API_DAILY_LIMIT_PER_IP', 800),
    geminiDailyCallCap: readNonNegativeInt(env, 'GEMINI_DAILY_CALL_CAP', 3000),
    clientErrorLimitPerMinute: readNonNegativeInt(env, 'CLIENT_ERROR_LIMIT_PER_MINUTE', 10),
    extraAllowedHosts: parseHostList(`${env.APP_URL ?? ''},${env.ALLOWED_ORIGINS ?? ''}`),
    frameAncestors: (env.FRAME_ANCESTORS ?? "'self' https://aistudio.google.com").split(/[,\s]+/).filter(Boolean),
    hmrEnabled: env.DISABLE_HMR !== 'true' && env.ENABLE_HMR === 'true',
  };
}
