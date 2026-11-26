import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {BriefService, NOT_DRILLABLE_MESSAGE, type SourceFeedConfig} from './briefService.ts';
import type {GenerateStructured} from './gemini.ts';

const PUBLISHER_TEXT =
  'El gobierno anunció este martes un plan para ampliar la red de bibliotecas públicas en los barrios. ' +
  'La medida incluye horarios extendidos los fines de semana, talleres de lectura para niños y acceso gratuito a internet. ' +
  'Según el ministerio, la iniciativa costará doce millones de pesos y comenzará en marzo en cinco ciudades del país.';

function rss(items: string): string {
  return `<?xml version="1.0"?><rss><channel>${items}</channel></rss>`;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function serviceWith(sources: SourceFeedConfig[], xmlBySourceUrl: Record<string, string>): BriefService {
  const svc = new BriefService();
  (svc as unknown as {sources: SourceFeedConfig[]}).sources = sources;
  globalThis.fetch = (async (url: string) =>
    new Response(xmlBySourceUrl[String(url)] ?? '', {
      status: 200,
      headers: {'content-type': 'application/rss+xml'},
    })) as typeof fetch;
  return svc;
}

/** A model that tries to write its own passage; the service must ignore it. */
const generate: GenerateStructured = async () => ({
  ilrLevel: '2',
  topic: 'society',
  orientationLine: 'This passage is from a news report on public libraries.',
  summary: 'The government will expand public libraries.',
  studyExcerpt: 'TEXTO INVENTADO POR EL MODELO que no aparece en la fuente.',
  keyVocabulary: [
    {term: 'bibliotecas públicas', english: 'public libraries'},
    {term: 'palabra inventada', english: 'invented word'},
  ],
  estimatedMinutes: 2,
});

const textSource: SourceFeedConfig = {
  id: 't',
  name: 'Diario Test',
  url: 'https://news.test/rss',
  language: 'es',
  dialectId: 'neutral_latam',
  mediaType: 'text',
};
const audioSource: SourceFeedConfig = {
  ...textSource,
  id: 'a',
  name: 'Radio Test',
  url: 'https://radio.test/rss',
  mediaType: 'audio',
};

test('text feed items use the publisher text as the passage, never model-written text (REVIEW C-2)', async () => {
  const svc = serviceWith([textSource], {
    [textSource.url]: rss(
      `<item><title>Bibliotecas</title><link>https://news.test/a1</link><description><![CDATA[<p>${PUBLISHER_TEXT}</p>]]></description></item>`
    ),
  });
  const outcome = await svc.refreshFeeds(generate);
  assert.equal(outcome.newItemsCount, 1);
  const item = svc.getFeed({language: 'es', mediaType: 'text'}).items.find((i) => i.sourceName === 'Diario Test');
  assert.ok(item);
  assert.equal(item.drillable, true);
  const study = svc.getStudyExcerpt(item.id);
  assert.ok(study);
  assert.equal(study.excerpt, PUBLISHER_TEXT);
  assert.ok(!study.excerpt.includes('INVENTADO'));
  // Vocabulary that does not occur in the source text is dropped.
  assert.deepEqual(
    study.keyVocabulary.map((v) => v.term),
    ['bibliotecas públicas']
  );
});

test('feed audio items without a transcript are not drillable and drill/gist refuse them (REVIEW C-2)', async () => {
  const svc = serviceWith([audioSource], {
    [audioSource.url]: rss(
      `<item><title>Boletín</title><link>https://radio.test/e1</link><description>${PUBLISHER_TEXT}</description>` +
        `<enclosure url="https://radio.test/e1.mp3" type="audio/mpeg"/></item>`
    ),
  });
  await svc.refreshFeeds(generate);
  const item = svc.getFeed({language: 'es', mediaType: 'audio'}).items.find((i) => i.sourceName === 'Radio Test');
  assert.ok(item);
  assert.equal(item.drillable, false);
  let calls = 0;
  const countingGenerate: GenerateStructured = async (req) => {
    calls++;
    return generate(req);
  };
  await assert.rejects(
    svc.generateDrill(item.id, countingGenerate),
    (err: Error) => err.message === NOT_DRILLABLE_MESSAGE
  );
  await assert.rejects(
    svc.gradeGist(item.id, 'Una frase.', countingGenerate),
    (err: Error) => err.message === NOT_DRILLABLE_MESSAGE
  );
  assert.equal(calls, 0, 'no model call for non-drillable items');
});

test('very short publisher text is not drillable', async () => {
  const svc = serviceWith([textSource], {
    [textSource.url]: rss(
      `<item><title>Breve</title><link>https://news.test/short</link><description>Solo una línea corta.</description></item>`
    ),
  });
  await svc.refreshFeeds(generate);
  const item = svc.getFeed({language: 'es', mediaType: 'text'}).items.find((i) => i.title === 'Breve');
  assert.equal(item?.drillable, false);
});

test('concurrent refreshes share one run, and user refreshes are rate limited (REVIEW H-2)', async () => {
  const svc = new BriefService();
  (svc as unknown as {sources: SourceFeedConfig[]}).sources = [textSource, audioSource];
  let fetches = 0;
  let modelCalls = 0;
  globalThis.fetch = (async () => {
    fetches++;
    await new Promise((r) => setTimeout(r, 20));
    return new Response(
      rss(
        `<item><title>X</title><link>https://news.test/x${fetches}</link><description>${PUBLISHER_TEXT}</description></item>`
      ),
      {status: 200}
    );
  }) as typeof fetch;
  const countingGenerate: GenerateStructured = async (req) => {
    modelCalls++;
    return generate(req);
  };

  // Three simultaneous callers -> one pass over the 2 feeds, one analysis per new item.
  const results = await Promise.all([
    svc.requestRefresh(countingGenerate),
    svc.requestRefresh(countingGenerate),
    svc.refreshFeeds(countingGenerate),
  ]);
  assert.equal(fetches, 2);
  assert.equal(modelCalls, 1, 'only the text item is new and analyzed (the audio item has no enclosure)');
  assert.equal(results[0], results[1]);

  // Right after it finished, a user refresh is skipped: no outbound requests.
  const again = await svc.requestRefresh(countingGenerate);
  assert.equal(again.skipped, true);
  assert.equal(fetches, 2);

  // After the cooldown it runs again.
  const later = await svc.requestRefresh(countingGenerate, 10 * 60 * 1000, Date.now() + 11 * 60 * 1000);
  assert.notEqual(later.skipped, true);
  assert.equal(fetches, 4);
});
