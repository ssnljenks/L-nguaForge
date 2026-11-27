import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {createApp, jsonErrorHandler} from '../../server/app.ts';
import {loadConfig} from '../../server/config.ts';
import type {GenerateStructured} from '../../server/gemini.ts';
import {BudgetExceededError, createEvalGenerator, type CallContext, type CallRecord, type Runtime} from './llm.ts';
import type {CaseResult, Check} from './types.ts';
import {casePassed} from './types.ts';

export class FatalEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalEvalError';
  }
}

export interface ApiResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

export interface EvalApi {
  post(path: string, body: unknown): Promise<ApiResponse>;
  generate: GenerateStructured;
  records: CallRecord[];
  close(): Promise<void>;
}

/**
 * Mounts the real production app (all routes, validation and prompt builders) on a private port with a
 * generator wrapped by cache + budget. One instance per eval item so call records stay attributable.
 */
export async function openApi(rt: Runtime, ctx: CallContext): Promise<EvalApi> {
  const records: CallRecord[] = [];
  const generate = createEvalGenerator(rt, ctx, records);
  const config = {...loadConfig({TRUST_PROXY: '0'}), apiRateLimitPerMinute: 1_000_000};
  const app = createApp({config, generate});
  app.use(jsonErrorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  return {
    generate,
    records,
    async post(path, body) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = {error: text};
      }
      const message = String((json as {error?: unknown})?.error ?? '');
      if (res.status === 403 || /GEMINI_API_KEY is not configured/.test(message)) {
        throw new FatalEvalError(`Gemini auth/config failure: ${message}`);
      }
      return {status: res.status, json};
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Eval-side helper calls (candidate simulator, judges, blind answerers) with no HTTP server. */
export function openHelper(rt: Runtime, ctx: CallContext): {generate: GenerateStructured; records: CallRecord[]} {
  const records: CallRecord[] = [];
  return {generate: createEvalGenerator(rt, ctx, records), records};
}

export async function withApi<T>(rt: Runtime, ctx: CallContext, fn: (api: EvalApi) => Promise<T>): Promise<T> {
  const api = await openApi(rt, ctx);
  try {
    return await fn(api);
  } finally {
    await api.close();
  }
}

/** Bounded-concurrency map that preserves order. */
export async function pMap<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, i: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({length: Math.max(1, Math.min(concurrency, items.length))}, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Runs one eval case. Budget exhaustion marks the case "not run"; auth failures abort the whole run;
 * any other exception (e.g. the model returned unusable output) is a failed `no_crash` check.
 */
export async function runCase(
  id: string,
  label: string,
  fn: () => Promise<{checks: Check[]; example?: string}>
): Promise<CaseResult> {
  try {
    const {checks, example} = await fn();
    return {id, label, checks, example};
  } catch (err) {
    if (err instanceof BudgetExceededError) return {id, label, checks: [], notRun: err.message};
    if (err instanceof FatalEvalError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    return {
      id,
      label,
      checks: [{id: 'no_crash', passed: false, detail: message.slice(0, 300)}],
      example: message.slice(0, 200),
    };
  }
}

export function passRate(cases: readonly CaseResult[]): {passed: number; run: number; rate: number} {
  const run = cases.filter((c) => !c.notRun);
  const passed = run.filter(casePassed).length;
  return {passed, run: run.length, rate: run.length ? passed / run.length : 0};
}

/** Throws if the route did not return 200, so a bad response becomes a failed `no_crash` check. */
export function okJson(res: ApiResponse, what: string): Record<string, any> {
  if (res.status !== 200)
    throw new Error(`${what} returned HTTP ${res.status}: ${String(res.json?.error ?? '').slice(0, 200)}`);
  return res.json;
}
