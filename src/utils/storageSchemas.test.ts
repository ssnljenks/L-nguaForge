import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_MISSION_CONFIG, SEED_SAMPLE_SESSIONS, SEED_VOCAB} from '../data/seedData.ts';
import {
  mapLegacyModuleTab,
  sanitizeActiveTab,
  sanitizeChatThreads,
  sanitizeDlptResults,
  sanitizeErrorLogEntries,
  sanitizeHistory,
  sanitizeMissionConfig,
  sanitizeSeenTabs,
  sanitizeSessions,
  sanitizeTodayPlanCompletion,
  sanitizeVocabItems,
} from './storageSchemas.ts';

const sanitizeConfig = sanitizeMissionConfig(DEFAULT_MISSION_CONFIG);
/** Round-trips through JSON like localStorage does. */
const stored = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

test('valid data, including the shipped seed data, passes through unchanged (with FSRS migrated)', () => {
  assert.deepEqual(sanitizeConfig(stored(DEFAULT_MISSION_CONFIG)), DEFAULT_MISSION_CONFIG);
  const sanitizedVocab = sanitizeVocabItems(stored(SEED_VOCAB));
  assert.ok(sanitizedVocab);
  assert.equal(sanitizedVocab.length, SEED_VOCAB.length);
  sanitizedVocab.forEach((item, idx) => {
    const {fsrs, ...rest} = item;
    assert.deepEqual(rest, SEED_VOCAB[idx]);
    assert.ok(fsrs && typeof fsrs.dueAt === 'string');
  });
  // Already-migrated FSRS vocab passes through unchanged
  assert.deepEqual(sanitizeVocabItems(stored(sanitizedVocab)), sanitizedVocab);
  assert.deepEqual(sanitizeSessions(stored(SEED_SAMPLE_SESSIONS)), SEED_SAMPLE_SESSIONS);
  assert.deepEqual(sanitizeSeenTabs(['talk', 'vocab']), ['talk', 'vocab']);
  assert.equal(sanitizeActiveTab('test_prep'), 'test_prep');
});

test('non-array / non-object roots are rejected so the hook falls back to defaults', () => {
  assert.equal(sanitizeConfig('garbage'), undefined);
  assert.equal(sanitizeConfig(null), undefined);
  assert.equal(sanitizeVocabItems({}), undefined);
  assert.equal(sanitizeSessions(42), undefined);
  assert.equal(sanitizeHistory('[]'), undefined);
  assert.equal(sanitizeChatThreads(null), undefined);
  assert.equal(sanitizeSeenTabs('chat'), undefined);
  assert.equal(sanitizeActiveTab(99), undefined);
  assert.equal(sanitizeActiveTab('unknown_tab'), undefined);
});

test('mission config repairs invalid fields individually and migrates missing liveVoice', () => {
  const repaired = sanitizeConfig({
    language: 'pt',
    dialect: 'rioplatense', // a Spanish dialect: invalid for Portuguese
    domain: 'space_force',
    speechRate: 99,
    autoSpeakExaminer: 'yes',
    handsFreeMode: true,
    liveVoice: 'UnknownVoice',
  });
  assert.ok(repaired);
  assert.equal(repaired.language, 'pt');
  assert.notEqual(repaired.dialect, 'rioplatense');
  assert.equal(repaired.domain, DEFAULT_MISSION_CONFIG.domain);
  assert.equal(repaired.speechRate, 2);
  assert.equal(repaired.autoSpeakExaminer, DEFAULT_MISSION_CONFIG.autoSpeakExaminer);
  assert.equal(repaired.handsFreeMode, true);
  assert.equal(repaired.voiceURI, '');
  assert.equal(repaired.liveVoice, DEFAULT_MISSION_CONFIG.liveVoice);

  const keptVoice = sanitizeConfig({...DEFAULT_MISSION_CONFIG, liveVoice: 'Kore'});
  assert.equal(keptVoice?.liveVoice, 'Kore');
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
  const {fsrs: firstFsrs, ...firstRest} = result[0];
  assert.deepEqual(firstRest, good);
  assert.ok(firstFsrs && typeof firstFsrs.dueAt === 'string');
  assert.equal(result[1].category, 'Regional Idioms');
  assert.equal(result[1].mastery, 'new');
  assert.equal(result[1].reviewCount, 0);
  assert.equal(result[1].language, 'es');
});

