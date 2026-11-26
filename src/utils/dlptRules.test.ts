import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFixedOrderPassages,
  canAdvancePage,
  computeDlptSkillEstimates,
  computeNextAdaptiveLevel,
  DLPT_QUESTION_TYPES,
  DLPT_TRAP_TYPES,
  getDlptProfileForLanguage,
  getMaxQuestionsForPassage,
  getUnansweredSummary,
  pickNextAdaptivePassage,
  TRAP_TYPE_META,
} from './dlptRules.ts';
import type {BriefItem, DlptDrillResult} from '../types.ts';

function makeBriefItem(overrides: Partial<BriefItem>): BriefItem {
  return {
    id: overrides.id ?? 'item-1',
    title: 'Sample headline',
    sourceName: 'Test Source',
    sourceUrl: 'https://example.org/story',
    mediaType: overrides.mediaType ?? 'audio',
    language: overrides.language ?? 'es',
    dialectId: overrides.dialectId ?? 'neutral_latam',
    publishedAt: '2026-11-24T12:00:00.000Z',
    ilrLevel: overrides.ilrLevel ?? '2+',
    topic: overrides.topic ?? 'society',
    orientationLine: 'This passage is from a news broadcast.',
    summary: 'Summary sentence.',
    matchingDomains: [],
    estimatedMinutes: 2,
    lengthLabel: '~2 min broadcast',
    ...overrides,
  };
}

test('ES uses DLPT5-CA adaptive profile with strict no-back/no-skip rules and 3/5 question caps', () => {
  const es = getDlptProfileForLanguage('es');
  assert.equal(es.id, 'dlpt5_ca');
  assert.equal(es.pillLabel, 'ES · DLPT5-CA rules');
  assert.equal(es.adaptive, true);
  assert.equal(es.allowSkip, false);
  assert.equal(es.allowBack, false);
  assert.equal(es.allowFlag, false);
  assert.equal(es.allowEndReview, false);
  assert.equal(es.hideNextUntilPageComplete, true);
  assert.equal(es.singleAudioPlay, true);
  assert.equal(es.allowAnswerWhileAudioPlays, true);
  assert.equal(getMaxQuestionsForPassage('es', 'audio'), 3);
  assert.equal(getMaxQuestionsForPassage('es', 'text'), 5);
});

test('PT uses DLPT5 Lower-Range fixed profile with flag-to-return, end review, no replay, and 3/4 question caps', () => {
  const pt = getDlptProfileForLanguage('pt');
  assert.equal(pt.id, 'dlpt5_lower_range');
  assert.equal(pt.pillLabel, 'PT · DLPT5 Lower-Range rules');
  assert.equal(pt.adaptive, false);
  assert.equal(pt.allowSkip, true);
  assert.equal(pt.allowBack, true);
  assert.equal(pt.allowFlag, true);
  assert.equal(pt.allowEndReview, true);
  assert.equal(pt.hideNextUntilPageComplete, false);
  assert.equal(pt.singleAudioPlay, true);
  assert.equal(pt.audioReplaysOnReview, false);
  assert.equal(pt.warnUnansweredBeforeSubmit, true);
  assert.equal(getMaxQuestionsForPassage('pt', 'audio'), 3);
  assert.equal(getMaxQuestionsForPassage('pt', 'text'), 4);
});

test('canAdvancePage hides Next until every question is answered on ES, but allows skipping on PT', () => {
  const es = getDlptProfileForLanguage('es');
  const pt = getDlptProfileForLanguage('pt');
  const ids = ['q1', 'q2', 'q3'];

  assert.equal(canAdvancePage(es, ids, {q1: 0, q2: 2}), false);
  assert.equal(canAdvancePage(es, ids, {q1: 0, q2: 2, q3: 1}), true);

  assert.equal(canAdvancePage(pt, ids, {}), true);
  assert.equal(canAdvancePage(pt, ids, {q1: 0}), true);
});

