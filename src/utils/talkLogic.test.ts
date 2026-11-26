import test from 'node:test';
import assert from 'node:assert/strict';
import {getTutorById, TUTORS} from '../data/tutors.ts';
import type {VocabItem} from '../types.ts';
import {
  annotateWrapUpItems,
  buildRegionalCandidates,
  buildTalkVocabSaveInput,
  clampSlangLevel,
  detectRegionalTermsInText,
  getSlangLevelSpec,
  isTermInVocab,
  mergePickedUpItems,
} from './talkLogic.ts';

test('tutors cover expected ES and PT cities mapped to valid dialect IDs', () => {
  const esTutors = TUTORS.filter((t) => t.language === 'es');
  const ptTutors = TUTORS.filter((t) => t.language === 'pt');
  assert.deepEqual(
    esTutors.map((t) => [t.city, t.dialectId]),
    [
      ['Buenos Aires', 'rioplatense'],
      ['Medellín', 'colombian_andean'],
      ['San Juan', 'caribbean'],
      ['Mexico City', 'neutral_latam'],
    ]
  );
  assert.deepEqual(
    ptTutors.map((t) => [t.city, t.dialectId]),
    [
      ['Rio de Janeiro', 'br_standard'],
      ['Salvador', 'br_bahian'],
      ['Lisbon', 'eu_portuguese'],
    ]
  );
  for (const tutor of TUTORS) {
    assert.equal(tutor.scenes[0]?.id, 'just_chatting');
    assert.ok(tutor.scenes.length >= 4 && tutor.scenes.length <= 5);
    assert.ok(tutor.signatureFeatures.length >= 3);
    assert.ok(tutor.slangExamples.length >= 5);
  }
});

test('clampSlangLevel and getSlangLevelSpec normalize 0..4 bounds safely', () => {
  assert.equal(clampSlangLevel(-3), 0);
  assert.equal(clampSlangLevel(2.6), 3);
  assert.equal(clampSlangLevel(9), 4);
  assert.equal(clampSlangLevel('oops'), 2);
  assert.equal(getSlangLevelSpec(0).label, 'Textbook');
  assert.equal(getSlangLevelSpec(4).label, 'Full street');
});

test('detectRegionalTermsInText finds accent-insensitive whole words and phrases longest-first', () => {
  const mateo = getTutorById('es-ba-mateo');
  const candidates = buildRegionalCandidates(mateo, [
    [{term: 'por las dudas', meaning: 'just in case', regionTag: 'Rioplatense'}],
  ]);
  const segments = detectRegionalTermsInText(
    'Che, si salís por las dudas llevate un abrigo porque ese bar está re copado.',
    candidates
  );
  const matched = segments.filter((s) => s.match).map((s) => s.match?.term.toLowerCase());
  assert.deepEqual(matched, ['che', 'por las dudas', 're copado']);
  // Does not match partial inside another word ("laburo" inside "laboratorio")
  const noPartial = detectRegionalTermsInText('Fuimos al laboratorio ayer.', candidates);
  assert.equal(
    noPartial.some((s) => s.match),
    false
  );
});

test('mergePickedUpItems deduplicates normalized phrases and updates examples', () => {
  const merged = mergePickedUpItems(
    [{term: 'laburo', meaning: 'work / job', regionTag: 'Rioplatense'}],
    [
      {term: 'Laburo!', meaning: 'work / job', regionTag: 'Rioplatense', example: 'Mucho laburo hoy'},
      {term: 'che', meaning: 'hey', regionTag: 'Rioplatense'},
    ]
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].example, 'Mucho laburo hoy');
});

test('buildTalkVocabSaveInput omits domain in casual talk and attaches domain only in Work talk', () => {
  const casual = buildTalkVocabSaveInput({
    term: 'maneiro',
    meaning: 'cool / awesome',
    exampleSentence: 'Esse lugar é muito maneiro.',
    language: 'pt',
    dialect: 'br_standard',
    tutorId: 'pt-rio-lucas',
    workTalk: false,
    domain: 'maritime_surveillance',
  });
  assert.equal(casual.source, 'talk');
  assert.equal(casual.regionTag, 'Carioca');
  assert.equal(casual.domain, undefined);
  assert.equal(casual.category, 'Regional Idioms');

  const work = buildTalkVocabSaveInput({
    term: 'praticagem',
    meaning: 'harbor pilotage',
    exampleSentence: 'A praticagem confirmou a janela de entrada.',
    language: 'pt',
    dialect: 'br_standard',
    tutorId: 'pt-rio-lucas',
    workTalk: true,
    domain: 'maritime_surveillance',
  });
  assert.equal(work.source, 'talk');
  assert.equal(work.domain, 'maritime_surveillance');
  assert.equal(work.category, 'Operational/Military Terms');
});

test('annotateWrapUpItems caps at 8, dedupes, and flags terms already in Vocab', () => {
  const vocab: VocabItem[] = [
    {
      id: 'v1',
      term: 'Laburo',
      englishConcept: 'work',
      contextSentence: 'Tengo mucho laburo.',
      registerTag: 'Casual Local',
      category: 'Regional Idioms',
      language: 'es',
      dialect: 'rioplatense',
      createdAt: '2026-11-23T00:00:00.000Z',
      mastery: 'new',
      reviewCount: 0,
    },
  ];
  assert.equal(isTermInVocab('laburo', 'es', vocab), true);
  assert.equal(isTermInVocab('laburo', 'pt', vocab), false);

  const items = Array.from({length: 10}, (_, i) => ({
    term: i === 0 ? 'laburo' : i === 1 ? 'LABURO' : `término ${i}`,
    meaning: `meaning ${i}`,
    exampleFromConversation: `example ${i}`,
    regionTag: i === 2 ? 'Pattern' : 'Rioplatense',
    kind: (i === 2 ? 'pattern' : 'word') as 'pattern' | 'word',
  }));

  const annotated = annotateWrapUpItems(items, 'es', vocab);
  assert.equal(annotated.length, 8);
  assert.equal(annotated[0].alreadyInVocab, true);
  assert.equal(annotated[1].alreadyInVocab, false);
  assert.equal(annotated[1].kind, 'pattern');
});
