import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateOpiRating,
  HIGHER_LEVELS_NOT_RATED_NOTE,
  MIN_ITEMS_FOR_FLOOR,
  SUSTAINED_SHARE_FOR_FLOOR,
  PRACTICE_RATING_DISCLAIMER,
  resolvePrimaryRetryFunction,
} from './opiRating.ts';
import type {TurnAssessment} from '../types.ts';

test('floor 0 gives 0+ when Level 1 checks fail, with Level 1 function grid', () => {
  const assessments: TurnAssessment[] = [
    {
      functionKey: 'l1_simple_qa',
      outcome: 'sustained',
      evidence: 'Answered name and job.',
      targetLevel: 1,
      phase: 'level_check',
    },
    {
      functionKey: 'l1_daily_travel_questions',
      outcome: 'breakdown',
      evidence: 'Fell back to English on schedule question.',
      targetLevel: 1,
      phase: 'level_check',
    },
    {
      functionKey: 'l1_short_conversations',
      outcome: 'breakdown',
      evidence: 'Could not keep a short exchange going.',
      targetLevel: 1,
      phase: 'level_check',
    },
    {
      functionKey: 'l2_narration_timeframes',
      outcome: 'breakdown',
      evidence: 'Could not narrate past trip.',
      targetLevel: 2,
      phase: 'probe',
    },
  ];
  const res = calculateOpiRating(assessments);
  assert.equal(res.floor, 0);
  assert.equal(res.ceiling, 1);
  assert.equal(res.displayRating, '0+');
  assert.equal(res.gridLevel, 1);
  assert.equal(res.functionChecks.length, 6);
  assert.equal(res.disclaimer, PRACTICE_RATING_DISCLAIMER);
});

test('floor 1 without half of Level 2 probes sustained/partial gives 1', () => {
  const assessments: TurnAssessment[] = [
    {functionKey: 'l1_simple_qa', outcome: 'sustained', evidence: 'Clear.', targetLevel: 1, phase: 'level_check'},
    {
      functionKey: 'l1_short_conversations',
      outcome: 'sustained',
      evidence: 'Held short turn.',
      targetLevel: 1,
      phase: 'level_check',
    },
    {
      functionKey: 'l2_narration_timeframes',
      outcome: 'breakdown',
      evidence: 'Present tense only.',
      targetLevel: 2,
      phase: 'probe',
    },
    {
      functionKey: 'l2_resolve_complication',
      outcome: 'breakdown',
      evidence: 'Stuck mid-sentence.',
      targetLevel: 2,
      phase: 'probe',
    },
    {functionKey: 'l2_facts', outcome: 'partial', evidence: 'Short facts.', targetLevel: 2, phase: 'probe'},
  ];
  const res = calculateOpiRating(assessments);
  assert.equal(res.floor, 1);
  assert.equal(res.ceiling, 2);
  assert.equal(res.displayRating, '1');
  assert.equal(res.isPlus, false);
  assert.equal(res.gridLevel, 2);
  assert.equal(res.functionChecks.length, 6);
  assert.ok(res.accuracyNotes.some((n) => n.descriptor.includes('NOT used to non-native speakers')));
});

test('floor 1 with >= half of Level 2 probes sustained or partial gives 1+', () => {
  const assessments: TurnAssessment[] = [
    {functionKey: 'l1_simple_qa', outcome: 'sustained', evidence: 'Solid.', targetLevel: 1, phase: 'level_check'},
    {functionKey: 'l2_facts', outcome: 'sustained', evidence: 'Good concrete details.', targetLevel: 2, phase: 'probe'},
    {
      functionKey: 'l2_narration_timeframes',
      outcome: 'partial',
      evidence: 'Mixed past endings.',
      targetLevel: 2,
      phase: 'probe',
    },
    {
      functionKey: 'l2_resolve_complication',
      outcome: 'breakdown',
      evidence: 'Needed rewording.',
      targetLevel: 2,
      phase: 'probe',
    },
  ];
  const res = calculateOpiRating(assessments);
  assert.equal(res.floor, 1);
  assert.equal(res.ceiling, 2);
  assert.equal(res.displayRating, '1+');
  assert.equal(res.isPlus, true);
  assert.equal(res.gridLevel, 2);
});

