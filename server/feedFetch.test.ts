import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchFeedXml, isPrivateAddress, isSafeFeedUrl, MAX_FEED_BYTES, type ResolveHost} from './feedFetch.ts';

const RSS =
  '<?xml version="1.0"?><rss><channel><item><title>A</title><link>https://news.test/a</link></item></channel></rss>';
const PUBLIC_IP = '93.184.216.34';
const publicResolver: ResolveHost = async () => [PUBLIC_IP];

test('isSafeFeedUrl accepts public http(s) feeds (REVIEW M-1)', () => {
  for (const url of [
    'https://feeds.bbci.co.uk/mundo/rss.xml',
    'http://api.rtve.es/api/programas/36421/audios.rsst',
    'https://www.clarin.com/rss/lo-ultimo/',
    `https://${PUBLIC_IP}/feed.xml`,
    'https://[2606:4700::1111]/feed',
    'https://news.test:8443/rss',
  ]) {
    assert.equal(isSafeFeedUrl(url), true, url);
  }
});

test('isSafeFeedUrl rejects local, private, credentialed and placeholder URLs (REVIEW M-1)', () => {
  for (const url of [
    'ftp://feeds.example.org/rss',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
    'http://localhost/feed',
    'http://LOCALHOST./feed',
    'http://app.localhost/feed',
    'http://printer.local/feed',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://metadata/computeMetadata/v1/',
    'http://router.home.arpa/',
    'http://127.0.0.1/',
    'http://127.1.2.3/',
    'http://2130706433/', // 127.0.0.1 as a decimal
    'http://0x7f000001/',
    'http://0.0.0.0/',
    'http://10.1.2.3/',
    'http://172.20.0.1/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/',
    'http://224.0.0.1/',
    'http://[::1]/',
    'http://[::]/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:a9fe:a9fe]/', // 169.254.169.254 mapped
    'http://[64:ff9b::10.0.0.1]/',
    'https://user:pass@feeds.bbci.co.uk/rss.xml',
    'https://example.com/placeholder-rss.xml',
    'https://feeds.example.org/rss',
    'https://placeholder-feed.news/rss',
  ]) {
    assert.equal(isSafeFeedUrl(url), false, url);
  }
});

test('isPrivateAddress covers IPv4 and IPv6 ranges (REVIEW M-1)', () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.5',
    '172.31.255.255',
    '192.168.0.1',
    '169.254.1.1',
    '100.100.0.1',
    '::1',
    'fc12::1',
    'fe80::abcd',
    '::ffff:10.0.0.1',
    'not-an-ip',
  ]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '93.184.216.34', '2606:4700::1111', '2001:4860:4860::8888']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

function stubFetch(routes: Record<string, () => Response>): {fetchImpl: typeof fetch; requested: string[]} {
  const requested: string[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    requested.push(url);
    assert.equal(init?.redirect, 'manual', 'redirects are never followed automatically');
    const route = routes[url];
    return route ? route() : new Response('not found', {status: 404});
  }) as typeof fetch;
  return {fetchImpl, requested};
}

const xmlResponse = (body: string | ReadableStream<Uint8Array> = RSS, type = 'application/rss+xml; charset=utf-8') =>
  new Response(body, {status: 200, headers: {'content-type': type}});

test('fetchFeedXml follows safe redirects and validates each hop (REVIEW M-1)', async () => {
  const {fetchImpl, requested} = stubFetch({
    'https://news.test/rss': () => new Response(null, {status: 301, headers: {location: '/v2/rss'}}),
    'https://news.test/v2/rss': () =>
      new Response(null, {status: 302, headers: {location: 'https://cdn.news.test/rss.xml'}}),
    'https://cdn.news.test/rss.xml': () => xmlResponse(),
  });
  const xml = await fetchFeedXml('https://news.test/rss', {fetchImpl, resolveHost: publicResolver});
  assert.equal(xml, RSS);
  assert.deepEqual(requested, ['https://news.test/rss', 'https://news.test/v2/rss', 'https://cdn.news.test/rss.xml']);
});

test('fetchFeedXml refuses redirects to internal targets without requesting them (REVIEW M-1)', async () => {
  for (const location of [
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost:3000/api/health',
    'file:///etc/passwd',
    'http://[::1]/',
  ]) {
    const {fetchImpl, requested} = stubFetch({
      'https://news.test/rss': () => new Response(null, {status: 302, headers: {location}}),
    });
    await assert.rejects(
      fetchFeedXml('https://news.test/rss', {fetchImpl, resolveHost: publicResolver}),
      /Unsafe feed URL/
    );
    assert.deepEqual(requested, ['https://news.test/rss'], location);
  }
});

