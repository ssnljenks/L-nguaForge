import {XMLParser} from 'fast-xml-parser';
import type {BriefMediaType} from '../src/types.ts';

/**
 * RSS 2.0 / RSS 1.0 / Atom parsing with a real XML parser (REVIEW L-2).
 *
 * Two layers of escaping are handled in order, each exactly once: the XML parser resolves XML
 * entities and character references (with fast-xml-parser's entity-expansion limits), then fields
 * that carry HTML (descriptions, Atom type="html" content, and in practice titles) have their tags
 * stripped and HTML entities decoded. CDATA content skips the XML layer, as it should.
 */

export interface RawFeedItem {
  title: string;
  link: string;
  description: string;
  pubDate?: string;
  audioUrl?: string;
  durationSeconds?: number;
}

/** HTML named entities that occur in Spanish/Portuguese news text (Latin-1 plus typography). */
const NAMED_ENTITIES: Record<string, number> = {
  AElig: 198,
  Aacute: 193,
  Acirc: 194,
  Agrave: 192,
  Aring: 197,
  Atilde: 195,
  Auml: 196,
  Ccedil: 199,
  Dagger: 8225,
  ETH: 208,
  Eacute: 201,
  Ecirc: 202,
  Egrave: 200,
  Euml: 203,
  Iacute: 205,
  Icirc: 206,
  Igrave: 204,
  Iuml: 207,
  Ntilde: 209,
  OElig: 338,
  Oacute: 211,
  Ocirc: 212,
  Ograve: 210,
  Oslash: 216,
  Otilde: 213,
  Ouml: 214,
  Prime: 8243,
  Scaron: 352,
  THORN: 222,
  Uacute: 218,
  Ucirc: 219,
  Ugrave: 217,
  Uuml: 220,
  Yacute: 221,
  Yuml: 376,
  aacute: 225,
  acirc: 226,
  acute: 180,
  aelig: 230,
  agrave: 224,
  amp: 38,
  aring: 229,
  atilde: 227,
  auml: 228,
  bdquo: 8222,
  brvbar: 166,
  bull: 8226,
  ccedil: 231,
  cedil: 184,
  cent: 162,
  circ: 710,
  copy: 169,
  curren: 164,
  dagger: 8224,
  deg: 176,
  divide: 247,
  eacute: 233,
  ecirc: 234,
  egrave: 232,
  emsp: 8195,
  ensp: 8194,
  eth: 240,
  euml: 235,
  euro: 8364,
  frac12: 189,
  frac14: 188,
  frac34: 190,
  gt: 62,
  hellip: 8230,
  iacute: 237,
  icirc: 238,
  iexcl: 161,
  igrave: 236,
  iquest: 191,
  iuml: 239,
  laquo: 171,
  ldquo: 8220,
  lrm: 8206,
  lsaquo: 8249,
  lsquo: 8216,
  lt: 60,
  macr: 175,
  mdash: 8212,
  micro: 181,
  middot: 183,
  nbsp: 160,
  ndash: 8211,
  not: 172,
  ntilde: 241,
  oacute: 243,
  ocirc: 244,
  oelig: 339,
  ograve: 242,
  ordf: 170,
  ordm: 186,
  oslash: 248,
  otilde: 245,
  ouml: 246,
  para: 182,
  permil: 8240,
  plusmn: 177,
  pound: 163,
  prime: 8242,
  quot: 34,
  raquo: 187,
  rdquo: 8221,
  reg: 174,
  rlm: 8207,
  rsaquo: 8250,
  rsquo: 8217,
  sbquo: 8218,
  scaron: 353,
  sect: 167,
  shy: 173,
  sup1: 185,
  sup2: 178,
  sup3: 179,
  szlig: 223,
  thinsp: 8201,
  thorn: 254,
  tilde: 732,
  times: 215,
  trade: 8482,
  uacute: 250,
  ucirc: 251,
  ugrave: 249,
  uml: 168,
  uuml: 252,
  yacute: 253,
  yen: 165,
  yuml: 255,
  zwj: 8205,
  zwnj: 8204,
  apos: 39,
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g,
    (whole, dec, hex, name) => {
      const code = dec ? Number(dec) : hex ? parseInt(hex, 16) : NAMED_ENTITIES[name];
      if (code === undefined || !Number.isFinite(code) || code < 1 || code > 0x10ffff) return whole;
      if (code >= 0xd800 && code <= 0xdfff) return whole;
      return String.fromCodePoint(code);
    }
  );
}

