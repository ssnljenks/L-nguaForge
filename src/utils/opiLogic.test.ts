import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWaveformBars,
  determineNextOpiStep,
  extractClipWindow,
  migrateLegacyLevels,
  normalizeIlrFunctionKey,
  normalizeLevelFunctions,
  normalizeOpiPhase,
  OPI_STANDARD_DURATION_SECONDS,
  OPI_TARGETED_RETRY_DURATION_SECONDS,
  pickNextFunctionForLevel,
  splitProblemSpan,
} from './opiLogic.ts';
import type {TurnAssessment} from '../types.ts';

test('migrateLegacyLevels maps legacy baseline and probe labels cleanly', () => {
  assert.deepEqual(migrateLegacyLevels(undefined, 'level_2_baseline'), {workingLevel: 2, probeLevel: 3});
  assert.deepEqual(migrateLegacyLevels(undefined, 'level_3_probe'), {workingLevel: 2, probeLevel: 3});
  assert.deepEqual(migrateLegacyLevels(1, 2), {workingLevel: 1, probeLevel: 2});
  assert.equal(normalizeOpiPhase('probes'), 'probe');
  assert.equal(normalizeOpiPhase('roleplay'), 'roleplay');
  assert.equal(normalizeIlrFunctionKey('hypothesize'), 'l3_hypothesize');
  assert.equal(normalizeIlrFunctionKey('support_opinion'), 'l3_support_opinions');
});

test('adaptive interview flows warmup -> level_check (L2) -> alternates probe (L3) -> roleplay -> wind_down', () => {
  const warmup = determineNextOpiStep({
    elapsedSeconds: 45,
    candidateTurnCount: 1,
    currentPhase: 'warmup',
    workingLevel: 2,
    assessments: [],
  });
  assert.equal(warmup.phase, 'warmup');
  assert.equal(warmup.workingLevel, 2);

  const firstCheck = determineNextOpiStep({
    elapsedSeconds: 130,
    candidateTurnCount: 2,
    currentPhase: 'warmup',
    workingLevel: 2,
    assessments: [],
  });
  assert.equal(firstCheck.phase, 'level_check');
  assert.equal(firstCheck.workingLevel, 2);
  assert.equal(firstCheck.probeLevel, 3);

  const l2Assessments: TurnAssessment[] = [
    {functionKey: 'l2_facts', outcome: 'sustained', evidence: 'ok', targetLevel: 2, phase: 'level_check'},
    {
      functionKey: 'l2_narration_timeframes',
      outcome: 'sustained',
      evidence: 'ok',
      targetLevel: 2,
      phase: 'level_check',
    },
  ];

  const firstProbe = determineNextOpiStep({
    elapsedSeconds: 260,
    candidateTurnCount: 4,
    currentPhase: 'level_check',
    workingLevel: 2,
    assessments: l2Assessments,
    lastOutcome: 'sustained',
  });
  assert.equal(firstProbe.phase, 'probe');
  assert.equal(firstProbe.probeLevel, 3);
  assert.ok(firstProbe.targetFunctionKey.startsWith('l3_'));

  // When candidate breaks down at L2 level_check, drops to workingLevel 1
  const l2Fail = determineNextOpiStep({
    elapsedSeconds: 200,
    candidateTurnCount: 3,
    currentPhase: 'level_check',
    workingLevel: 2,
    assessments: [
      {
        functionKey: 'l2_narration_timeframes',
        outcome: 'breakdown',
        evidence: 'Fell back to English',
        targetLevel: 2,
        phase: 'level_check',
      },
    ],
    lastOutcome: 'breakdown',
  });
  assert.equal(l2Fail.workingLevel, 1);
  assert.equal(l2Fail.probeLevel, 2);
  assert.equal(l2Fail.phase, 'level_check');

  // Role-play triggers once enough rated turns exist and includeRoleplay is true
  const roleplayStep = determineNextOpiStep({
    elapsedSeconds: Math.round(OPI_STANDARD_DURATION_SECONDS * 0.5),
    candidateTurnCount: 6,
    currentPhase: 'probe',
    workingLevel: 2,
    includeRoleplay: true,
    roleplayDone: false,
    assessments: [
      ...l2Assessments,
      {functionKey: 'l3_support_opinions', outcome: 'sustained', evidence: 'ok', targetLevel: 3, phase: 'probe'},
      {functionKey: 'l3_hypothesize', outcome: 'partial', evidence: 'ok', targetLevel: 3, phase: 'probe'},
    ],
    lastOutcome: 'sustained',
  });
  assert.equal(roleplayStep.phase, 'roleplay');
  assert.equal(roleplayStep.probeLevel, 3);

  const continueRoleplay = determineNextOpiStep({
    elapsedSeconds: Math.round(OPI_STANDARD_DURATION_SECONDS * 0.52),
    candidateTurnCount: 7,
    currentPhase: 'roleplay',
    workingLevel: 2,
    includeRoleplay: true,
    roleplayDone: false,
    roleplayTurnsCount: 1,
    roleplayResolved: false,
    assessments: l2Assessments,
  });
  assert.equal(continueRoleplay.phase, 'roleplay');

  // Wind-down drops back from L3 or breakdown so call never ends mid-breakdown
  const windDownAfterBreakdown = determineNextOpiStep({
    elapsedSeconds: Math.round(OPI_STANDARD_DURATION_SECONDS * 0.94),
    candidateTurnCount: 11,
    currentPhase: 'probe',
    workingLevel: 3,
    assessments: l2Assessments,
    lastOutcome: 'breakdown',
  });
  assert.equal(windDownAfterBreakdown.phase, 'wind_down');
  assert.equal(windDownAfterBreakdown.workingLevel, 2);
});

