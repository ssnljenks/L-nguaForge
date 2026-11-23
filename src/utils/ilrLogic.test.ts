import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChatThreadTitle,
  determineProbeLevel,
  filterItemsByLanguage,
  formatSecondsClock,
  formatVocabToAnkiCsv,
  getDefaultDialect,
  getPrepPhase,
  normalizeVocabCategory,
  resolveActiveSessionForLanguage,
  resolveActiveThreadForLanguage,
  scorePhraseRecallMatch,
  tokenizeTranscript,
} from './ilrLogic';
import type {FreeChatThread, OpiSession, VocabItem} from '../types';

test('PREP 90-second pacing transitions across exact boundaries', () => {
  assert.equal(getPrepPhase(0).id, 'point');
  assert.equal(getPrepPhase(14).id, 'point');
  assert.equal(getPrepPhase(15).id, 'reason');
  assert.equal(getPrepPhase(39).id, 'reason');
  assert.equal(getPrepPhase(40).id, 'example');
  assert.equal(getPrepPhase(69).id, 'example');
  assert.equal(getPrepPhase(70).id, 'pivot');
  assert.equal(getPrepPhase(90).id, 'pivot');
  assert.equal(getPrepPhase(120).id, 'pivot');
});

test('OPI probe level stays at Level 2 during initial warm-up, escalates to Level 3, and backs off on breakdown', () => {
  const warmup = determineProbeLevel({
    elapsedSeconds: 45,
    candidateTurnCount: 1,
    lastCandidateText: 'Mi unidad coordina patrullas marítimas en la zona económica exclusiva.',
  });
  assert.equal(warmup.level, 'level_2_baseline');

  const escalated = determineProbeLevel({
    elapsedSeconds: 135,
    candidateTurnCount: 3,
    lastCandidateText:
      'Si bien existen desafíos presupuestarios, la cooperación interagencial fortalece la disuasión regional.',
  });
  assert.equal(escalated.level, 'level_3_probe');

  const backedOff = determineProbeLevel({
    elapsedSeconds: 180,
    candidateTurnCount: 4,
    lastCandidateText: 'Perdón, no sé cómo decir eso.',
  });
  assert.equal(backedOff.level, 'level_2_baseline');
});

test('scorePhraseRecallMatch normalizes accents and computes accurate lexical match percentage', () => {
  const exact = scorePhraseRecallMatch(
    'Cabe señalar que la interoperabilidad resulta indispensable.',
    'cabe senalar que la interoperabilidad resulta indispensable'
  );
  assert.equal(exact, 100);

  const partial = scorePhraseRecallMatch('uno dos tres cuatro', 'uno dos cinco seis');
  assert.equal(partial, 50);

  assert.equal(scorePhraseRecallMatch('hola mundo', ''), 0);
});

test('tokenizeTranscript preserves punctuation and isolates Spanish/Portuguese words', () => {
  const tokens = tokenizeTranscript('¿Podría explicar, señor coronel, qué implicaciones tendría?');
  const words = tokens.filter((t) => t.isWord).map((t) => t.cleanWord);
  assert.deepEqual(words, ['Podría', 'explicar', 'señor', 'coronel', 'qué', 'implicaciones', 'tendría']);
});

test('formatVocabToAnkiCsv escapes quotes and commas cleanly', () => {
  const sample: VocabItem[] = [
    {
      id: 'v1',
      term: 'no obstante',
      englishConcept: 'nevertheless, however (formal pivot)',
      contextSentence: 'El informe fue concluyente; no obstante, persisten dudas.',
      registerTag: 'Formal / Diplomatic',
      category: 'High-Register Connectors',
      language: 'es',
      dialect: 'neutral_latam',
      domain: 'general_policy',
      createdAt: '2026-11-22T00:00:00Z',
      mastery: 'new',
      reviewCount: 0,
    },
  ];
  const csv = formatVocabToAnkiCsv(sample);
  const lines = csv.split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith('Front_English_Concept,Back_Target_Term'));
  assert.ok(lines[1].includes('"nevertheless, however (formal pivot)"'));
  assert.ok(lines[1].includes('lang::es'));
});

