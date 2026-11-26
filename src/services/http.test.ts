import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {getJson, postJson} from './http.ts';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('getJson returns the parsed body and surfaces the server error message (REVIEW L-5)', async () => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    assert.equal(init?.method, 'GET');
    assert.ok(init?.signal, 'requests carry an abort signal for the timeout');
    if (String(url).includes('missing')) {
      return new Response(JSON.stringify({error: 'Brief item "x" not found.'}), {status: 404});
    }
    if (String(url).includes('broken')) return new Response('<html>502</html>', {status: 502});
    return new Response(JSON.stringify({items: [], lastRefreshedAt: 't'}), {status: 200});
  }) as typeof fetch;

  assert.deepEqual(await getJson('/api/brief/feed?language=es'), {items: [], lastRefreshedAt: 't'});
  await assert.rejects(getJson('/api/brief/study-excerpt?briefId=missing'), /Brief item "x" not found\./);
  await assert.rejects(getJson('/api/brief/broken'), /Request failed \(502\)/);
});

test('getJson and postJson time out with a retryable message (REVIEW L-5)', async () => {
  globalThis.fetch = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as typeof fetch;
  await assert.rejects(getJson('/api/brief/feed', 20), /Request timed out\. Tap Retry/);
  await assert.rejects(postJson('/api/brief/refresh', {}, 20), /Request timed out\. Tap Retry/);
});
