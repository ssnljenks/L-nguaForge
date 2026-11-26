import test from 'node:test';
import assert from 'node:assert/strict';
import {SEED_VOCAB} from '../data/seedData.ts';
import type {VocabItem} from '../types.ts';
import {sanitizeVocabItems, storedVocabNeedsFsrsMigration} from './storageSchemas.ts';
import {migrateVocabItemToFsrs} from './vocabFsrs.ts';
import {createInitialVocabFsrs} from './vocabFsrsCore.ts';
import {loadVocabReviewer, prepareVocabFsrsMigration, VOCAB_STORAGE_KEY} from './vocabFsrsLoader.ts';

const NOW = Date.parse('2026-11-24T12:00:00.000Z');

test('the scheduler-free new card matches ts-fsrs (REVIEW M-7)', () => {
  const legacyNew = {mastery: 'new' as const, reviewCount: 0, createdAt: new Date(NOW).toISOString()};
  assert.deepEqual(createInitialVocabFsrs(NOW), migrateVocabItemToFsrs(legacyNew, NOW));
});

test('storedVocabNeedsFsrsMigration spots pre-FSRS items only (REVIEW M-7)', () => {
  const migrated = [{id: 'a', fsrs: createInitialVocabFsrs(NOW)}];
  assert.equal(storedVocabNeedsFsrsMigration(migrated), false);
  assert.equal(storedVocabNeedsFsrsMigration([...migrated, {id: 'b', mastery: 'mastered'}]), true);
  assert.equal(storedVocabNeedsFsrsMigration(SEED_VOCAB), true, 'seed deck carries mastery only');
  assert.equal(storedVocabNeedsFsrsMigration('junk'), false);
});

test('a new user (no stored deck) gets seeds scheduled from their mastery (REVIEW M-7)', async () => {
  await prepareVocabFsrsMigration({getItem: () => null});
  const seeds = sanitizeVocabItems(SEED_VOCAB) as VocabItem[];
  const mastered = seeds.find((v) => v.mastery === 'mastered');
  assert.ok(mastered?.fsrs);
  assert.equal(mastered.fsrs.state, 'review');
  assert.ok(Date.parse(mastered.fsrs.dueAt) > Date.now(), 'mastered seed is not due immediately');
});

test('an already-migrated deck does not need the scheduler, and reviews load it on demand (REVIEW M-7)', async () => {
  const deck = [{...SEED_VOCAB[0], fsrs: createInitialVocabFsrs(NOW)}];
  const storage = {getItem: (key: string) => (key === VOCAB_STORAGE_KEY ? JSON.stringify(deck) : null)};
  await prepareVocabFsrsMigration(storage);
  const review = await loadVocabReviewer();
  const reviewed = review(deck[0] as VocabItem, 'good', NOW);
  assert.equal(reviewed.reviewCount, (deck[0].reviewCount ?? 0) + 1);
  assert.notEqual(reviewed.fsrs?.state, undefined);
});