test('Phase 9 mission config ilrGoals/testDate and today plan completion sanitize safely', () => {
  const cfg = sanitizeConfig({
    ...DEFAULT_MISSION_CONFIG,
    ilrGoals: {listening: '2+', reading: 'invalid', speaking: '3+'},
    testDate: '2026-12-15',
  });
  assert.ok(cfg);
  assert.deepEqual(cfg.ilrGoals, {listening: '2+', reading: '3', speaking: '3+'});
  assert.equal(cfg.testDate, '2026-12-15');

  const badDate = sanitizeConfig({...DEFAULT_MISSION_CONFIG, testDate: 'not-a-date'});
  assert.equal(badDate?.testDate, undefined);

  const plan = sanitizeTodayPlanCompletion({
    '2026-11-24:es': {vocab: true, brief: 'yes', speaking: true},
    'invalid-key': {vocab: true},
  });
  assert.deepEqual(plan, {'2026-11-24:es': {vocab: true, speaking: true}});
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

test('legacy tab IDs migrate cleanly to Phase 1 tabs and deduplicate', () => {
  assert.equal(mapLegacyModuleTab('chat'), 'talk');
  assert.equal(mapLegacyModuleTab('opi'), 'test_prep');
  assert.equal(mapLegacyModuleTab('debrief'), 'test_prep');
  assert.equal(mapLegacyModuleTab('lab'), 'test_prep');
  assert.equal(mapLegacyModuleTab('vault'), 'vocab');
  assert.equal(mapLegacyModuleTab('today'), 'today');
  assert.equal(mapLegacyModuleTab('brief'), 'brief');
  assert.equal(mapLegacyModuleTab('bogus'), undefined);

  assert.equal(sanitizeActiveTab('chat'), 'talk');
  assert.equal(sanitizeActiveTab('debrief'), 'test_prep');
  assert.equal(sanitizeActiveTab('vault'), 'vocab');

  assert.deepEqual(sanitizeSeenTabs(['chat', 'chat', 'opi', 'debrief', 'lab', 'vault', 'admin', 3]), [
    'talk',
    'test_prep',
    'vocab',
  ]);
});

test('Phase 2 OPI session and legacy level/function migrations work without data loss', () => {
  const result = sanitizeSessions([
    {
      id: 'p2-s1',
      type: 'opi',
      language: 'es',
      dialect: 'neutral_latam',
      mode: 'exam',
      topicSource: 'domain', // legacy value -> migrates to examiner_choice
      targetFunction: 'hypothesize', // legacy key -> migrates to l3_hypothesize
      durationTargetSeconds: 180,
      hasLocalAudio: true,
      startedAt: '2026-11-23T12:00:00.000Z',
      durationSeconds: 180,
      messages: [
        {
          id: 'm1',
          role: 'examiner',
          text: '¿Qué pasaría si se redujera la jornada laboral?',
          timestamp: '2026-11-23T12:00:05.000Z',
          elapsedSeconds: 5,
          probeLevel: 'level_3_probe',
          phase: 'probes',
        },
      ],
      assessments: [
        {functionKey: 'l2_facts', outcome: 'sustained', evidence: 'Clear factual summary.'},
        {functionKey: 'hypothesize', outcome: 'breakdown', evidence: 'Used indicative.'},
      ],
      debrief: {
        generatedAt: '2026-11-23T12:03:10.000Z',
        estimatedIlr: '2+',
        floorLevel: 2,
        ceilingLevel: 3,
        gridLevel: 3,
        oneLineRationale: 'Strong narration, hypothetical subjunctive softened under stress.',
        summaryAssessment: 'Practice estimate summary.',
        discourseAudit: {
          pointScore: 80,
          reasonScore: 76,
          exampleScore: 84,
          pivotScore: 70,
          cohesionNotes: 'Good connectors.',
          subjunctiveControl: 'Needs imperfect subjunctive.',
          timeFrameStability: 'Stable.',
        },
        naturalUpgrades: [],
        nextDrillRecommendation: 'Hypothesize drill',
        ceilingMoment: {
          timestampSeconds: 125,
          examinerPrompt: '¿Qué pasaría si...',
          candidateUtterance: 'Si hay menos horas, creo que sería difícil.',
          problemSpan: 'Si hay menos horas',
          fix: 'Si hubiera menos horas, resultaría difícil sostener la productividad.',
          failedFunction: 'hypothesize',
          failedFunctionLabel: 'Hypothesize',
          explanation: 'Used indicative instead of imperfect subjunctive.',
        },
        level3Functions: [
          {id: 'support_opinion', status: 'met', note: 'Clear defense.'},
          {id: 'hypothesize', status: 'not_met', note: 'Needs si + imperfect subjunctive.'},
        ],
        accuracyNotes: [
          {descriptor: 'rarely needs paraphrase', observation: 'Paraphrased twice on abstract topics.', status: 'gap'},
        ],
        autoAddedVocab: [
          {
            term: 'en última instancia',
            englishConcept: 'ultimately',
            contextSentence: 'En última instancia, depende del ahorro público.',
            registerTag: 'Formal',
            category: 'High-Register Connectors',
          },
          {term: ''}, // dropped
        ],
      },
      redoRecord: {
        completedAt: '2026-11-23T12:04:00.000Z',
        examinerPrompt: '¿Qué pasaría si...',
        redoAnswer: 'Si hubiera menos horas, se reorganizarían los turnos.',
        evaluation: {
          improved: true,
          verdictLabel: 'Cleared the breakdown',
          comparisonSummary: 'Replaced indicative si-clause with imperfect subjunctive.',
          strengths: ['Imperfect subjunctive'],
          remainingGap: 'Add a second consequence clause.',
          upgradedModelAnswer: 'Si hubiera menos horas, se reorganizarían los turnos laborales.',
        },
      },
    },
    {
      id: 'p2-invalid-enums',
      language: 'pt',
      mode: 'arcade',
      topicSource: 'classified',
      targetFunction: 'telepathy',
      startedAt: '2026-11-23T12:00:00.000Z',
      messages: [],
    },
  ]);

  assert.ok(result);
  assert.equal(result.length, 2);

  const first = result[0];
  assert.equal(first.mode, 'exam');
  assert.equal(first.domain, undefined);
  assert.equal(first.topicSource, 'examiner_choice');
  assert.equal(first.targetFunctionKey, 'l3_hypothesize');
  assert.equal(first.durationTargetSeconds, 180);
  assert.equal(first.hasLocalAudio, true);
  assert.equal(first.messages[0].elapsedSeconds, 5);
  assert.equal(first.messages[0].workingLevel, 2);
  assert.equal(first.messages[0].probeLevel, 3);
  assert.equal(first.messages[0].phase, 'probe');
  assert.equal(first.assessments?.length, 2);
  assert.equal(first.assessments?.[1].functionKey, 'l3_hypothesize');
  assert.equal(first.debrief?.floorLevel, 2);
  assert.equal(first.debrief?.gridLevel, 3);
  assert.equal(first.debrief?.ceilingMoment?.failedFunction, 'l3_hypothesize');
  assert.equal(first.debrief?.levelFunctions?.length, 6);
  assert.equal(first.debrief?.levelFunctions?.[4].functionKey, 'l3_support_opinions');
  assert.equal(first.debrief?.levelFunctions?.[4].status, 'met');
  assert.equal(first.debrief?.levelFunctions?.[3].status, 'not_met');
  assert.equal(first.debrief?.accuracyNotes?.length, 1);
  assert.equal(first.debrief?.autoAddedVocab?.length, 1);
  assert.equal(first.redoRecord?.evaluation.improved, true);

  const second = result[1];
  assert.equal(second.mode, undefined);
  assert.equal(second.topicSource, undefined);
  assert.equal(second.targetFunctionKey, undefined);
});

test('Phase 3 roleplay sessions, scenarios, and debriefs survive storage sanitization cleanly', () => {
  const result = sanitizeSessions([
    {
      id: 'rp-s1',
      type: 'roleplay',
      language: 'es',
      dialect: 'neutral_latam',
      startedAt: '2026-11-23T14:00:00.000Z',
      durationSeconds: 185,
      messages: [
        {
          id: 'm1',
          role: 'examiner',
          text: 'Buenas tardes, ¿en qué le puedo ayudar?',
          timestamp: '2026-11-23T14:00:02.000Z',
          phase: 'roleplay',
        },
      ],
      roleplayScenario: {
        scenarioId: 'rp-abc',
        level: 2,
        language: 'es',
        dialect: 'neutral_latam',
        situationEnglish: 'You arrive at a neighborhood hotel and your room reservation cannot be found.',
        learnerGoal: 'Confirm a comparable room before tonight.',
        register: 'usted',
        characterRole: 'Hotel front desk clerk',
      },
      roleplayDebrief: {
        scenarioId: 'rp-abc',
        level: 2,
        situationEnglish: 'You arrive at a neighborhood hotel and your room reservation cannot be found.',
        learnerGoal: 'Confirm a comparable room before tonight.',
        characterRole: 'Hotel front desk clerk',
        register: 'usted',
        hiddenGoal: 'Check whether the booking was made under a companion surname and verify the confirmation code.',
        complication:
          'A street festival filled standard rooms; only one suite or a sister hotel two blocks away remains.',
        checklist: [
          {
            itemKey: 'rp_l2_explain',
            label: 'Explained the situation',
            functionKey: 'l2_concrete_descriptions',
            status: 'met',
            evidence: '"Reservé hace dos semanas a nombre de mi colega."',
          },
        ],
        summary: 'Resolved cleanly using polite usted forms.',
        resolvedOutcome: 'resolved',
        generatedAt: '2026-11-23T14:04:00.000Z',
      },
    },
  ]);

  assert.ok(result);
  assert.equal(result[0].type, 'roleplay');
  assert.equal(result[0].domain, undefined);
  assert.equal(result[0].roleplayScenario?.register, 'usted');
  assert.equal(result[0].roleplayDebrief?.hiddenGoal.includes('confirmation code'), true);
  assert.equal(result[0].roleplayDebrief?.checklist[0].status, 'met');
});

test('Phase 4 Talk threads and VocabItem optional domain/source/regionTag/kind migrate cleanly', () => {
  const migratedConfig = sanitizeConfig({language: 'es', dialect: 'rioplatense'});
  assert.equal(migratedConfig?.workFocusEnabled, false);

  const vocab = sanitizeVocabItems([
    {
      id: 'v-legacy-no-domain',
      term: 'che',
      englishConcept: 'hey',
      contextSentence: 'Che, ¿cómo andás?',
      category: 'Regional Idioms',
      language: 'es',
      dialect: 'rioplatense',
      source: 'talk',
      regionTag: 'Rioplatense',
      kind: 'word',
    },
    {
      id: 'v-work-talk',
      term: 'praticagem',
      englishConcept: 'pilotage',
      contextSentence: 'A praticagem confirmou.',
      category: 'Operational/Military Terms',
      language: 'pt',
      dialect: 'br_standard',
      domain: 'maritime_surveillance',
      source: 'talk',
      regionTag: 'Carioca',
      kind: 'phrase',
    },
  ]);
  assert.ok(vocab);
  assert.equal(vocab[0].domain, undefined);
  assert.equal(vocab[0].source, 'talk');
  assert.equal(vocab[0].regionTag, 'Rioplatense');
  assert.equal(vocab[0].kind, 'word');
  assert.equal(vocab[1].domain, 'maritime_surveillance');
  assert.equal(vocab[1].kind, 'phrase');

  const threads = sanitizeChatThreads([
    {
      id: 'talk-1',
      title: 'Café with Mateo',
      language: 'es',
      dialect: 'rioplatense',
      tutorId: 'es-ba-mateo',
      sceneId: 'asado',
      workTalk: false,
      slangLevel: 3,
      correctionMode: 'recast',
      pickedUp: [{term: 'laburo', meaning: 'work / job', regionTag: 'Rioplatense', kind: 'word'}],
      recastNotes: ['He recast you: porteños say laburo for trabajo.'],
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          text: '¿Cómo estuvo el laburo hoy, che?',
          timestamp: '2026-11-23T14:30:00.000Z',
          recastNote: 'He recast you: porteños say laburo for trabajo.',
          pickedUp: [{term: 'laburo', meaning: 'work / job', regionTag: 'Rioplatense'}],
        },
      ],
      savedTerms: [],
    },
  ]);
  assert.ok(threads);
  assert.equal(threads[0].tutorId, 'es-ba-mateo');
  assert.equal(threads[0].slangLevel, 3);
  assert.equal(threads[0].correctionMode, 'recast');
  assert.equal(threads[0].pickedUp?.length, 1);
  assert.equal(threads[0].messages[0].recastNote?.includes('laburo'), true);
});

