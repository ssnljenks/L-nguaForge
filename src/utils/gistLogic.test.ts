import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGistErrorLogEntries,
  countSummarySentences,
  formatGistCountdown,
  GIST_TIMER_SECONDS,
  pickNextAudioClip,
  segmentGistHighlights,
} from './gistLogic.ts';
import type {BriefItem, GistGradeResult} from '../types.ts';

function makeAudioClip(id: string, language: 'es' | 'pt' = 'es'): BriefItem {
  return {
    id,
    title: `Clip ${id}`,
    sourceName: 'Test Radio',
    sourceUrl: 'https://example.org',
    audioUrl: 'https://example.org/clip.mp3',
    mediaType: 'audio',
    language,
    dialectId: language === 'es' ? 'neutral_latam' : 'br_standard',
    publishedAt: '2026-11-24T12:00:00.000Z',
    ilrLevel: '2+',
    topic: 'society',
    orientationLine: 'This passage is from a radio broadcast.',
    summary: 'Summary.',
    matchingDomains: [],
    estimatedMinutes: 2,
    lengthLabel: '~2 min broadcast',
  };
}

test('formatGistCountdown and countSummarySentences handle edge cases cleanly', () => {
  assert.equal(GIST_TIMER_SECONDS, 60);
  assert.equal(formatGistCountdown(60), '1:00');
  assert.equal(formatGistCountdown(9), '0:09');
  assert.equal(formatGistCountdown(0), '0:00');
  assert.equal(formatGistCountdown(-3), '0:00');

  assert.equal(countSummarySentences(''), 0);
  assert.equal(countSummarySentences('One sentence here.'), 1);
  assert.equal(countSummarySentences('First point. Second point! Third point?'), 3);
});

test('segmentGistHighlights isolates added spans case-insensitively and merges overlaps', () => {
  const summary =
    'The Coast Guard intercepted a vessel off Colombia. Five foreign diplomats were also arrested at the harbor.';
  const segments = segmentGistHighlights(summary, [
    {
      description: 'Claimed five foreign diplomats were arrested, which is not in the broadcast.',
      learnerSpan: 'five foreign diplomats were also arrested',
      sourceQuote: 'tripulada por tres personas y sin bandera visible',
    },
  ]);

  assert.equal(segments.length, 3);
  assert.equal(segments[0].isAddition, false);
  assert.equal(segments[1].isAddition, true);
  assert.equal(segments[1].text, 'Five foreign diplomats were also arrested');
  assert.equal(segments[2].isAddition, false);
  assert.equal(segments.map((s) => s.text).join(''), summary);
});

test('pickNextAudioClip prefers unseen same-language audio clips and ignores text articles', () => {
  const pool: BriefItem[] = [
    makeAudioClip('es-a1', 'es'),
    {...makeAudioClip('es-t1', 'es'), mediaType: 'text'},
    makeAudioClip('es-a2', 'es'),
    makeAudioClip('es-a3', 'es'),
    makeAudioClip('pt-a1', 'pt'),
  ];

  const next1 = pickNextAudioClip('es-a1', pool, 'es', new Set(['es-a1', 'es-a2']));
  assert.equal(next1?.id, 'es-a3');

  // Cycles cleanly once all are seen
  const cycled = pickNextAudioClip('es-a3', pool, 'es', new Set(['es-a1', 'es-a2', 'es-a3']));
  assert.equal(cycled?.id, 'es-a1');
});

test('buildGistErrorLogEntries logs additions first with high severity, then omissions and distortions', () => {
  const grade: GistGradeResult = {
    briefId: 'es-a1',
    mainPoint: 'partial',
    keyDetails: {found: 2, total: 3, missing: ['Towed to Buenaventura']},
    additions: [
      {
        description: 'Added an unmentioned diplomatic dispute.',
        learnerSpan: 'caused a diplomatic dispute',
        sourceQuote: 'remolcada al puerto de Buenaventura',
      },
    ],
    omissions: [
      {
        description: 'Omitted that the vessel was towed to Buenaventura.',
        sourceQuote: 'La nave fue remolcada al puerto de Buenaventura',
      },
    ],
    distortions: [
      {
        description: 'Stated 180 nautical miles instead of 80.',
        learnerSpan: '180 nautical miles',
        sourceQuote: 'a unas ochenta millas náuticas de la costa',
      },
    ],
    modelGist: 'Three concise sentences.',
  };

  const entries = buildGistErrorLogEntries({id: 'es-a1', language: 'es', dialectId: 'colombian_andean'}, grade);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].category, 'addition');
  assert.equal(entries[0].severity, 'high');
  assert.equal(entries[0].learnerSpan, 'caused a diplomatic dispute');
  assert.equal(entries[1].category, 'omission');
  assert.equal(entries[1].severity, 'medium');
  assert.equal(entries[2].category, 'distortion');
  assert.equal(entries[2].briefId, 'es-a1');
});
