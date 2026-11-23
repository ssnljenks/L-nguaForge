import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_MISSION_CONFIG, SEED_SAMPLE_SESSIONS, SEED_VOCAB} from '../data/seedData.ts';
import {
  sanitizeChatThreads,
  sanitizeHistory,
  sanitizeMissionConfig,
  sanitizeSeenTabs,
  sanitizeSessions,
  sanitizeVocabItems,
} from './storageSchemas.ts';

const sanitizeConfig = sanitizeMissionConfig(DEFAULT_MISSION_CONFIG);
/** Round-trips through JSON like localStorage does. */
const stored = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

test('valid data, including the shipped seed data, passes through unchanged', () => {
  assert.deepEqual(sanitizeConfig(stored(DEFAULT_MISSION_CONFIG)), DEFAULT_MISSION_CONFIG);
  assert.deepEqual(sanitizeVocabItems(stored(SEED_VOCAB)), SEED_VOCAB);
  assert.deepEqual(sanitizeSessions(stored(SEED_SAMPLE_SESSIONS)), SEED_SAMPLE_SESSIONS);
  assert.deepEqual(sanitizeSeenTabs(['chat', 'vault']), ['chat', 'vault']);
});

test('non-array / non-object roots are rejected so the hook falls back to defaults', () => {
  assert.equal(sanitizeConfig('garbage'), undefined);
  assert.equal(sanitizeConfig(null), undefined);
  assert.equal(sanitizeVocabItems({}), undefined);
  assert.equal(sanitizeSessions(42), undefined);
  assert.equal(sanitizeHistory('[]'), undefined);
  assert.equal(sanitizeChatThreads(null), undefined);
  assert.equal(sanitizeSeenTabs('chat'), undefined);
});

test('mission config repairs invalid fields individually', () => {
  const repaired = sanitizeConfig({
    language: 'pt',
    dialect: 'rioplatense', // a Spanish dialect: invalid for Portuguese
    domain: 'space_force',
    speechRate: 99,
    autoSpeakExaminer: 'yes',
    handsFreeMode: true,
  });
  assert.ok(repaired);
  assert.equal(repaired.language, 'pt');
  assert.notEqual(repaired.dialect, 'rioplatense');
  assert.equal(repaired.domain, DEFAULT_MISSION_CONFIG.domain);
  assert.equal(repaired.speechRate, 2);
  assert.equal(repaired.autoSpeakExaminer, DEFAULT_MISSION_CONFIG.autoSpeakExaminer);
  assert.equal(repaired.handsFreeMode, true);
  assert.equal(repaired.voiceURI, '');
});

test('vocab: corrupt entries are dropped, salvageable ones repaired, the rest kept', () => {
  const [good] = SEED_VOCAB;
  const result = sanitizeVocabItems([
    good,
    null,
    'string entry',
    {id: 'no-term'},
    {id: 'v-x', term: 'no obstante', category: 'Invented', mastery: 'legendary', reviewCount: -4},
  ]);
  assert.ok(result);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], good);
  assert.equal(result[1].category, 'Regional Idioms');
  assert.equal(result[1].mastery, 'new');
  assert.equal(result[1].reviewCount, 0);
  assert.equal(result[1].language, 'es');
});

test('sessions: bad messages and malformed debriefs are removed without losing the session', () => {
  const result = sanitizeSessions([
    {
      id: 's1',
      language: 'es',
      startedAt: 'not a date',
      messages: [{id: 'm1', role: 'candidate', text: 'Hola'}, {id: 'm2'}, 7],
      debrief: {summaryAssessment: 'missing audit'},
    },
  ]);
  assert.ok(result);
  assert.equal(result[0].messages.length, 1);
  assert.equal(result[0].debrief, undefined);
  assert.equal(result[0].startedAt, new Date(0).toISOString());
});

test('chat threads and history keep valid records and normalize enums', () => {
  const threads = sanitizeChatThreads([
    {
      id: 't1',
      language: 'pt',
      registerMode: 'yelling',
      messages: [{id: 'a', role: 'assistant', text: 'Olá', struggleSuggestions: [{targetPhrase: 'lidar com'}, {}]}],
      savedTerms: ['ok', 3],
    },
    {title: 'no id'},
  ]);
  assert.ok(threads);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].registerMode, 'professional');
  assert.equal(threads[0].messages[0].struggleSuggestions?.length, 1);
  assert.deepEqual(threads[0].savedTerms, ['ok']);

  const history = sanitizeHistory([{id: 'h1', module: 'teleport'}, {module: 'chat'}]);
  assert.deepEqual(
    history?.map((h) => h.module),
    ['chat']
  );
});

test('seen tabs drop unknown values and duplicates', () => {
  assert.deepEqual(sanitizeSeenTabs(['chat', 'chat', 'admin', 3, 'lab']), ['chat', 'lab']);
});