test('fetchFeedXml refuses hosts that resolve to private addresses, on any hop (REVIEW M-1)', async () => {
  const resolveHost: ResolveHost = async (host) =>
    host === 'rebind.news.test' ? [PUBLIC_IP, '10.0.0.7'] : [PUBLIC_IP];
  const {fetchImpl, requested} = stubFetch({
    'https://news.test/rss': () =>
      new Response(null, {status: 307, headers: {location: 'https://rebind.news.test/rss'}}),
  });
  await assert.rejects(fetchFeedXml('https://news.test/rss', {fetchImpl, resolveHost}), /non-public address/);
  assert.deepEqual(requested, ['https://news.test/rss']);

  const v6: ResolveHost = async () => ['fd00::5'];
  await assert.rejects(fetchFeedXml('https://news.test/rss', {fetchImpl, resolveHost: v6}), /non-public address/);
});

test('fetchFeedXml stops after too many redirects (REVIEW M-1)', async () => {
  const {fetchImpl, requested} = stubFetch({
    'https://news.test/a': () => new Response(null, {status: 301, headers: {location: '/b'}}),
    'https://news.test/b': () => new Response(null, {status: 301, headers: {location: '/a'}}),
  });
  await assert.rejects(
    fetchFeedXml('https://news.test/a', {fetchImpl, resolveHost: publicResolver}),
    /Too many redirects/
  );
  assert.equal(requested.length, 4);
});

test('fetchFeedXml requires an XML content type (REVIEW M-1)', async () => {
  for (const type of ['text/html; charset=utf-8', 'application/json', 'text/plain', 'application/octet-stream', '']) {
    const {fetchImpl} = stubFetch({'https://news.test/rss': () => xmlResponse(RSS, type)});
    await assert.rejects(
      fetchFeedXml('https://news.test/rss', {fetchImpl, resolveHost: publicResolver}),
      /Not an XML feed/,
      type
    );
  }
  for (const type of [
    'application/rss+xml',
    'application/atom+xml',
    'text/xml; charset=ISO-8859-1',
    'application/xml',
  ]) {
    const {fetchImpl} = stubFetch({'https://news.test/rss': () => xmlResponse(RSS, type)});
    assert.equal(await fetchFeedXml('https://news.test/rss', {fetchImpl, resolveHost: publicResolver}), RSS, type);
  }
});

test('fetchFeedXml caps the body at ~2 MB while streaming (REVIEW M-1)', async () => {
  let pulled = 0;
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += 64 * 1024;
      controller.enqueue(new Uint8Array(64 * 1024).fill(0x20));
    },
  });
  const {fetchImpl} = stubFetch({'https://news.test/rss': () => xmlResponse(endless)});
  await assert.rejects(fetchFeedXml('https://news.test/rss', {fetchImpl, resolveHost: publicResolver}), /too large/);
  assert.ok(pulled <= MAX_FEED_BYTES + 3 * 64 * 1024, `stopped reading early (${pulled} bytes)`);

  const declared = stubFetch({
    'https://news.test/rss': () =>
      new Response(RSS, {
        status: 200,
        headers: {'content-type': 'application/rss+xml', 'content-length': String(MAX_FEED_BYTES + 1)},
      }),
  });
  await assert.rejects(
    fetchFeedXml('https://news.test/rss', {fetchImpl: declared.fetchImpl, resolveHost: publicResolver}),
    /too large/
  );
});

test('fetchFeedXml decodes ISO-8859-1 feeds (REVIEW M-1)', async () => {
  const latin1 = Uint8Array.from(
    [...'<rss><title>Informaci']
      .map((c) => c.charCodeAt(0))
      .concat([0xf3, 0x6e])
      .concat([...'</title></rss>'].map((c) => c.charCodeAt(0)))
  );
  const {fetchImpl} = stubFetch({
    'https://news.test/rss': () =>
      new Response(latin1, {status: 200, headers: {'content-type': 'text/xml; charset=ISO-8859-1'}}),
  });
  assert.match(await fetchFeedXml('https://news.test/rss', {fetchImpl, resolveHost: publicResolver}), /Información/);
});
