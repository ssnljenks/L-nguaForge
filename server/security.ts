import type {IncomingMessage} from 'http';
import type {Duplex} from 'stream';
import type {RequestHandler} from 'express';
import {rateLimit} from 'express-rate-limit';
import helmet from 'helmet';
import {log} from './logger.ts';

export function createSecurityHeaders(options: {isProduction: boolean; frameAncestors: string[]}): RequestHandler {
  return helmet({
    // Vite's dev server injects inline scripts, so the CSP is enforced in production builds only.
    contentSecurityPolicy: options.isProduction
      ? {
          useDefaults: true,
          directives: {
            'default-src': ["'self'"],
            'script-src': ["'self'"],
            'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
            'img-src': ["'self'", 'data:', 'blob:'],
            // Brief streams audio directly from publishers (feed enclosures on many CDNs). Media can't run
            // script, so allowing any HTTPS media source is low-risk (REVIEW H-1).
            'media-src': ["'self'", 'blob:', 'https:'],
            // 'self' covers same-origin ws:/wss: for /ws/live; font hosts are fetched by the service worker.
            'connect-src': ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
            'worker-src': ["'self'"],
            'manifest-src': ["'self'"],
            'frame-ancestors': options.frameAncestors,
            'upgrade-insecure-requests': null,
          },
        }
      : false,
    // Framing is governed by CSP frame-ancestors (X-Frame-Options cannot allow-list AI Studio).
    frameguard: false,
    crossOriginEmbedderPolicy: false,
  });
}

/** Per-IP limit for Gemini-backed endpoints, protecting the API key's quota. */
export function createApiRateLimiter(limitPerMinute: number): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: limitPerMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {error: 'Too many requests. Please wait a minute and try again.'},
  });
}

/**
 * Per-IP daily cap on Gemini-backed requests (every POST under /api except error reports). The per-minute
 * limiter stops bursts; this stops a slow loop from draining the key's daily quota. 0 disables it.
 */
export function createDailyApiLimiter(limitPerDay: number): RequestHandler {
  if (limitPerDay <= 0) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: 24 * 60 * 60_000,
    limit: limitPerDay,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => req.method !== 'POST',
    message: {
      error:
        'You have reached the daily limit for AI requests during testing. It resets within 24 hours. Saved Vocab and offline drills still work.',
    },
  });
}

/** Tight limit for client error reports, so a crash loop in one browser can't flood the logs. */
export function createClientErrorLimiter(limitPerMinute: number): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: Math.max(1, limitPerMinute),
    standardHeaders: false,
    legacyHeaders: false,
    // Over the limit the report is simply dropped; the client treats any response as done.
    handler: (_req, res) => {
      res.status(204).end();
    },
  });
}

/**
 * One structured log line per API request: method, path without query string, status and duration.
 * No bodies, headers or IP addresses. 429s from the limiters are logged as warnings so overload is visible.
 */
export function createApiRequestLogger(): RequestHandler {
  return (req, res, next) => {
    const startedAt = Date.now();
    const route = `${req.method} ${req.originalUrl.split('?')[0]}`;
    res.on('finish', () => {
      const status = res.statusCode;
      const fields = {route, status, ms: Date.now() - startedAt};
      if (status === 429) log.warn('api_rate_limited', fields);
      else if (status >= 500) log.error('api_request', fields);
      else if (status >= 400) log.warn('api_request', fields);
      else log.info('api_request', fields);
    });
    next();
  };
}

function firstHeaderValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : (value ?? '')).split(',')[0].trim();
}

/** Mirrors Express's `trust proxy = <hops>` behaviour for raw upgrade requests. */
export function getClientIp(req: IncomingMessage, trustProxyHops: number): string {
  const socketIp = req.socket.remoteAddress ?? 'unknown';
  if (trustProxyHops <= 0) return socketIp;
  const header = req.headers['x-forwarded-for'];
  const forwarded = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
  const chain = [...forwarded, socketIp];
  return chain[Math.max(0, chain.length - 1 - trustProxyHops)] ?? socketIp;
}

/** Allows only browser pages served from this host (or explicitly configured hosts). */
export function isAllowedWebSocketOrigin(
  req: IncomingMessage,
  options: {trustProxyHops: number; extraAllowedHosts: string[]}
): boolean {
  const origin = firstHeaderValue(req.headers.origin);
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const allowed = new Set<string>(options.extraAllowedHosts);
  const host = firstHeaderValue(req.headers.host);
  if (host) allowed.add(host);
  if (options.trustProxyHops > 0) {
    const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host']);
    if (forwardedHost) allowed.add(forwardedHost);
  }
  return allowed.has(originHost);
}

export function rejectUpgrade(socket: Duplex, statusCode: number, statusText: string): void {
  socket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}
