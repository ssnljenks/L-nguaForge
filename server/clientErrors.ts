import type {Request, RequestHandler, Response} from 'express';
import {log, scrubText} from './logger.ts';

/**
 * Lightweight client error reports (POST /api/client-error). The browser sends crashes and audio/speech
 * failures so a tester's problem shows up in the server logs without asking them for a screenshot.
 *
 * What is accepted is a fixed shape: enumerated kinds, a short scrubbed message, a few stack frames and coarse
 * environment flags. Anything else in the body is dropped. No user text, cookies or storage contents are
 * collected, and the sender's IP is not logged (the rate limiter sees it, the log line does not).
 */

export const CLIENT_ERROR_KINDS = [
  'js_error',
  'unhandled_rejection',
  'react_error',
  'audio',
  'speech',
  'live',
  'api',
  'other',
] as const;
export const CLIENT_ERROR_TABS = ['today', 'talk', 'test_prep', 'brief', 'vocab', 'settings', 'other'] as const;
export const CLIENT_PLATFORMS = ['ios', 'android', 'desktop', 'other'] as const;

export interface ClientErrorReport {
  kind: (typeof CLIENT_ERROR_KINDS)[number];
  message: string;
  stack?: string;
  tab: (typeof CLIENT_ERROR_TABS)[number];
  platform: (typeof CLIENT_PLATFORMS)[number];
  standalone: boolean;
  online: boolean;
  appVersion: string;
  count: number;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Returns a clean report, or null when the body has nothing worth logging. */
export function sanitizeClientErrorReport(body: unknown): ClientErrorReport | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  const message = typeof raw.message === 'string' ? scrubText(raw.message, 300) : '';
  if (!message) return null;
  const stack = typeof raw.stack === 'string' ? scrubText(raw.stack.split('\n').slice(0, 8).join(' | '), 1200) : '';
  const count = typeof raw.count === 'number' && Number.isFinite(raw.count) ? Math.min(999, Math.max(1, raw.count)) : 1;
  return {
    kind: oneOf(raw.kind, CLIENT_ERROR_KINDS, 'other'),
    message,
    ...(stack ? {stack} : {}),
    tab: oneOf(raw.tab, CLIENT_ERROR_TABS, 'other'),
    platform: oneOf(raw.platform, CLIENT_PLATFORMS, 'other'),
    standalone: raw.standalone === true,
    online: raw.online !== false,
    appVersion: typeof raw.appVersion === 'string' ? scrubText(raw.appVersion, 40) : '',
    count: Math.floor(count),
  };
}

export const clientErrorHandler: RequestHandler = (req: Request, res: Response) => {
  const report = sanitizeClientErrorReport(req.body);
  if (report) {
    const {message, ...rest} = report;
    log.warn('client_error', {...rest, clientMessage: message});
  }
  // 204 either way: the client must never retry or surface a failure of the reporter itself.
  res.status(204).end();
};