test('computeNextAdaptiveLevel steps up on strong performance, down on misses, and holds on borderline', () => {
  assert.equal(computeNextAdaptiveLevel('2+', 3, 3), '3');
  assert.equal(computeNextAdaptiveLevel('2+', 2, 3), '3');
  assert.equal(computeNextAdaptiveLevel('3+', 3, 3), '3+'); // ceiling
  assert.equal(computeNextAdaptiveLevel('2+', 1, 3), '2');
  assert.equal(computeNextAdaptiveLevel('2', 0, 3), '2'); // floor
  assert.equal(computeNextAdaptiveLevel('2+', 2, 4), '2+'); // 50% holds steady
});

test('pickNextAdaptivePassage selects closest unseen passage in the adaptive step direction', () => {
  const pool: BriefItem[] = [
    makeBriefItem({id: 'es-2', ilrLevel: '2', mediaType: 'audio', language: 'es'}),
    makeBriefItem({id: 'es-2p', ilrLevel: '2+', mediaType: 'audio', language: 'es'}),
    makeBriefItem({id: 'es-3', ilrLevel: '3', mediaType: 'audio', language: 'es'}),
    makeBriefItem({id: 'es-3p', ilrLevel: '3+', mediaType: 'audio', language: 'es'}),
    makeBriefItem({id: 'pt-3', ilrLevel: '3', mediaType: 'audio', language: 'pt'}),
  ];

  // Strong score on 2+ -> steps up to 3
  const up = pickNextAdaptivePassage({
    currentLevel: '2+',
    pageCorrect: 3,
    pageTotal: 3,
    candidates: pool,
    usedIds: new Set(['es-2p']),
    language: 'es',
    mediaType: 'audio',
  });
  assert.equal(up?.id, 'es-3');

  // Weak score on 2+ -> steps down to 2
  const down = pickNextAdaptivePassage({
    currentLevel: '2+',
    pageCorrect: 1,
    pageTotal: 3,
    candidates: pool,
    usedIds: new Set(['es-2p']),
    language: 'es',
    mediaType: 'audio',
  });
  assert.equal(down?.id, 'es-2');
});

test('buildFixedOrderPassages starts with launched item and orders additional PT passages ascending', () => {
  const start = makeBriefItem({id: 'pt-start', ilrLevel: '2+', language: 'pt', mediaType: 'text'});
  const pool = [
    start,
    makeBriefItem({id: 'pt-3p', ilrLevel: '3+', language: 'pt', mediaType: 'text'}),
    makeBriefItem({id: 'pt-2', ilrLevel: '2', language: 'pt', mediaType: 'text'}),
    makeBriefItem({id: 'pt-3', ilrLevel: '3', language: 'pt', mediaType: 'text'}),
    makeBriefItem({id: 'es-2', ilrLevel: '2', language: 'es', mediaType: 'text'}),
  ];

  const ordered = buildFixedOrderPassages(start, pool, 3);
  assert.deepEqual(
    ordered.map((p) => p.id),
    ['pt-start', 'pt-2', 'pt-3']
  );
});

test('getUnansweredSummary flags exact unanswered question numbers for PT no-guessing-penalty warning', () => {
  const summary = getUnansweredSummary(
    [{questionIds: ['p1-q1', 'p1-q2']}, {questionIds: ['p2-q1', 'p2-q2', 'p2-q3']}],
    {'p1-q1': 1, 'p2-q2': 0}
  );
  assert.equal(summary.totalUnanswered, 3);
  assert.deepEqual(summary.byPassageIndex, [
    {passageIndex: 0, unansweredCount: 1, questionNumbers: [2]},
    {passageIndex: 1, unansweredCount: 2, questionNumbers: [3, 5]},
  ]);
});

test('trap metadata and question types cover every required Phase 6 enum value', () => {
  assert.equal(DLPT_QUESTION_TYPES.length, 5);
  assert.equal(DLPT_TRAP_TYPES.length, 5);
  for (const trap of DLPT_TRAP_TYPES) {
    assert.ok(TRAP_TYPE_META[trap].label.length > 0);
    assert.ok(TRAP_TYPE_META[trap].shortHint.length > 0);
  }
});

