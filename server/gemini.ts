import {GoogleGenAI, type Schema, ThinkingLevel} from '@google/genai';
import {
  classifyGeminiError,
  ClientAbortedError,
  isTransientGeminiError,
  mapPublicError,
  UserFacingError,
} from './errors.ts';
import {describeError, log} from './logger.ts';
import {geminiBudget} from './quota.ts';

export {ThinkingLevel};

const MISSING_KEY_MESSAGE = 'GEMINI_API_KEY is not configured on the server. Configure it in Settings > Secrets.';

function readApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new UserFacingError(503, MISSING_KEY_MESSAGE);
  return apiKey;
}

let cachedClient: {key: string; client: GoogleGenAI} | null = null;

export function getAiClient(): GoogleGenAI {
  const apiKey = readApiKey();
  if (cachedClient?.key !== apiKey) {
    cachedClient = {
      key: apiKey,
      client: new GoogleGenAI({apiKey, httpOptions: {headers: {'User-Agent': 'aistudio-build'}}}),
    };
  }
  return cachedClient.client;
}

export function getLiveAiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: readApiKey(),
    apiVersion: 'v1beta',
    httpOptions: {headers: {'User-Agent': 'aistudio-build'}},
  });
}

// ---------------------------------------------------------------------------
// Retry with timeout budget
// ---------------------------------------------------------------------------

export interface RetryBudget {
  /** Hard cap for a single attempt. */
  attemptTimeoutMs: number;
  /** Total wall-clock budget across all attempts and backoff delays. */
  totalBudgetMs: number;
  maxAttempts: number;
}

/**
 * Budgets are sized to finish before the browser gives up
 * (15 s for lookups and 45 s for everything else; see src/services/api.ts).
 */
export const BUDGETS = {
  fast: {attemptTimeoutMs: 8_000, totalBudgetMs: 13_000, maxAttempts: 3},
  standard: {attemptTimeoutMs: 30_000, totalBudgetMs: 42_000, maxAttempts: 3},
} as const satisfies Record<string, RetryBudget>;

export const TIMEOUT_MESSAGE = 'The AI took too long to respond. Please try again.';

/** Minimum time worth starting another attempt with. */
const MIN_ATTEMPT_MS = 2_000;

export interface RetryDeps {
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  now: () => number;
  random: () => number;
}

const defaultRetryDeps: RetryDeps = {
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new ClientAbortedError());
        },
        {once: true}
      );
    }),
  now: Date.now,
  random: Math.random,
};

/** Exponential backoff with jitter: ~600 ms, ~1.2 s, ~2.4 s ... */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = 600 * 2 ** attempt;
  return Math.round(base + base * 0.5 * random());
}

/**
 * Runs `fn` with a per-attempt timeout, retrying transient failures (429/5xx/timeouts)
 * with exponential backoff while staying inside the total budget.
 * `signal` cancels everything (e.g. the HTTP client disconnected).
 */
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  budget: RetryBudget,
  signal?: AbortSignal,
  deps: RetryDeps = defaultRetryDeps
): Promise<T> {
  const startedAt = deps.now();
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new ClientAbortedError();
    const remaining = budget.totalBudgetMs - (deps.now() - startedAt);
    const timeoutSignal = AbortSignal.timeout(Math.max(1, Math.min(budget.attemptTimeoutMs, remaining)));
    const attemptSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      return await fn(attemptSignal);
    } catch (err) {
      if (signal?.aborted) throw new ClientAbortedError();
      const timedOut = timeoutSignal.aborted;
      const retryable = timedOut || isTransientGeminiError(err);
      const delay = backoffDelayMs(attempt, deps.random);
      const elapsed = deps.now() - startedAt;
      const canRetry =
        retryable && attempt + 1 < budget.maxAttempts && elapsed + delay + MIN_ATTEMPT_MS <= budget.totalBudgetMs;
      if (!canRetry) {
        if (timedOut) throw new UserFacingError(504, TIMEOUT_MESSAGE, {cause: err});
        throw err;
      }
      await deps.sleep(delay, signal);
    }
  }
}

// ---------------------------------------------------------------------------
// Structured JSON prompts
// ---------------------------------------------------------------------------

export function parseModelJson(raw: string | undefined, emptyMessage: string): Record<string, unknown> {
  const cleaned = (raw ?? '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  if (!cleaned) throw new UserFacingError(502, emptyMessage);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new UserFacingError(502, 'The AI returned an unreadable response. Please try again.', {cause: err});
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UserFacingError(502, 'The AI returned an unexpected response. Please try again.');
  }
  return parsed as Record<string, unknown>;
}

export interface StructuredPromptRequest {
  model: string;
  contents: string;
  systemInstruction?: string;
  thinkingLevel: ThinkingLevel;
  responseSchema: Schema;
  /** Message shown if the model returns nothing. */
  emptyMessage: string;
  budget: RetryBudget;
  signal?: AbortSignal;
}

/** Sends a prompt that must return JSON matching `responseSchema`; returns the parsed object. */
export type GenerateStructured = (request: StructuredPromptRequest) => Promise<Record<string, unknown>>;

/** Token counts the SDK reports for a call; numbers only, so they are safe to log. */
function usageFields(response: unknown): Record<string, number | undefined> {
  const usage = (response as {usageMetadata?: Record<string, unknown>} | undefined)?.usageMetadata;
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  return {
    promptTokens: num(usage?.promptTokenCount),
    outputTokens: num(usage?.candidatesTokenCount),
    thoughtTokens: num(usage?.thoughtsTokenCount),
    totalTokens: num(usage?.totalTokenCount),
  };
}

export function createGeminiGenerator(getClient: () => GoogleGenAI = getAiClient): GenerateStructured {
  return async (request) => {
    const ai = getClient();
    geminiBudget.assertAvailable();
    const startedAt = Date.now();
    let attempts = 0;
    let response;
    try {
      response = await withRetry(
        async (abortSignal) => {
          attempts += 1;
          geminiBudget.record();
          try {
            return await ai.models.generateContent({
              model: request.model,
              contents: request.contents,
              config: {
                systemInstruction: request.systemInstruction,
                thinkingConfig: {thinkingLevel: request.thinkingLevel},
                responseMimeType: 'application/json',
                responseSchema: request.responseSchema,
                abortSignal,
              },
            });
          } catch (err) {
            if (!request.signal?.aborted) {
              log.warn('gemini_attempt_failed', {
                model: request.model,
                attempt: attempts,
                kind: abortSignal.aborted ? 'timeout' : classifyGeminiError(err),
                ...describeError(err),
              });
            }
            throw err;
          }
        },
        request.budget,
        request.signal
      );
    } catch (err) {
      if (!(err instanceof ClientAbortedError)) {
        log.error('gemini_failure', {
          model: request.model,
          attempts,
          ms: Date.now() - startedAt,
          kind: err instanceof UserFacingError && err.status === 504 ? 'timeout' : classifyGeminiError(err),
          publicStatus: mapPublicError(err).status,
          ...describeError(err),
        });
      }
      throw err;
    }
    log.info('gemini_call', {
      model: request.model,
      attempts,
      ms: Date.now() - startedAt,
      ...usageFields(response),
    });
    return parseModelJson(response.text, request.emptyMessage);
  };
}
