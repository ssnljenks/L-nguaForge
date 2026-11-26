import test from 'node:test';
import assert from 'node:assert/strict';
import {
  determineRoleplayPacing,
  getRoleplayChecklistSpecs,
  isTwistHintVisible,
  normalizeRoleplayChecklist,
  normalizeRoleplayRegister,
  roleplayChecklistToAssessments,
} from './opiRoleplay.ts';
import {calculateOpiRating} from './opiRating.ts';

test('getRoleplayChecklistSpecs returns exact level-specific 3-item checklists', () => {
  assert.deepEqual(
    getRoleplayChecklistSpecs(1).map((c) => c.label),
    ['Made the request', 'Handled courtesy', 'Asked and answered basic questions']
  );
  assert.deepEqual(
    getRoleplayChecklistSpecs(2).map((c) => c.label),
    ['Explained the situation', 'Resolved the complication', 'Narrated what happened']
  );
  assert.deepEqual(
    getRoleplayChecklistSpecs(3).map((c) => c.label),
    ['Supported a position', "Adapted to the other side's concern", 'Handled tone and register']
  );
});

test('isTwistHintVisible only shows twist hint for Levels 2 and 3', () => {
  assert.equal(isTwistHintVisible(1), false);
  assert.equal(isTwistHintVisible(2), true);
  assert.equal(isTwistHintVisible(3), true);
});

test('normalizeRoleplayRegister maps Spanish and Portuguese registers accurately', () => {
  assert.equal(normalizeRoleplayRegister('usted', 'es', 'neutral_latam'), 'usted');
  assert.equal(normalizeRoleplayRegister('tu', 'es', 'neutral_latam'), 'tú');
  assert.equal(normalizeRoleplayRegister('vos', 'es', 'rioplatense'), 'vos');
  assert.equal(normalizeRoleplayRegister('voce', 'pt', 'br_standard'), 'você');
  assert.equal(normalizeRoleplayRegister('tu', 'pt', 'eu_portuguese'), 'tu');
  assert.equal(normalizeRoleplayRegister('invalid', 'pt', 'br_standard'), 'você');
});

test('determineRoleplayPacing introduces complication ~1/3 in for L2-L3 and never for L1', () => {
  const l1Turn2 = determineRoleplayPacing({
    level: 1,
    candidateTurnCount: 2,
    elapsedSeconds: 90,
    complicationIntroduced: false,
  });
  assert.equal(l1Turn2.shouldIntroduceComplication, false);
  assert.equal(l1Turn2.stage, 'negotiation');

  const l2Turn1Early = determineRoleplayPacing({
    level: 2,
    candidateTurnCount: 1,
    elapsedSeconds: 25,
    complicationIntroduced: false,
  });
  assert.equal(l2Turn1Early.shouldIntroduceComplication, false);

  const l2ThirdIn = determineRoleplayPacing({
    level: 2,
    candidateTurnCount: 1,
    elapsedSeconds: 85,
    complicationIntroduced: false,
  });
  assert.equal(l2ThirdIn.shouldIntroduceComplication, true);
  assert.equal(l2ThirdIn.stage, 'complication');

  const l3Turn2 = determineRoleplayPacing({
    level: 3,
    candidateTurnCount: 2,
    elapsedSeconds: 60,
    complicationIntroduced: false,
  });
  assert.equal(l3Turn2.shouldIntroduceComplication, true);

  const closing = determineRoleplayPacing({
    level: 3,
    candidateTurnCount: 6,
    elapsedSeconds: 180,
    complicationIntroduced: true,
  });
  assert.equal(closing.shouldWrapUp, true);
  assert.equal(closing.stage, 'closing');
});

test('normalizeRoleplayChecklist and roleplayChecklistToAssessments feed cleanly into opiRating', () => {
  const checklist = normalizeRoleplayChecklist(
    [
      {itemKey: 'rp_l3_support', status: 'met', evidence: '"Propongo cubrir la mitad del gasto."'},
      {itemKey: 'rp_l3_adapt', status: 'partly', evidence: '"Entiendo el costo, pero es urgente."'},
      {itemKey: 'rp_l3_tone_register', status: 'not_met', evidence: 'Switched to abrupt demands.'},
    ],
    3
  );
  assert.equal(checklist.length, 3);
  assert.equal(checklist[2].status, 'not_met');

  const roleplayAssessments = roleplayChecklistToAssessments(3, checklist);
  assert.equal(roleplayAssessments.length, 3);
  assert.equal(roleplayAssessments[0].phase, 'roleplay');
  assert.equal(roleplayAssessments[0].targetLevel, 3);
  assert.equal(roleplayAssessments[2].outcome, 'breakdown');

  // Combine with Level 2 baseline assessments -> should rate ILR 2+ and surface evidence on Level 3 functions
  const rating = calculateOpiRating([
    {functionKey: 'l2_facts', outcome: 'sustained', evidence: 'Clear facts.', phase: 'level_check', targetLevel: 2},
    {
      functionKey: 'l2_narration_timeframes',
      outcome: 'sustained',
      evidence: 'Past/future clean.',
      phase: 'level_check',
      targetLevel: 2,
    },
    ...roleplayAssessments,
  ]);

  assert.equal(rating.floor, 2);
  assert.equal(rating.displayRating, '2+');
  const supportFn = rating.functionChecks.find((f) => f.functionKey === 'l3_support_opinions');
  assert.equal(supportFn?.status, 'met');
  assert.match(supportFn?.evidence?.[0] ?? '', /Propongo cubrir/);
});
