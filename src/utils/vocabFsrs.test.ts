import assert from 'node:assert/strict';
import test from 'node:test';
import type {VocabItem} from '../types.ts';
import {
  formatDueSummary,
  getDueVocabCards,
  getFsrsIntervalPreviews,
  isVocabCardDueToday,
  migrateVocabItemToFsrs,
  reviewVocabCardWithFsrs,
  sortVocabDeckByFsrs,
} from './vocabFsrs.ts';

const NOW = Date.parse('2026-11-24T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function makeItem(overrides: Partial<VocabItem> = {}): VocabItem {
  return {
    id: 'v-1',
    term: 'no obstante',
    englishConcept: 'nevertheless',
    contextSentence: 'No obstante, el plan sigue vigente.',
    registerTag: 'Formal',
    category: 'High-Register Connectors',
    language: 'es',
    dialect: 'neutral_latam',
    createdAt: new Date(NOW - 5 * DAY).toISOString(),
    mastery: 'new',
    reviewCount: 0,
    ...overrides,
  };
}

test('migrateVocabItemToFsrs keeps new unreviewed cards due immediately', () => {
  const item = makeItem({mastery: 'new', reviewCount: 0});
  const fsrs = migrateVocabItemToFsrs(item, NOW);

  assert.equal(fsrs.state, 'new');
  assert.equal(fsrs.reps, 0);
  assert.equal(isVocabCardDueToday({...item, fsrs}, NOW), true);
});

test('migrateVocabItemToFsrs preserves review counts for practicing and mastered legacy items', () => {
  const practicing = makeItem({id: 'v-p', mastery: 'practicing', reviewCount: 2});
  const pFsrs = migrateVocabItemToFsrs(practicing, NOW);
  assert.ok(pFsrs.reps >= 2);
  assert.ok(pFsrs.stability > 0);

  const mastered = makeItem({
    id: 'v-m',
    mastery: 'mastered',
    reviewCount: 5,
    createdAt: new Date(NOW - 14 * DAY).toISOString(),
  });
  const mFsrs = migrateVocabItemToFsrs(mastered, NOW);
  assert.ok(mFsrs.reps >= 5);
  assert.ok(mFsrs.stability > pFsrs.stability, 'mastered card should have higher FSRS stability than practicing card');
  assert.equal(mFsrs.state, 'review');
  assert.ok(Date.parse(mFsrs.dueAt) > NOW, 'recently mastered card should be scheduled in the future');
});

test('reviewVocabCardWithFsrs schedules longer intervals for Easy > Good > Hard > Again', () => {
  const base = makeItem({mastery: 'new', reviewCount: 0});
  const again = reviewVocabCardWithFsrs(base, 'again', NOW);
  const hard = reviewVocabCardWithFsrs(base, 'hard', NOW);
  const good = reviewVocabCardWithFsrs(base, 'good', NOW);
  const easy = reviewVocabCardWithFsrs(base, 'easy', NOW);

  assert.equal(again.mastery, 'new');
  assert.equal(good.mastery, 'practicing');
  assert.equal(easy.mastery, 'mastered');
  assert.equal(good.reviewCount, 1);

  assert.ok(Date.parse(again.fsrs!.dueAt) <= Date.parse(hard.fsrs!.dueAt));
  assert.ok(Date.parse(hard.fsrs!.dueAt) <= Date.parse(good.fsrs!.dueAt));
  assert.ok(Date.parse(good.fsrs!.dueAt) <= Date.parse(easy.fsrs!.dueAt));
  assert.ok(Date.parse(easy.fsrs!.dueAt) > NOW + DAY, 'Easy rating on a new card should graduate beyond 1 day');
});

test('getFsrsIntervalPreviews returns human-readable interval strings for all 4 ratings', () => {
  const item = makeItem();
  const previews = getFsrsIntervalPreviews(item, NOW);

  assert.match(previews.again, /^\d+(m|h|d|mo|y)$/);
  assert.match(previews.hard, /^\d+(m|h|d|mo|y)$/);
  assert.match(previews.good, /^\d+(m|h|d|mo|y)$/);
  assert.match(previews.easy, /^\d+(m|h|d|mo|y)$/);
});

test('getDueVocabCards filters by language and due date, and sortVocabDeckByFsrs puts due cards first', () => {
  const dueEs = makeItem({id: 'es-due', language: 'es', mastery: 'new', reviewCount: 0});
  const futureEs = reviewVocabCardWithFsrs(
    makeItem({id: 'es-future', language: 'es', mastery: 'new', reviewCount: 0}),
    'easy',
    NOW
  );
  const duePt = makeItem({id: 'pt-due', language: 'pt', mastery: 'new', reviewCount: 0});

  const dueOnly = getDueVocabCards([futureEs, duePt, dueEs], 'es', NOW);
  assert.deepEqual(
    dueOnly.map((i) => i.id),
    ['es-due']
  );

  const sorted = sortVocabDeckByFsrs([futureEs, dueEs], NOW);
  assert.deepEqual(
    sorted.map((i) => i.id),
    ['es-due', 'es-future']
  );
  assert.match(formatDueSummary(futureEs, NOW), /^Due /);
});
