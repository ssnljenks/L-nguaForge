import test from 'node:test';
import assert from 'node:assert/strict';
import {ClientAbortedError, UserFacingError} from './errors.ts';
import {backoffDelayMs, parseModelJson, type RetryDeps, TIMEOUT_MESSAGE, withRetry} from './gemini.ts';

function apiError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), {status});
}

/** Deterministic deps: sleeping advances a fake clock instantly. */
function fakeDeps(): RetryDeps & {sleeps: number[]} {
  let now = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => now,
    random: () => 0,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  };
}

const BUDGET = {attemptTimeoutMs: 1_000, totalBudgetMs: 10_000, maxAttempts: 3};

test('backoffDelayMs grows exponentially with bounded jitter', () => {
  assert.equal(
    backoffDelayMs(0, () => 0),
    600
  );
  assert.equal(
    backoffDelayMs(1, () => 0),
    1200
  );
  assert.equal(
    backoffDelayMs(2, () => 0),
    2400
  );
  assert.equal(
    backoffDelayMs(0, () => 1),
    900
  );
});

test('withRetry retries transient errors with backoff, then succeeds', async () => {
  const deps = fakeDeps();
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw apiError(calls === 1 ? 503 : 429);
      return 'ok';
    },
    BUDGET,
    undefined,
    deps
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(deps.sleeps, [600, 1200]);
});

test('withRetry does not retry non-transient errors', async () => {
  const deps = fakeDeps();
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw apiError(403);
      },
      BUDGET,
      undefined,
      deps
    ),
    /HTTP 403/
  );
  assert.equal(calls, 1);
});

test('withRetry stops at maxAttempts and rethrows the last error', async () => {
  const deps = fakeDeps();
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw apiError(503);
      },
      BUDGET,
      undefined,
      deps
    ),
    /HTTP 503/
  );
  assert.equal(calls, 3);
});

test('withRetry gives up early when the next backoff would exceed the total budget', async () => {
  const deps = fakeDeps();
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw apiError(503);
      },
      {attemptTimeoutMs: 1_000, totalBudgetMs: 3_000, maxAttempts: 5},
      undefined,
      deps
    )
  );
  // t=0: 600 ms backoff + 2 s minimum attempt fits in 3 s; t=600: 1200 ms + 2 s does not.
  assert.equal(calls, 2);
});

test('withRetry aborts a hung attempt at the per-attempt timeout and reports a timeout', async () => {
  const hang = (signal: AbortSignal) =>
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true});
    });
  // AbortSignal.timeout timers are unref'd; keep the event loop alive like the HTTP server does.
  const keepAlive = setInterval(() => {}, 1_000);
  const started = Date.now();
  await assert.rejects(
    withRetry(hang, {attemptTimeoutMs: 50, totalBudgetMs: 60, maxAttempts: 3}),
    (err: unknown) => err instanceof UserFacingError && err.status === 504 && err.message === TIMEOUT_MESSAGE
  );
  assert.ok(Date.now() - started < 1_000);
  clearInterval(keepAlive);
});

test('withRetry stops immediately when the caller aborts', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        controller.abort();
        throw apiError(503);
      },
      BUDGET,
      controller.signal,
      fakeDeps()
    ),
    (err: unknown) => err instanceof ClientAbortedError
  );
  assert.equal(calls, 1);
});

test('parseModelJson strips code fences and rejects empty, invalid or non-object output', () => {
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```', 'empty'), {a: 1});
  assert.throws(() => parseModelJson('   ', 'Nothing came back.'), /Nothing came back/);
  assert.throws(() => parseModelJson('{not json', 'empty'), /unreadable/);
  assert.throws(() => parseModelJson('[1,2]', 'empty'), /unexpected/);
});
