import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeErrorTaxonomyKey} from '../src/data/errorTaxonomy.ts';
import {getTutorById, TUTORS} from '../src/data/tutors.ts';
import {loadOpiTranscripts, readJson} from './lib/data.ts';

test('OPI transcripts: 15 Spanish + 10 Portuguese, valid levels, alternating turns, tricky cases present', () => {
  const all = loadOpiTranscripts();
  assert.equal(all.filter((t) => t.language === 'es').length, 15);
  assert.equal(all.filter((t) => t.language === 'pt').length, 10);
  for (const t of all) {
    assert.ok(['1', '1+', '2', '2+', '3'].includes(t.expected), t.id);
    assert.ok(t.turns.length >= 10 && t.turns[0].role === 'examiner', t.id);
    t.turns.forEach((turn, i) => assert.equal(turn.role, i % 2 === 0 ? 'examiner' : 'candidate', `${t.id} turn ${i}`));
  }
  for (const level of ['1', '1+', '2', '2+', '3'])
    assert.ok(
      all.some((t) => t.expected === level && t.language === 'es'),
      `es ${level}`
    );
  const tags = all.flatMap((t) => t.tags).join(' ');
  for (const k of ['fluent-but-inaccurate', 'accurate-but-cannot-hypothesize', 'strong-L2-with-one-good-L3-turn'])
    assert.ok(tags.includes(k), k);
});

test('gist cases: planted spans occur verbatim and additions are numerous enough for a 90% bar', () => {
  const g = readJson<{
    passages: {id: string}[];
    summaries: {id: string; passageId: string; summary: string; planted: {type: string; span?: string}[]}[];
  }>('gist_cases.json');
  assert.equal(g.summaries.length, 20);
  const ids = new Set(g.passages.map((p) => p.id));
  for (const s of g.summaries) {
    assert.ok(ids.has(s.passageId), s.id);
    for (const p of s.planted) if (p.span) assert.ok(s.summary.includes(p.span), `${s.id}: ${p.span}`);
  }
  assert.ok(g.summaries.flatMap((s) => s.planted).filter((p) => p.type === 'addition').length >= 10);
});

test('taxonomy sentences: 30 labeled, keys exist for the language', () => {
  const rows = readJson<{id: string; language: 'es' | 'pt'; expected: string[]}[]>('taxonomy_sentences.json');
  assert.equal(rows.length, 30);
  for (const r of rows)
    for (const k of r.expected) assert.ok(normalizeErrorTaxonomyKey(k, r.language), `${r.id}: ${k}`);
});

test('DLPT passages: 20, original, within the length range; injections: 20 with unique ids', () => {
  const p = readJson<{id: string; text: string}[]>('dlpt_passages.json');
  assert.equal(p.length, 20);
  for (const x of p) assert.ok(x.text.split(/\s+/).length >= 60, x.id);
  const inj = readJson<{id: string}[]>('injections.json');
  assert.equal(new Set(inj.map((i) => i.id)).size, 20);
});

test('talk conversations: five per tutor, every tutor exists, slang pair shares learner lines', () => {
  const c =
    readJson<{id: string; tutorId: string; kind: string; slangLevel: number; learnerTurns: string[]}[]>(
      'talk_conversations.json'
    );
  for (const t of TUTORS) assert.equal(c.filter((x) => x.tutorId === t.id).length, 5, t.id);
  for (const x of c) assert.ok(getTutorById(x.tutorId));
  for (const t of TUTORS) {
    const mine = c.filter((x) => x.tutorId === t.id);
    const a = mine.find((x) => x.kind === 'slang0')!;
    const b = mine.find((x) => x.kind === 'slang4')!;
    assert.deepEqual(a.learnerTurns, b.learnerTurns);
    assert.equal(a.slangLevel, 0);
    assert.equal(b.slangLevel, 4);
  }
});