test('floor 2 with < half Level 3 positive probes gives 2', () => {
  const assessments: TurnAssessment[] = [
    {
      functionKey: 'l2_casual_conversation',
      outcome: 'sustained',
      evidence: 'Warmup/L2 fluent.',
      targetLevel: 2,
      phase: 'level_check',
    },
    {
      functionKey: 'l2_narration_timeframes',
      outcome: 'sustained',
      evidence: 'Past/future clean.',
      targetLevel: 2,
      phase: 'level_check',
    },
    {
      functionKey: 'l3_hypothesize',
      outcome: 'breakdown',
      evidence: 'Dropped subjunctive.',
      targetLevel: 3,
      phase: 'probe',
    },
    {
      functionKey: 'l3_unfamiliar_abstract',
      outcome: 'breakdown',
      evidence: 'Concrete fallback.',
      targetLevel: 3,
      phase: 'probe',
    },
    {
      functionKey: 'l3_support_opinions',
      outcome: 'partial',
      evidence: 'Short defense.',
      targetLevel: 3,
      phase: 'probe',
    },
  ];
  const res = calculateOpiRating(assessments);
  assert.equal(res.floor, 2);
  assert.equal(res.ceiling, 3);
  assert.equal(res.displayRating, '2');
  assert.equal(res.gridLevel, 3);
  assert.equal(res.functionChecks.length, 6);
});

test('floor 2 with >= half Level 3 sustained or partial gives 2+ and excludes warmup turns', () => {
  const assessments: TurnAssessment[] = [
    // Warmup breakdown must NOT prevent Level 2 floor or affect scores
    {functionKey: 'l2_facts', outcome: 'breakdown', evidence: 'Ignored warmup.', targetLevel: 2, phase: 'warmup'},
    {
      functionKey: 'l2_facts',
      outcome: 'sustained',
      evidence: 'Solid factual recall.',
      targetLevel: 2,
      phase: 'level_check',
    },
    {
      functionKey: 'l2_narration_timeframes',
      outcome: 'sustained',
      evidence: 'Clean narration.',
      targetLevel: 2,
      phase: 'level_check',
    },
    {
      functionKey: 'l3_support_opinions',
      outcome: 'sustained',
      evidence: 'Supported opinion clearly.',
      targetLevel: 3,
      phase: 'probe',
    },
    {
      functionKey: 'l3_describe_explain_detail',
      outcome: 'partial',
      evidence: 'Informal connectors.',
      targetLevel: 3,
      phase: 'probe',
    },
    {
      functionKey: 'l3_hypothesize',
      outcome: 'breakdown',
      evidence: 'Reverted to indicative.',
      targetLevel: 3,
      phase: 'probe',
    },
    {
      functionKey: 'l3_hypothesize',
      outcome: 'breakdown',
      evidence: 'Could not sustain conditional.',
      targetLevel: 3,
      phase: 'probe',
    },
  ];
  const res = calculateOpiRating(assessments);
  assert.equal(res.floor, 2);
  assert.equal(res.ceiling, 3);
  assert.equal(res.displayRating, '2+');
  assert.equal(res.gridLevel, 3);
  const hyp = res.functionChecks.find((f) => f.functionKey === 'l3_hypothesize');
  assert.equal(hyp?.status, 'not_met');
  assert.equal(hyp?.evidence?.length, 2);
  const sup = res.functionChecks.find((f) => f.functionKey === 'l3_support_opinions');
  assert.equal(sup?.status, 'met');
});

test('sustained Level 3 shows 3 with Higher levels not rated in practice note', () => {
  const assessments: TurnAssessment[] = [
    {
      functionKey: 'l2_narration_timeframes',
      outcome: 'sustained',
      evidence: 'Clean.',
      targetLevel: 2,
      phase: 'level_check',
    },
    {functionKey: 'l3_support_opinions', outcome: 'sustained', evidence: 'Nuanced.', targetLevel: 3, phase: 'probe'},
    {
      functionKey: 'l3_hypothesize',
      outcome: 'sustained',
      evidence: 'Imperfect subjunctive + conditional.',
      targetLevel: 3,
      phase: 'probe',
    },
    {
      functionKey: 'l3_unfamiliar_abstract',
      outcome: 'sustained',
      evidence: 'Sustained abstract trade-offs.',
      targetLevel: 3,
      phase: 'probe',
    },
  ];
  const res = calculateOpiRating(assessments);
  assert.equal(res.floor, 3);
  assert.equal(res.ceiling, null);
  assert.equal(res.displayRating, '3');
  assert.equal(res.ratingNote, HIGHER_LEVELS_NOT_RATED_NOTE);
  assert.equal(res.disclaimer, PRACTICE_RATING_DISCLAIMER);
});

test('resolvePrimaryRetryFunction prioritizes ceilingMoment then not_met then partly', () => {
  const checks = [
    {functionKey: 'l3_infer' as const, label: 'Infer', status: 'partly' as const, note: ''},
    {functionKey: 'l3_hypothesize' as const, label: 'Hypothesize', status: 'not_met' as const, note: ''},
  ];
  assert.deepEqual(resolvePrimaryRetryFunction(checks, 'l3_unfamiliar_abstract'), {
    functionKey: 'l3_unfamiliar_abstract',
    label: 'Unfamiliar & abstract topics',
  });
  assert.deepEqual(resolvePrimaryRetryFunction(checks), {
    functionKey: 'l3_hypothesize',
    label: 'Hypothesize',
  });
});

