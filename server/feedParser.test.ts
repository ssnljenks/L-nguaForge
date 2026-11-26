import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeHtmlEntities, htmlToText, parseFeedXml} from './feedParser.ts';

const rss = (items: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Feed</title>${items}</channel></rss>`;

test('numeric and named entities decode once, without double-decoding (REVIEW L-2)', () => {
  const [item] = parseFeedXml(
    rss(
      `<item><title>Acci&#243;n &amp; reacci&#xF3;n en S&#227;o Paulo</title><link>https://news.test/1</link>` +
        `<description>Caf&amp;eacute; con a&amp;ntilde;o &#8212; &amp;quot;ol&amp;eacute;&amp;quot;. Tom &amp;amp; Jerry. Literal &amp;amp;lt;b&amp;amp;gt; text.</description></item>`
    ),
    'text'
  );
  assert.equal(item.title, 'Acción & reacción en São Paulo');
  assert.equal(item.description, 'Café con año — "olé". Tom & Jerry. Literal &lt;b&gt; text.');
});

test('escaped HTML in descriptions and Atom content is stripped to text (REVIEW L-2)', () => {
  const [rssItem] = parseFeedXml(
    rss(
      `<item><title>T</title><link>https://news.test/2</link><description>&lt;p&gt;Primer &lt;b&gt;p&#225;rrafo&lt;/b&gt;.&lt;/p&gt;&lt;p&gt;Segundo&amp;nbsp;p&amp;aacute;rrafo.&lt;/p&gt;</description></item>`
    ),
    'text'
  );
  assert.equal(rssItem.description, 'Primer párrafo . Segundo párrafo.');

  const [atom] = parseFeedXml(
    `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Not&#237;cia</title>` +
      `<link rel="enclosure" href="https://news.test/a.mp3"/><link rel="alternate" href="https://news.test/e"/>` +
      `<content type="html">&lt;p&gt;Texto &amp;amp; m&#225;s&lt;/p&gt;</content><updated>2026-11-03T10:00:00Z</updated></entry></feed>`,
    'text'
  );
  assert.deepEqual(atom, {
    title: 'Notícia',
    link: 'https://news.test/e',
    description: 'Texto & más',
    pubDate: '2026-11-03T10:00:00Z',
    audioUrl: undefined,
    durationSeconds: undefined,
  });
});

test('CDATA content is taken verbatim and only HTML-decoded (REVIEW L-2)', () => {
  const [item] = parseFeedXml(
    rss(
      `<item><title><![CDATA[Elecciones & <em>debate</em>]]></title><link><![CDATA[https://news.test/3]]></link>` +
        `<description><![CDATA[<p>Caf&eacute; &amp; t&#233;</p>]]></description><dc:date>2026-11-01</dc:date></item>`
    ),
    'text'
  );
  assert.equal(item.title, 'Elecciones & debate');
  assert.equal(item.link, 'https://news.test/3');
  assert.equal(item.description, 'Café & té');
  assert.equal(item.pubDate, '2026-11-01');
});

test('RSS 1.0, guid permalinks, audio enclosures and durations (REVIEW L-2)', () => {
  const rdf = parseFeedXml(
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/"><item><title>R</title><link>https://news.test/r</link><description>d</description></item></rdf:RDF>`,
    'text'
  );
  assert.equal(rdf[0].link, 'https://news.test/r');

  const [guidItem] = parseFeedXml(rss(`<item><title>G</title><guid>https://news.test/g</guid></item>`), 'text');
  assert.equal(guidItem.link, 'https://news.test/g');
  assert.equal(
    parseFeedXml(rss(`<item><title>G</title><guid isPermaLink="false">https://news.test/g</guid></item>`), 'text')
      .length,
    0
  );

  const audio = parseFeedXml(
    rss(
      `<item><title>A</title><link>https://radio.test/1</link><enclosure url="https://radio.test/i.jpg" type="image/jpeg"/><enclosure url="https://radio.test/1.mp3" type="audio/mpeg" length="1"/><itunes:duration>1:02:03</itunes:duration></item>` +
        `<item><title>B</title><link>https://radio.test/2</link></item>`
    ),
    'audio'
  );
  assert.deepEqual(
    audio.map((i) => [i.title, i.audioUrl, i.durationSeconds]),
    [['A', 'https://radio.test/1.mp3', 3723]]
  );
});

test('malformed XML and entity bombs yield no items instead of throwing or hanging (REVIEW L-2)', () => {
  assert.deepEqual(parseFeedXml('not xml at all <<<', 'text'), []);
  const bomb =
    '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lollollollollollollollollollol">' +
    Array.from({length: 8}, (_, i) => `<!ENTITY lol${i + 1} "${`&lol${i || ''};`.repeat(10)}">`).join('') +
    ']><rss><channel><item><title>&lol8;</title><link>https://news.test/b</link></item></channel></rss>';
  const started = Date.now();
  const items = parseFeedXml(bomb, 'text');
  assert.ok(Date.now() - started < 2000);
  assert.ok(items.every((i) => i.title.length < 300_000));
});

test('htmlToText and decodeHtmlEntities leave unknown entities alone', () => {
  assert.equal(decodeHtmlEntities('&unknown; &#0; &#xD800; &eacute;'), '&unknown; &#0; &#xD800; é');
  assert.equal(htmlToText('<p>a</p><!-- c --><br/>b'), 'a b');
});
