import {AsyncLocalStorage} from 'node:async_hooks';

/**
 * Structured JSON logs, one object per line. Cloud Run's logging agent reads `severity` and `message`
 * from JSON on stdout/stderr, so entries are filterable (`jsonPayload.event="gemini_call"`).
 *
 * Privacy rules (enforced here, not left to callers):
 *  - Callers pass named fields only. Request bodies, prompts, transcripts and model output are never logged.
 *  - Every string is scrubbed for API keys / bearer tokens and truncated.
 *  - Errors are reduced to `describeError`: name, status, kind and a few stack frames. The message is only
 *    included for errors whose text we control or that come from Google's API (and is scrubbed); a
 *    SyntaxError message, for instance, quotes the text it failed to parse, which can be learner text.
 */

export type LogSeverity = 'INFO' | 'WARNING' | 'ERROR';

export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

const MAX_STRING = 300;

const SECRET_PATTERNS: readonly RegExp[] = [
  /AIza[0-9A-Za-z_-]{20,}/g, // Google API keys
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /([?&;,\s](?:api[-_]?key|key|token|access_token|secret|authorization)=)[^&\s"']+/gi,
  /("?(?:api[-_]?key|apikey|x-goog-api-key|authorization|token|secret)"?\s*[:=]\s*"?)[^"\s,}]{6,}/gi,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
];

/** Removes API keys and tokens from free text and truncates it. */
export function scrubText(text: string, maxLen = MAX_STRING): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (...args: unknown[]) => {
      const prefix = typeof args[1] === 'string' ? args[1] : '';
      return `${prefix}[redacted]`;
    });
  }
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > maxLen ? `${out.slice(0, maxLen)}…` : out;
}

function scrubValue(value: LogValue): LogValue {
  return typeof value === 'string' ? scrubText(value) : value;
}

export interface RequestLogContext {
  requestId: string;
  /** Route pattern such as POST /api/opi/turn (never a URL with query strings). */
  route: string;
}

/** Carries the current API route into log lines written deep inside a request (e.g. the Gemini wrapper). */
export const requestLogContext = new AsyncLocalStorage<RequestLogContext>();

type Sink = (line: string) => void;
// `node --test` sets NODE_TEST_CONTEXT in test processes: keep their output clean unless a test installs a sink.
let sink: Sink = (line) => {
  if (!process.env.NODE_TEST_CONTEXT) process.stdout.write(`${line}\n`);
};

/** Test hook: capture log lines instead of writing them. Returns a restore function. */
export function setLogSink(next: Sink): () => void {
  const previous = sink;
  sink = next;
  return () => {
    sink = previous;
  };
}

export function writeLog(severity: LogSeverity, event: string, fields: LogFields = {}): void {
  const ctx = requestLogContext.getStore();
  const entry: Record<string, LogValue> = {
    severity,
    message: event,
    event,
    time: new Date().toISOString(),
    ...(ctx ? {requestId: ctx.requestId, route: ctx.route} : {}),
  };
  for (const [key, value] of Object.entries(fields)) {
    // A field can't replace the entry's own envelope (severity, message, event, time, route).
    if (value === undefined || key in entry) continue;
    entry[key] = scrubValue(value);
  }
  sink(JSON.stringify(entry));
}

export const log = {
  info: (event: string, fields?: LogFields) => writeLog('INFO', event, fields),
  warn: (event: string, fields?: LogFields) => writeLog('WARNING', event, fields),
  error: (event: string, fields?: LogFields) => writeLog('ERROR', event, fields),
};

function statusOf(err: unknown): number | undefined {
  const status = err && typeof err === 'object' ? (err as {status?: unknown}).status : undefined;
  return typeof status === 'number' ? status : undefined;
}

/** Stack frames only (no message line), so a stack can never carry quoted text. */
function stackFrames(err: unknown, max = 4): string | undefined {
  if (!(err instanceof Error) || !err.stack) return undefined;
  const frames = err.stack
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .slice(0, max)
    .map((line) =>
      line
        .trim()
        .replace(/^at /, '')
        .replace(/\(?(?:file:\/\/)?\/[^)]*\/(server|src)\//, '($1/')
    );
  return frames.length ? frames.join(' | ') : undefined;
}

/**
 * Safe fields for an error. `trustMessage` is true for errors whose message we wrote (UserFacingError) or that the
 * Gemini SDK produced from the API's own error body (ApiError); the message is then scrubbed and truncated.
 */
export function describeError(err: unknown, options: {trustMessage?: boolean} = {}): LogFields {
  const name = err instanceof Error ? err.name : typeof err;
  const trusted = options.trustMessage === true || name === 'ApiError' || name === 'UserFacingError';
  return {
    errorName: name,
    errorStatus: statusOf(err),
    errorMessage: trusted && err instanceof Error ? scrubText(err.message, 200) : undefined,
    stack: stackFrames(err),
  };
}
