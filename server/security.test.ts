import test from 'node:test';
import assert from 'node:assert/strict';
import type {IncomingMessage} from 'http';
import {loadConfig, parseHostList} from './config.ts';
import {getClientIp, isAllowedWebSocketOrigin} from './security.ts';

function fakeRequest(headers: Record<string, string>, remoteAddress = '10.0.0.1'): IncomingMessage {
  return {headers, socket: {remoteAddress}} as unknown as IncomingMessage;
}

test('getClientIp ignores X-Forwarded-For unless proxies are trusted', () => {
  const req = fakeRequest({'x-forwarded-for': '6.6.6.6, 203.0.113.9'});
  assert.equal(getClientIp(req, 0), '10.0.0.1');
  // One trusted hop: the proxy appended the real client as the last entry.
  assert.equal(getClientIp(req, 1), '203.0.113.9');
  assert.equal(getClientIp(req, 2), '6.6.6.6');
  assert.equal(getClientIp(fakeRequest({}), 1), '10.0.0.1');
});

test('isAllowedWebSocketOrigin accepts same-host and configured origins only', () => {
  const opts = {trustProxyHops: 0, extraAllowedHosts: ['app.example.com']};
  assert.equal(
    isAllowedWebSocketOrigin(fakeRequest({host: 'localhost:3000', origin: 'http://localhost:3000'}), opts),
    true
  );
  assert.equal(isAllowedWebSocketOrigin(fakeRequest({host: 'x:1', origin: 'https://app.example.com'}), opts), true);
  assert.equal(
    isAllowedWebSocketOrigin(fakeRequest({host: 'localhost:3000', origin: 'https://evil.example'}), opts),
    false
  );
  assert.equal(isAllowedWebSocketOrigin(fakeRequest({host: 'localhost:3000'}), opts), false);
  assert.equal(isAllowedWebSocketOrigin(fakeRequest({host: 'localhost:3000', origin: 'not a url'}), opts), false);
});

test('isAllowedWebSocketOrigin trusts X-Forwarded-Host only behind a trusted proxy', () => {
  const req = fakeRequest({
    host: 'internal:8080',
    'x-forwarded-host': 'public.run.app',
    origin: 'https://public.run.app',
  });
  assert.equal(isAllowedWebSocketOrigin(req, {trustProxyHops: 0, extraAllowedHosts: []}), false);
  assert.equal(isAllowedWebSocketOrigin(req, {trustProxyHops: 1, extraAllowedHosts: []}), true);
});

test('loadConfig applies defaults and parses overrides', () => {
  const defaults = loadConfig({});
  assert.equal(defaults.isProduction, false);
  assert.equal(defaults.port, 3000);
  assert.equal(defaults.trustProxyHops, 1);
  assert.equal(defaults.apiRateLimitPerMinute, 40);
  assert.deepEqual(defaults.frameAncestors, ["'self'", 'https://aistudio.google.com']);

  const custom = loadConfig({
    NODE_ENV: 'production',
    TRUST_PROXY: '0',
    API_RATE_LIMIT_PER_MINUTE: 'oops',
    APP_URL: 'MY_APP_URL',
    ALLOWED_ORIGINS: 'https://a.example, https://b.example:8443',
  });
  assert.equal(custom.isProduction, true);
  assert.equal(custom.trustProxyHops, 0);
  assert.equal(custom.apiRateLimitPerMinute, 40, 'invalid numbers fall back to the default');
  assert.deepEqual(custom.extraAllowedHosts, ['a.example', 'b.example:8443']);
});

test('parseHostList ignores placeholders and malformed entries', () => {
  assert.deepEqual(parseHostList('MY_APP_URL, https://ok.example/path'), ['ok.example']);
  assert.deepEqual(parseHostList(undefined), []);
});
