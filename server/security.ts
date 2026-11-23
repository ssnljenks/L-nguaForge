import type {IncomingMessage} from 'http';
import type {Duplex} from 'stream';
import type {RequestHandler} from 'express';
import {rateLimit} from 'express-rate-limit';
import helmet from 'helmet';

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
            'media-src': ["'self'", 'blob:'],
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