test('fixed Practice focusLevel keeps checks and probes anchored around selected level', () => {
  const focus1 = determineNextOpiStep({
    elapsedSeconds: 180,
    candidateTurnCount: 3,
    currentPhase: 'level_check',
    workingLevel: 1,
    focusLevel: 1,
    includeRoleplay: false,
    assessments: [],
    lastOutcome: 'sustained',
  });
  assert.equal(focus1.workingLevel, 1);
  assert.equal(focus1.probeLevel, 2);
  assert.equal(focus1.phase, 'probe');
  assert.ok(focus1.targetFunctionKey.startsWith('l2_'));

  const focus3 = determineNextOpiStep({
    elapsedSeconds: 200,
    candidateTurnCount: 4,
    currentPhase: 'probe',
    workingLevel: 3,
    focusLevel: 3,
    includeRoleplay: false,
    assessments: [],
    lastOutcome: 'sustained',
  });
  assert.equal(focus3.workingLevel, 3);
  assert.equal(focus3.probeLevel, 3);
  assert.equal(focus3.phase, 'level_check');
  assert.ok(focus3.targetFunctionKey.startsWith('l3_'));
});

test('pickNextFunctionForLevel ensures at least 2 probes per function before advancing past pool', () => {
  const assessments: TurnAssessment[] = [
    {functionKey: 'l3_infer', outcome: 'sustained', evidence: '1', targetLevel: 3, phase: 'probe'},
    {functionKey: 'l3_infer', outcome: 'partial', evidence: '2', targetLevel: 3, phase: 'probe'},
    {functionKey: 'l3_detect_overtones', outcome: 'sustained', evidence: '1', targetLevel: 3, phase: 'probe'},
  ];
  const next = pickNextFunctionForLevel(3, assessments);
  assert.notEqual(next, 'l3_infer');
  assert.ok(next.startsWith('l3_'));
  assert.equal(pickNextFunctionForLevel(3, assessments, undefined, true), 'l3_detect_overtones');
});

test('targeted 3-minute retry probes the requested functionKey and winds down cleanly', () => {
  const start = determineNextOpiStep({
    elapsedSeconds: 0,
    candidateTurnCount: 0,
    currentPhase: 'probe',
    workingLevel: 2,
    durationTargetSeconds: OPI_TARGETED_RETRY_DURATION_SECONDS,
    targetFunctionKey: 'l3_hypothesize',
  });
  assert.equal(start.phase, 'probe');
  assert.equal(start.targetFunctionKey, 'l3_hypothesize');
  assert.equal(start.probeLevel, 3);

  const wrap = determineNextOpiStep({
    elapsedSeconds: 165,
    candidateTurnCount: 3,
    currentPhase: 'probe',
    workingLevel: 2,
    durationTargetSeconds: OPI_TARGETED_RETRY_DURATION_SECONDS,
    targetFunctionKey: 'l3_hypothesize',
    lastOutcome: 'sustained',
  });
  assert.equal(wrap.phase, 'wind_down');
});

test('normalizeLevelFunctions returns all 6 functions for requested level in canonical order', () => {
  const result = normalizeLevelFunctions(
    [
      {functionKey: 'l3_hypothesize', status: 'not_met', note: 'Dropped to indicative.'},
      {id: 'support_opinion', status: 'met', note: 'Clear thesis.'},
    ],
    3
  );
  assert.equal(result.length, 6);
  assert.equal(result[3].functionKey, 'l3_hypothesize');
  assert.equal(result[3].status, 'not_met');
  assert.equal(result[4].functionKey, 'l3_support_opinions');
  assert.equal(result[4].status, 'met');
});

test('splitProblemSpan, extractClipWindow, and buildWaveformBars behave reliably', () => {
  const exact = splitProblemSpan('Si cortan el dinero, habrá problemas.', 'Si cortan el dinero');
  assert.equal(exact.match, 'Si cortan el dinero');

  assert.deepEqual(extractClipWindow(50, 60), {startSec: 48, endSec: 60});
  assert.deepEqual(extractClipWindow(120, 60), {startSec: 58, endSec: 60});

  const active = buildWaveformBars(0.85, true, 4, 16);
  assert.equal(active.length, 16);
  assert.ok(active.every((h) => h >= 0.14 && h <= 1));
});