test('computeDlptSkillEstimates computes separate listening and reading ILR practice estimates and top traps', () => {
  const results: DlptDrillResult[] = [
    {
      id: 'res-1',
      completedAt: '2026-11-24T10:00:00.000Z',
      language: 'es',
      dialect: 'rioplatense',
      skill: 'listening',
      mode: 'practice',
      profileId: 'dlpt5_ca',
      passageIds: ['es-1', 'es-2'],
      passageLevels: ['2+', '3'],
      totalQuestions: 6,
      correctCount: 5,
      outcomes: [
        {questionId: 'q1', briefId: 'es-1', ilrLevel: '2+', questionType: 'main_idea', correct: true, answered: true},
        {questionId: 'q2', briefId: 'es-1', ilrLevel: '2+', questionType: 'detail', correct: true, answered: true},
        {questionId: 'q3', briefId: 'es-1', ilrLevel: '2+', questionType: 'inference', correct: true, answered: true},
        {questionId: 'q4', briefId: 'es-2', ilrLevel: '3', questionType: 'main_idea', correct: true, answered: true},
        {
          questionId: 'q5',
          briefId: 'es-2',
          ilrLevel: '3',
          questionType: 'speaker_attitude',
          correct: true,
          answered: true,
        },
        {
          questionId: 'q6',
          briefId: 'es-2',
          ilrLevel: '3',
          questionType: 'inference',
          correct: false,
          answered: true,
          trapType: 'over_inference',
        },
      ],
      trapsMissed: {over_inference: 1},
    },
    {
      id: 'res-2',
      completedAt: '2026-11-24T11:00:00.000Z',
      language: 'es',
      dialect: 'rioplatense',
      skill: 'reading',
      mode: 'test',
      profileId: 'dlpt5_ca',
      passageIds: ['es-r1'],
      passageLevels: ['2'],
      totalQuestions: 4,
      correctCount: 1,
      outcomes: [
        {questionId: 'rq1', briefId: 'es-r1', ilrLevel: '2', questionType: 'detail', correct: true, answered: true},
        {
          questionId: 'rq2',
          briefId: 'es-r1',
          ilrLevel: '2',
          questionType: 'detail',
          correct: false,
          answered: true,
          trapType: 'wrong_detail',
        },
        {
          questionId: 'rq3',
          briefId: 'es-r1',
          ilrLevel: '2',
          questionType: 'main_idea',
          correct: false,
          answered: true,
          trapType: 'wrong_detail',
        },
        {
          questionId: 'rq4',
          briefId: 'es-r1',
          ilrLevel: '2',
          questionType: 'vocabulary_in_context',
          correct: false,
          answered: true,
          trapType: 'mentioned_not_answer',
        },
      ],
      trapsMissed: {wrong_detail: 2, mentioned_not_answer: 1},
    },
  ];

  const esEstimates = computeDlptSkillEstimates(results, 'es');
  // Listening sustained 100% on 2+ and 67% on 3 (<70%), so sustained estimate is 2+
  assert.equal(esEstimates.listening.estimatedIlr, '2+');
  assert.equal(esEstimates.listening.recentAccuracy, 83);
  assert.deepEqual(esEstimates.listening.topTraps, [{trapType: 'over_inference', count: 1}]);
  assert.match(esEstimates.listening.disclaimer, /not an official rating/i);

  // Reading scored 25% on Level 2 -> practice estimate floors at 1+
  assert.equal(esEstimates.reading.estimatedIlr, '1+');
  assert.equal(esEstimates.reading.topTraps[0].trapType, 'wrong_detail');
  assert.equal(esEstimates.reading.topTraps[0].count, 2);

  // Portuguese has no drills yet -> null estimates
  const ptEstimates = computeDlptSkillEstimates(results, 'pt');
  assert.equal(ptEstimates.listening.estimatedIlr, null);
  assert.equal(ptEstimates.reading.estimatedIlr, null);
});
