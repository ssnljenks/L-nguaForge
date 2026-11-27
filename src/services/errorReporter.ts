import {getBrowserEnv} from '../audio/capabilities';

/**
 * Sends crashes and audio/speech failures to POST /api/client-error so a tester's problem shows up in the
 * server logs. Deliberately tiny:
 *  - only an error name/message, a few stack frames and coarse flags (tab, platform, standalone, online);
 *  - never conversation text, vocab, storage contents or URLs with query strings;
 *  - a repeat of the same error is sent once and then at most once a minute, with a count;
 *  - at most 20 reports per page load, and a failed send is dropped, never retried or shown.
 */

export type ClientErrorKind =
  'js_error' | 'unhandled_rejection' | 'react_error' | 'audio' | 'speech' | 'live' | 'api' | 'other';
export type ClientErrorTab = 'today' | 'talk' | 'test_prep' | 'brief' | 'vocab' | 'settings' | 'other';

export interface ClientErrorInput {
  kind: ClientErrorKind;
  message: string;
  stack?: string;
}

export const REPORT_ENDPOINT = '/api/client-error';
export const MAX_REPORTS_PER_PAGE = 20;
export const REPEAT_INTERVAL_MS = 60_000;

let currentTab: ClientErrorTab = 'other';
/** Called by the app shell so reports say which tab the user was on. */
export function setReportTab(tab: string): void {
  currentTab = (['today', 'talk', 'test_prep', 'brief', 'vocab', 'settings'] as const).includes(
    tab as ClientErrorTab & 'today'
  )
    ? (tab as ClientErrorTab)
    : 'other';
}

interface Seen {
  sentAt: number;
  suppressed: number;
}

export interface ReporterDeps {
  now: () => number;
  send: (body: string) => void;
  env: () => {platform: string; standalone: boolean; online: boolean};
}

/** Errors whose text we never forward: a SyntaxError message quotes the text it failed to parse. */
function safeMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'SyntaxError') return 'SyntaxError (message withheld)';
    return `${err.name}: ${err.message}`.slice(0, 300);
  }
  return typeof err === 'string' ? err.slice(0, 300) : 'Non-error value thrown';
}

export function createErrorReporter(deps: ReporterDeps) {
  const seen = new Map<string, Seen>();
  let total = 0;
  return {
    report(input: ClientErrorInput): boolean {
      const message = input.message.slice(0, 300);
      const key = `${input.kind}|${message}`;
      const t = deps.now();
      const prior = seen.get(key);
      if (prior && t - prior.sentAt < REPEAT_INTERVAL_MS) {
        prior.suppressed += 1;
        return false;
      }
      if (total >= MAX_REPORTS_PER_PAGE) return false;
      total += 1;
      seen.set(key, {sentAt: t, suppressed: 0});
      const env = deps.env();
      deps.send(
        JSON.stringify({
          kind: input.kind,
          message,
          ...(input.stack ? {stack: input.stack.split('\n').slice(0, 8).join('\n').slice(0, 1200)} : {}),
          tab: currentTab,
          platform: env.platform,
          standalone: env.standalone,
          online: env.online,
          count: (prior?.suppressed ?? 0) + 1,
        })
      );
      return true;
    },
  };
}

const reporter = createErrorReporter({
  now: Date.now,
  env: () => {
    const env = getBrowserEnv();
    return {
      platform: env.platform,
      standalone: env.standalone,
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
    };
  },
  send: (body) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const blob = new Blob([body], {type: 'application/json'});
      if (typeof navigator !== 'undefined' && navigator.sendBeacon?.(REPORT_ENDPOINT, blob)) return;
      void fetch(REPORT_ENDPOINT, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body,
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Reporting must never throw into the app.
    }
  },
});

/** Reports a caught failure (audio, speech, live voice, API) without disturbing the user. */
export function reportClientError(kind: ClientErrorKind, err: unknown): void {
  reporter.report({kind, message: safeMessage(err), stack: err instanceof Error ? err.stack : undefined});
}

/** Reports a failure described by a fixed string we wrote (no user text). */
export function reportClientEvent(kind: ClientErrorKind, message: string): void {
  reporter.report({kind, message});
}

const IGNORED = /ResizeObserver loop|^Script error\.?$|Load failed$|Failed to fetch$|NetworkError/i;

/** Installs window error and unhandled-rejection reporting once. */
export function installGlobalErrorReporting(target: Window = window): void {
  target.addEventListener('error', (event) => {
    const message = event.error ? safeMessage(event.error) : String(event.message ?? 'error');
    if (IGNORED.test(message)) return;
    reporter.report({kind: 'js_error', message, stack: event.error instanceof Error ? event.error.stack : undefined});
  });
  target.addEventListener('unhandledrejection', (event) => {
    const message = safeMessage(event.reason);
    if (IGNORED.test(message)) return;
    reporter.report({
      kind: 'unhandled_rejection',
      message,
      stack: event.reason instanceof Error ? event.reason.stack : undefined,
    });
  });
}