test('Phase 6 sanitizeDlptResults preserves valid outcomes and drops malformed entries/trap tags', () => {
  const sanitized = sanitizeDlptResults([
    {
      id: 'dlpt-1',
      completedAt: '2026-11-24T10:00:00.000Z',
      language: 'es',
      dialect: 'rioplatense',
      skill: 'listening',
      mode: 'practice',
      profileId: 'dlpt5_ca',
      passageIds: ['es-seed-maritime-01'],
      passageLevels: ['2+', '99'],
      totalQuestions: 3,
      correctCount: 2,
      outcomes: [
        {
          questionId: 'q1',
          briefId: 'es-seed-maritime-01',
          ilrLevel: '2+',
          questionType: 'main_idea',
          correct: true,
          answered: true,
          trapType: 'over_inference', // stripped on correct answer
        },
        {
          questionId: 'q2',
          briefId: 'es-seed-maritime-01',
          ilrLevel: '2+',
          questionType: 'inference',
          correct: false,
          answered: true,
          trapType: 'over_inference',
        },
      ],
      trapsMissed: {over_inference: 1, bogus_trap: 4},
    },
    {id: ''}, // dropped
  ]);

  assert.ok(sanitized);
  assert.equal(sanitized.length, 1);
  assert.deepEqual(sanitized[0].passageLevels, ['2+']);
  assert.equal(sanitized[0].outcomes[0].trapType, undefined);
  assert.equal(sanitized[0].outcomes[1].trapType, 'over_inference');
  assert.deepEqual(sanitized[0].trapsMissed, {over_inference: 1});
});

test('Phase 7/8 sanitizeErrorLogEntries keeps valid gist additions/omissions and drops malformed items', () => {
  const entries = sanitizeErrorLogEntries([
    {
      id: 'err-1',
      createdAt: '2026-11-24T12:00:00.000Z',
      source: 'gist',
      category: 'addition',
      severity: 'high',
      language: 'es',
      dialect: 'colombian_andean',
      briefId: 'es-seed-maritime-01',
      summary: 'Added claim not present in source broadcast.',
      learnerSpan: 'surrendered in Panama',
      sourceQuote: 'remolcada al puerto de Buenaventura',
    },
    {id: 'err-bad', summary: ''}, // dropped
  ]);

  assert.ok(entries);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].category, 'addition');
  assert.equal(entries[0].severity, 'high');
  assert.equal(entries[0].learnerSpan, 'surrendered in Panama');
});
