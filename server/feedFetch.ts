import dns from 'node:dns';
import net from 'node:net';

/**
 * Hardened fetching of publisher RSS/Atom feeds (REVIEW M-1).
 *
 * - Only http(s) URLs without credentials, to hosts that are not local, internal or placeholders.
 * - Every hop is checked: redirects are followed manually (at most MAX_FEED_REDIRECTS), and each
 *   target URL is validated and its host resolved before it is requested.
 * - Every address a host resolves to must be public: loopback, private, link-local (incl. cloud
 *   metadata), CGNAT, multicast, reserved and the IPv6 equivalents (ULA, link-local, IPv4-mapped,
 *   NAT64 of private IPv4) are refused.
 * - The response must be an XML content type and at most MAX_FEED_BYTES; larger bodies are aborted
 *   while streaming instead of being buffered.
 *
 * Residual risk: the address is checked before `fetch` resolves the host again, so a DNS answer
 * that changes in between (rebinding) is not caught. Feed URLs come from server/sources.json, not
 * from users, which keeps that window narrow.
 */

export const MAX_FEED_BYTES = 2 * 1024 * 1024;
export const MAX_FEED_REDIRECTS = 3;
export const FEED_FETCH_TIMEOUT_MS = 5000;

const XML_CONTENT_TYPE = /^(?:application|text)\/(?:[\w.+-]+\+)?(?:xml|rss|atom)(?:\+xml)?\s*(?:;|$)/i;

const BLOCKED: net.BlockList = (() => {
  const list = new net.BlockList();
  const v4: [string, number][] = [
    ['0.0.0.0', 8], // "this" network
    ['10.0.0.0', 8],
    ['100.64.0.0', 10], // CGNAT
    ['127.0.0.0', 8],
    ['169.254.0.0', 16], // link-local, incl. 169.254.169.254 metadata
    ['172.16.0.0', 12],
    ['192.0.0.0', 24], // IETF protocol assignments
    ['192.0.2.0', 24], // TEST-NET-1
    ['192.88.99.0', 24], // 6to4 relay anycast
    ['192.168.0.0', 16],
    ['198.18.0.0', 15], // benchmarking
    ['198.51.100.0', 24], // TEST-NET-2
    ['203.0.113.0', 24], // TEST-NET-3
    ['224.0.0.0', 4], // multicast
    ['240.0.0.0', 4], // reserved + broadcast
  ];
  for (const [addr, prefix] of v4) list.addSubnet(addr, prefix, 'ipv4');
  const v6: [string, number][] = [
    ['::', 128], // unspecified
    ['::1', 128], // loopback
    ['100::', 64], // discard
    ['2001:db8::', 32], // documentation
    ['fc00::', 7], // unique local
    ['fe80::', 10], // link-local
    ['fec0::', 10], // site-local (deprecated)
    ['ff00::', 8], // multicast
  ];
  for (const [addr, prefix] of v6) list.addSubnet(addr, prefix, 'ipv6');
  return list;
})();

/** IPv4 embedded in an IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible or NAT64 (64:ff9b::/96) IPv6 address. */
function embeddedIpv4(ipv6: string): string | null {
  const lower = ipv6.toLowerCase();
  const dotted = /^(?:::ffff:|::|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (dotted) return dotted[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

/** True for any address a server-side feed fetch must never reach. Non-IP strings count as private. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const family = net.isIP(ip);
  if (family === 4) return BLOCKED.check(ip, 'ipv4');
  if (family === 6) {
    const v4 = embeddedIpv4(ip);
    if (v4 && net.isIPv4(v4)) return BLOCKED.check(v4, 'ipv4');
    return BLOCKED.check(ip, 'ipv6');
  }
  return true;
}

/**
 * Synchronous URL check: http(s), no credentials, not a local/internal/placeholder host, and not a
 * private IP literal. The host's DNS answers are checked separately by `assertPublicHost`.
 */
export function isSafeFeedUrl(urlString: string): boolean {
  let u: URL;
  try {
    u = new URL(urlString);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;

  const hostname = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname) return false;
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa') ||
    !hostname.includes('.') // single-label names resolve via search domains to internal hosts
  ) {
    if (!net.isIP(hostname.replace(/^\[|\]$/g, ''))) return false;
  }
  // Placeholder domains never serve feeds; skip them without a network timeout.
  if (/(?:^|\.)example\.(?:com|org|net)$/.test(hostname) || hostname.includes('placeholder')) return false;

  const literal = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(literal)) return !isPrivateAddress(literal);
  return true;
}

export type ResolveHost = (hostname: string) => Promise<string[]>;

export const resolveHostWithDns: ResolveHost = async (hostname) => {
  const results = await dns.promises.lookup(hostname, {all: true, verbatim: true});
  return results.map((r) => r.address);
};

export class FeedFetchError extends Error {}

/** Resolves the URL's host and requires every address to be public. */
export async function assertPublicHost(url: URL, resolveHost: ResolveHost): Promise<void> {
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(literal) ? [literal] : await resolveHost(literal);
  if (addresses.length === 0) throw new FeedFetchError(`No addresses for ${literal}`);
  const bad = addresses.find(isPrivateAddress);
  if (bad) throw new FeedFetchError(`${literal} resolves to a non-public address`);
}

export interface FeedFetchOptions {
  fetchImpl?: typeof fetch;
  resolveHost?: ResolveHost;
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
}

/** Fetches a feed with per-hop URL/DNS validation, an XML content-type check and a body cap. */
export async function fetchFeedXml(startUrl: string, options: FeedFetchOptions = {}): Promise<string> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const resolveHost = options.resolveHost ?? resolveHostWithDns;
  const maxBytes = options.maxBytes ?? MAX_FEED_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_FEED_REDIRECTS;
  const signal = AbortSignal.timeout(options.timeoutMs ?? FEED_FETCH_TIMEOUT_MS);

  let url = startUrl;
  for (let hop = 0; ; hop++) {
    if (!isSafeFeedUrl(url)) throw new FeedFetchError(`Unsafe feed URL: ${url}`);
    const parsed = new URL(url);
    await assertPublicHost(parsed, resolveHost);

    const res = await fetchImpl(parsed.href, {
      redirect: 'manual',
      signal,
      headers: {
        'User-Agent': 'LinguaForge/1.0 (RSS Aggregator; Educational)',
        Accept: 'application/rss+xml, application/atom+xml, text/xml, application/xml',
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await res.body?.cancel().catch(() => {});
      if (!location) throw new FeedFetchError(`Redirect without Location from ${parsed.href}`);
      if (hop >= maxRedirects) throw new FeedFetchError('Too many redirects');
      url = new URL(location, parsed).href;
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new FeedFetchError(`HTTP ${res.status} from ${parsed.href}`);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!XML_CONTENT_TYPE.test(contentType)) {
      await res.body?.cancel().catch(() => {});
      throw new FeedFetchError(`Not an XML feed (content-type "${contentType}")`);
    }
    const declaredLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw new FeedFetchError('Feed too large');
    }

    const bytes = await readCapped(res, maxBytes);
    return decodeFeed(bytes, contentType);
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new FeedFetchError('Feed too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Decodes with the charset from the header or the XML declaration (many Latin feeds use ISO-8859-1). */
function decodeFeed(bytes: Uint8Array, contentType: string): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const charset =
    /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType)?.[1] ?? /<\?xml[^>]*encoding=["']([\w.:-]+)["']/i.exec(head)?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
