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
  port: number;
  /** Number of reverse-proxy hops in front of this server (Cloud Run = 1). 0 = trust no X-Forwarded-* headers. */
  trustProxyHops: number;
  apiRateLimitPerMinute: number;
  maxLiveSessions: number;
  maxLiveSessionsPerIp: number;
  maxLiveSessionMinutes: number;
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

export function loadConfig(env: Env = process.env): ServerConfig {
  return {
    isProduction: env.NODE_ENV === 'production',
    port: readNonNegativeInt(env, 'PORT', 3000),
    trustProxyHops: readNonNegativeInt(env, 'TRUST_PROXY', 1),
    apiRateLimitPerMinute: readNonNegativeInt(env, 'API_RATE_LIMIT_PER_MINUTE', 40),
    maxLiveSessions: readNonNegativeInt(env, 'MAX_LIVE_SESSIONS', 20),
    maxLiveSessionsPerIp: readNonNegativeInt(env, 'MAX_LIVE_SESSIONS_PER_IP', 2),
    maxLiveSessionMinutes: readNonNegativeInt(env, 'MAX_LIVE_SESSION_MINUTES', 15),
    extraAllowedHosts: parseHostList(`${env.APP_URL ?? ''},${env.ALLOWED_ORIGINS ?? ''}`),
    frameAncestors: (env.FRAME_ANCESTORS ?? "'self' https://aistudio.google.com").split(/[,\s]+/).filter(Boolean),
    hmrEnabled: env.DISABLE_HMR !== 'true' && env.ENABLE_HMR === 'true',
  };
}