/** Plain text from an HTML fragment: tags removed first, then entities decoded once. */
export function htmlToText(html: string): string {
  return decodeHtmlEntities(html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  htmlEntities: true,
  processEntities: {enabled: true, maxEntityCount: 50, maxExpandedLength: 200_000},
  isArray: (name) => ['item', 'entry', 'link', 'enclosure', 'media:content'].includes(name),
});

type Node = Record<string, unknown>;

function asNode(value: unknown): Node {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Node) : {};
}

function asList(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Text content of an element that may be a string, a number, or {'#text': …, '@_type': …}. */
function textOf(value: unknown): string {
  const first = asList(value)[0];
  if (typeof first === 'string') return first;
  if (typeof first === 'number' || typeof first === 'boolean') return String(first);
  const text = asNode(first)['#text'];
  return typeof text === 'string' || typeof text === 'number' ? String(text) : '';
}

function linkOf(item: Node): string {
  const links = asList(item.link);
  // Atom: <link rel="alternate" href="…"/> (rel defaults to alternate).
  const atomLinks = links.map(asNode).filter((l) => typeof l['@_href'] === 'string');
  const alternate = atomLinks.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate') ?? atomLinks[0];
  if (alternate) return String(alternate['@_href']).trim();
  const rssLink = links.map(textOf).find((l) => l.trim());
  if (rssLink) return rssLink.trim();
  const guid = item.guid;
  const guidNode = asNode(guid);
  const isPermaLink = guidNode['@_isPermaLink'] !== 'false';
  const guidText = textOf(guid).trim();
  return isPermaLink && /^https?:\/\//.test(guidText) ? guidText : '';
}

function audioUrlOf(item: Node): string | undefined {
  for (const media of [...asList(item.enclosure), ...asList(item['media:content'])].map(asNode)) {
    const url = media['@_url'];
    const type = String(media['@_type'] ?? '');
    if (typeof url === 'string' && /^audio\//i.test(type)) return url.trim();
  }
  return undefined;
}

export function parseDurationSeconds(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim();
  if (/^\d+$/.test(cleaned)) return Number(cleaned);
  const parts = cleaned.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return undefined;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return undefined;
}

function capWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return `${words.slice(0, maxWords).join(' ')}…`;
}

/** Parses an RSS 2.0, RSS 1.0 (RDF) or Atom document. Invalid XML yields no items. */
export function parseFeedXml(xml: string, mediaType: BriefMediaType): RawFeedItem[] {
  let doc: Node;
  try {
    doc = asNode(parser.parse(xml));
  } catch {
    return [];
  }
  const rss = asNode(doc.rss);
  const items = [
    ...asList(asNode(rss.channel).item),
    ...asList(asNode(doc.feed).entry),
    ...asList(asNode(doc['rdf:RDF']).item),
  ].map(asNode);

  const results: RawFeedItem[] = [];
  for (const item of items) {
    const title = htmlToText(textOf(item.title));
    const link = linkOf(item);
    if (!title || !link) continue;
    const audioUrl = audioUrlOf(item);
    if (mediaType === 'audio' && !audioUrl) continue;
    const rawDescription = textOf(item.description) || textOf(item.summary) || textOf(item.content);
    const pubDate = [item.pubDate, item.published, item.updated, item['dc:date']].map(textOf).find(Boolean);
    results.push({
      title,
      link,
      description: capWords(htmlToText(rawDescription), 500),
      pubDate: pubDate || undefined,
      audioUrl: audioUrl || (mediaType === 'audio' ? link : undefined),
      durationSeconds: parseDurationSeconds(textOf(item['itunes:duration'])),
    });
  }
  return results;
}