// REVIEW M-5: borderline cases. A level holds with >= 2 items and >= 75% sustained, and is lost only
// with >= 2 non-sustained items, so no single turn makes or breaks a level.
type Outcome = TurnAssessment['outcome'];
const L1 = ['l1_simple_qa', 'l1_short_conversations', 'l1_daily_travel_questions', 'l1_simple_qa'] as const;
const L2 = ['l2_facts', 'l2_narration_timeframes', 'l2_resolve_complication', 'l2_casual_conversation'] as const;
const L3 = ['l3_support_opinions', 'l3_hypothesize', 'l3_unfamiliar_abstract', 'l3_describe_explain_detail'] as const;

function at(level: 1 | 2 | 3, outcomes: readonly Outcome[]): TurnAssessment[] {
  const keys = level === 1 ? L1 : level === 2 ? L2 : L3;
  return outcomes.map((outcome, i) => ({
    functionKey: keys[i % keys.length],
    outcome,
    evidence: `${outcome} at L${level}`,
    targetLevel: level,
    phase: level === 3 ? 'probe' : 'level_check',
  }));
}

test('rating thresholds are explicit (REVIEW M-5)', () => {
  assert.equal(MIN_ITEMS_FOR_FLOOR, 2);
  assert.equal(SUSTAINED_SHARE_FOR_FLOOR, 0.75);
});

const BORDERLINE: {name: string; assessments: TurnAssessment[]; floor: number; display: string}[] = [
  {
    name: 'one sustained Level 3 turn on a solid Level 2 is 2+, not 3',
    assessments: [...at(2, ['sustained', 'sustained']), ...at(3, ['sustained'])],
    floor: 2,
    display: '2+',
  },
  {
    name: 'two sustained Level 3 turns on a solid Level 2 are 3',
    assessments: [...at(2, ['sustained', 'sustained']), ...at(3, ['sustained', 'sustained'])],
    floor: 3,
    display: '3',
  },
  {
    name: 'Level 3 at exactly 75% sustained (3 of 4) holds',
    assessments: [...at(2, ['sustained', 'sustained']), ...at(3, ['sustained', 'sustained', 'sustained', 'partial'])],
    floor: 3,
    display: '3',
  },
  {
    name: 'Level 3 at 67% sustained (2 of 3) does not hold',
    assessments: [...at(2, ['sustained', 'sustained']), ...at(3, ['sustained', 'sustained', 'breakdown'])],
    floor: 2,
    display: '2+',
  },
  {
    name: 'one Level 2 partial no longer blocks a Level 2 floor',
    assessments: [...at(1, ['sustained']), ...at(2, ['sustained', 'sustained', 'sustained', 'partial'])],
    floor: 2,
    display: '2',
  },
  {
    name: 'one Level 2 partial no longer blocks a Level 3 floor',
    assessments: [...at(2, ['sustained', 'partial']), ...at(3, ['sustained', 'sustained', 'sustained'])],
    floor: 3,
    display: '3',
  },
  {
    name: 'two Level 2 breakdowns block a Level 3 floor',
    assessments: [...at(2, ['sustained', 'breakdown', 'breakdown']), ...at(3, ['sustained', 'sustained', 'sustained'])],
    floor: 1,
    display: '1',
  },
  {
    name: 'a single sustained Level 2 turn is 1+, not 2',
    assessments: [...at(1, ['sustained', 'sustained']), ...at(2, ['sustained'])],
    floor: 1,
    display: '1+',
  },
  {
    name: 'a single Level 1 breakdown does not drop the floor to 0',
    assessments: [...at(1, ['sustained', 'sustained', 'breakdown']), ...at(2, ['breakdown'])],
    floor: 1,
    display: '1',
  },
  {
    name: 'a single Level 1 partial does not block a Level 2 floor',
    assessments: [...at(1, ['partial', 'sustained']), ...at(2, ['sustained', 'sustained', 'sustained'])],
    floor: 2,
    display: '2',
  },
  {
    name: 'two Level 1 breakdowns give 0+',
    assessments: [...at(1, ['sustained', 'breakdown', 'breakdown'])],
    floor: 0,
    display: '0+',
  },
  {
    name: 'no rated evidence stays at the Level 1 baseline',
    assessments: [],
    floor: 1,
    display: '1',
  },
];

for (const c of BORDERLINE) {
  test(`borderline: ${c.name} (REVIEW M-5)`, () => {
    const res = calculateOpiRating(c.assessments);
    assert.equal(res.floor, c.floor);
    assert.equal(res.displayRating, c.display);
  });
}