test('helper formatters and default dialects work cleanly', () => {
  assert.equal(getDefaultDialect('es'), 'neutral_latam');
  assert.equal(getDefaultDialect('pt'), 'br_standard');
  assert.equal(formatSecondsClock(90), '1:30');
  assert.equal(formatSecondsClock(5), '0:05');
});

test('Free Chat thread title and vocab category normalization handle edge cases', () => {
  assert.equal(buildChatThreadTitle('   '), 'New Conversation');
  assert.equal(buildChatThreadTitle('Hablemos sobre noticias recientes'), 'Hablemos sobre noticias recientes');
  const truncated = buildChatThreadTitle(
    'Hola, quiero practicar cómo explicar un proyecto logístico complejo en detalle',
    32
  );
  assert.ok(truncated.endsWith('…'));
  assert.ok(truncated.length <= 32);

  assert.equal(normalizeVocabCategory('High-Register Connectors'), 'High-Register Connectors');
  assert.equal(normalizeVocabCategory('false friends'), 'False Friends');
  assert.equal(normalizeVocabCategory('unknown_cat'), 'Regional Idioms');
  assert.deepEqual(tokenizeTranscript(undefined as unknown as string), []);
  assert.equal(buildChatThreadTitle(undefined as unknown as string), 'New Conversation');
});

test('Spanish and Portuguese state resolution never leaks opposite-language threads, sessions, or items', () => {
  const esThread: FreeChatThread = {
    id: 'chat-es-1',
    title: 'Quiero practicar español',
    language: 'es',
    dialect: 'neutral_latam',
    registerMode: 'everyday',
    updatedAt: '2026-11-22T12:00:00Z',
    messages: [{id: 'm1', role: 'user', text: 'quiero practicar el español', timestamp: '2026-11-22T12:00:00Z'}],
    savedTerms: [],
  };
  const ptThread: FreeChatThread = {
    id: 'chat-pt-1',
    title: 'Quero praticar português',
    language: 'pt',
    dialect: 'br_standard',
    registerMode: 'everyday',
    updatedAt: '2026-11-22T12:05:00Z',
    messages: [{id: 'm2', role: 'user', text: 'Olá, tudo bem?', timestamp: '2026-11-22T12:05:00Z'}],
    savedTerms: [],
  };

  // Switching to Portuguese while activeThreadId still holds Spanish ID returns null (no Spanish leak)
  assert.equal(resolveActiveThreadForLanguage([esThread], 'chat-es-1', 'pt'), null);
  // Resolving in Spanish returns only the Spanish thread
  assert.equal(resolveActiveThreadForLanguage([esThread, ptThread], 'chat-es-1', 'es')?.id, 'chat-es-1');
  // Switching to Portuguese with both threads present still refuses to show Spanish thread even if Spanish ID was passed
  assert.equal(resolveActiveThreadForLanguage([esThread, ptThread], 'chat-es-1', 'pt'), null);
  assert.equal(resolveActiveThreadForLanguage([esThread, ptThread], 'chat-pt-1', 'pt')?.id, 'chat-pt-1');

  const esSession: OpiSession = {
    id: 'sess-es',
    type: 'opi',
    language: 'es',
    dialect: 'neutral_latam',
    domain: 'maritime_surveillance',
    startedAt: '2026-11-22T00:00:00Z',
    durationSeconds: 180,
    messages: [],
  };
  const ptSession: OpiSession = {
    id: 'sess-pt',
    type: 'opi',
    language: 'pt',
    dialect: 'br_standard',
    domain: 'general_policy',
    startedAt: '2026-11-22T01:00:00Z',
    durationSeconds: 120,
    messages: [],
  };

  assert.equal(resolveActiveSessionForLanguage([esSession], 'sess-es', 'pt'), null);
  assert.equal(resolveActiveSessionForLanguage([esSession, ptSession], 'sess-es', 'pt')?.id, 'sess-pt');
  assert.equal(resolveActiveSessionForLanguage([esSession, ptSession], 'sess-pt', 'es')?.id, 'sess-es');

  const items = [
    {language: 'es' as const, term: 'no obstante'},
    {language: 'pt' as const, term: 'outrossim'},
  ];
  assert.deepEqual(
    filterItemsByLanguage(items, 'pt').map((i) => i.term),
    ['outrossim']
  );
  assert.deepEqual(
    filterItemsByLanguage(items, 'es').map((i) => i.term),
    ['no obstante']
  );
});
