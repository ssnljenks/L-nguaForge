import test from 'node:test';
import assert from 'node:assert/strict';
import type {VocabItem} from '../types.ts';
import {
  filterVocabItems,
  isGlossaryAvailable,
  isWorkOnlyVocabCategory,
  resolveVocabView,
  visibleVocabCategoryFilters,
} from './vocabFilters.ts';

const MILITARY = 'Operational/Military Terms';

function item(id: string, category: VocabItem['category'], term = id): VocabItem {
  return {
    id,
    term,
    englishConcept: `meaning of ${term}`,
    contextSentence: `Una frase con ${term}.`,
    category,
    language: 'es',
  } as VocabItem;
}

test('Work focus off: no Operational/Military Terms chip; the other chips stay in order', () => {
  assert.deepEqual(visibleVocabCategoryFilters(false), [
    'all',
    'High-Register Connectors',
    'Regional Idioms',
    'False Friends',
  ]);
});

test('Work focus on: every chip, as before', () => {
  assert.deepEqual(visibleVocabCategoryFilters(true), [
    'all',
    'High-Register Connectors',
    MILITARY,
    'Regional Idioms',
    'False Friends',
  ]);
});

test('the Military Dict view needs Work focus', () => {
  assert.equal(isGlossaryAvailable(false), false);
  assert.equal(isGlossaryAvailable(true), true);
  assert.equal(isWorkOnlyVocabCategory(MILITARY), true);
  assert.equal(isWorkOnlyVocabCategory('all'), false);
  assert.equal(isWorkOnlyVocabCategory('Regional Idioms'), false);
});

test('switching Work focus off while on a hidden view falls back to the normal list', () => {
  assert.deepEqual(resolveVocabView({mode: 'glossary', categoryFilter: 'all'}, false), {
    mode: 'browse',
    categoryFilter: 'all',
  });
  assert.deepEqual(resolveVocabView({mode: 'browse', categoryFilter: MILITARY}, false), {
    mode: 'browse',
    categoryFilter: 'all',
  });
  assert.deepEqual(resolveVocabView({mode: 'glossary', categoryFilter: MILITARY}, false), {
    mode: 'browse',
    categoryFilter: 'all',
  });
  // Recall and the other filters are untouched.
  assert.deepEqual(resolveVocabView({mode: 'recall', categoryFilter: 'False Friends'}, false), {
    mode: 'recall',
    categoryFilter: 'False Friends',
  });
  // On: nothing changes.
  assert.deepEqual(resolveVocabView({mode: 'glossary', categoryFilter: MILITARY}, true), {
    mode: 'glossary',
    categoryFilter: MILITARY,
  });
});

test('saved military items stay in the normal list with Work focus off', () => {
  const items = [item('a', 'Regional Idioms'), item('b', MILITARY, 'interdicción'), item('c', 'False Friends')];
  const {categoryFilter} = resolveVocabView({mode: 'browse', categoryFilter: MILITARY}, false);
  const shown = filterVocabItems(items, categoryFilter, '');
  assert.deepEqual(
    shown.map((i) => i.id),
    ['a', 'b', 'c']
  );
  // Search finds it too.
  assert.deepEqual(
    filterVocabItems(items, 'all', 'interdic').map((i) => i.id),
    ['b']
  );
});

test('with Work focus on the category chip still narrows to that category', () => {
  const items = [item('a', 'Regional Idioms'), item('b', MILITARY)];
  assert.deepEqual(
    filterVocabItems(items, MILITARY, '').map((i) => i.id),
    ['b']
  );
});
