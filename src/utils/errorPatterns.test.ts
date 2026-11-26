import assert from 'node:assert/strict';
import test from 'node:test';
import {ERROR_TAXONOMY, normalizeErrorTaxonomyKey, sanitizeReportedErrors} from '../data/errorTaxonomy.ts';
import type {ErrorEvent} from '../types.ts';
import {
  appendErrorEventsToStore,
  deriveUserSkillProfile,
  getTopFix,
  pruneErrorEvents,
  rankRecurringErrors,
} from './errorPatterns.ts';

const NOW = Date.parse('2026-11-24T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function makeEvent(overrides: Partial<ErrorEvent> & {key: ErrorEvent['key']}): ErrorEvent {
  return {
    id: `ev-${Math.random().toString(36).slice(2, 8)}`,
    source: 'opi',
    sessionId: 'sess-1',
    wrong: 'Si tengo dinero, compraría una casa',
    fix: 'Si tuviera dinero, compraría una casa',
    language: 'es',
    at: new Date(NOW - DAY).toISOString(),
    ...overrides,
  };
}

test('errorTaxonomy contains grammar, DLPT traps, gist, register, and OPI function keys with required metadata', () => {
  const categories = new Set(ERROR_TAXONOMY.map((e) => e.category));
  assert.deepEqual(categories, new Set(['grammar', 'dlpt_trap', 'gist', 'register', 'opi_function']));

  for (const entry of ERROR_TAXONOMY) {
    assert.ok(entry.label.length > 2);
    assert.ok(entry.explanation.length > 5);
    assert.ok([1, 2, 3].includes(entry.ilrLevel));
    assert.ok(['es', 'pt', 'both'].includes(entry.language));
  }
});

test('errorTaxonomy normalizes ILR function aliases and drops unknown or wrong-language keys strictly', () => {
  assert.equal(normalizeErrorTaxonomyKey('l3_hypothesize', 'es'), 'hypothesize');
  assert.equal(normalizeErrorTaxonomyKey('l2_narration_timeframes', 'pt'), 'narrate_past');
  assert.equal(normalizeErrorTaxonomyKey('futuro_do_subjuntivo', 'pt'), 'futuro_do_subjuntivo');
  assert.equal(normalizeErrorTaxonomyKey('futuro_do_subjuntivo', 'es'), null);
  assert.equal(normalizeErrorTaxonomyKey('si_clause_present_for_subjunctive', 'pt'), null);
  assert.equal(normalizeErrorTaxonomyKey('totally_made_up_key', 'es'), null);

  const sanitized = sanitizeReportedErrors(
    [
      {key: 'si_clause_present_for_subjunctive', wrong: 'si tengo', fix: 'si tuviera', quote: 'si tengo tiempo'},
      {key: 'hallucinated_key', wrong: 'foo', fix: 'bar', quote: 'foo'},
      {key: 'futuro_do_subjuntivo', wrong: 'quando eu vou', fix: 'quando eu for', quote: 'quando eu vou'},
    ],
    'es'
  );
  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].key, 'si_clause_present_for_subjunctive');
});

test('errorPatterns enforces the 60-day retention window on prune and append', () => {
  const oldEvent = makeEvent({
    key: 'por_para',
    at: new Date(NOW - 65 * DAY).toISOString(),
  });
  const freshEvent = makeEvent({
    key: 'ser_estar',
    at: new Date(NOW - 5 * DAY).toISOString(),
  });

  const pruned = pruneErrorEvents([oldEvent, freshEvent], NOW);
  assert.equal(pruned.length, 1);
  assert.equal(pruned[0].key, 'ser_estar');

  const appended = appendErrorEventsToStore([oldEvent], [freshEvent], NOW);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].key, 'ser_estar');
});

test('errorPatterns ignores events older than the 14-day ranking window', () => {
  const stale = makeEvent({key: 'por_para', at: new Date(NOW - 20 * DAY).toISOString()});
  const recent = makeEvent({key: 'ser_estar', at: new Date(NOW - 2 * DAY).toISOString()});

  const ranked = rankRecurringErrors([stale, recent], {language: 'es', nowMs: NOW});
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].key, 'ser_estar');
});

test('errorPatterns weights recency so recent errors outrank equal-count older errors', () => {
  const events: ErrorEvent[] = [
    makeEvent({key: 'por_para', sessionId: 's1', at: new Date(NOW - 12 * DAY).toISOString()}),
    makeEvent({key: 'por_para', sessionId: 's2', at: new Date(NOW - 11 * DAY).toISOString()}),
    makeEvent({key: 'preterite_imperfect', sessionId: 's3', at: new Date(NOW - 1 * DAY).toISOString()}),
    makeEvent({key: 'preterite_imperfect', sessionId: 's4', at: new Date(NOW - 0.5 * DAY).toISOString()}),
  ];

  const ranked = rankRecurringErrors(events, {
    language: 'es',
    currentFloor: 2,
    weakestSkill: 'speaking',
    nowMs: NOW,
  });
  assert.equal(ranked[0].key, 'preterite_imperfect');
  assert.ok(ranked[0].score > ranked[1].score);
});

test('errorPatterns ranks errors at the level just above current floor highest when counts and recency match', () => {
  const sameTime = new Date(NOW - DAY).toISOString();
  const events: ErrorEvent[] = [
    makeEvent({key: 'ser_estar', at: sameTime}),
    makeEvent({key: 'por_para', at: sameTime}),
    makeEvent({key: 'si_clause_present_for_subjunctive', at: sameTime}),
  ];

  const floor2 = rankRecurringErrors(events, {
    language: 'es',
    currentFloor: 2,
    weakestSkill: 'speaking',
    nowMs: NOW,
  });
  assert.equal(floor2[0].key, 'si_clause_present_for_subjunctive');
  assert.equal(floor2[0].isAboveFloorTarget, true);

  const floor1 = rankRecurringErrors(events, {
    language: 'es',
    currentFloor: 1,
    weakestSkill: 'speaking',
    nowMs: NOW,
  });
  assert.equal(floor1[0].key, 'por_para');
  assert.equal(floor1[0].isAboveFloorTarget, true);
});

test('errorPatterns boosts errors matching the user weakest skill', () => {
  const sameTime = new Date(NOW - DAY).toISOString();
  const events: ErrorEvent[] = [
    makeEvent({
      key: 'por_para', // L2 speaking
      source: 'opi',
      at: sameTime,
    }),
    makeEvent({
      key: 'mentioned_not_answer', // L2 listening trap
      source: 'dlpt',
      wrong: 'Picked familiar keyword choice',
      fix: 'Verify choice answers stem directly',
      at: sameTime,
    }),
  ];

  const weakListening = rankRecurringErrors(events, {
    language: 'es',
    currentFloor: 1,
    weakestSkill: 'listening',
    nowMs: NOW,
  });
  assert.equal(weakListening[0].key, 'mentioned_not_answer');
  assert.equal(weakListening[0].matchesWeakestSkill, true);
});

test('errorPatterns aggregates counts, session spread, sources, real example, and returns getTopFix', () => {
  const events: ErrorEvent[] = [
    makeEvent({
      key: 'si_clause_present_for_subjunctive',
      source: 'opi',
      sessionId: 's1',
      wrong: 'Si hay lluvia, cancelaríamos',
      fix: 'Si hubiera lluvia, cancelaríamos',
      at: new Date(NOW - 3 * DAY).toISOString(),
    }),
    makeEvent({
      key: 'si_clause_present_for_subjunctive',
      source: 'talk',
      sessionId: 's2',
      wrong: 'Si tengo tiempo, iría al partido',
      fix: 'Si tuviera tiempo, iría al partido',
      at: new Date(NOW - 1 * DAY).toISOString(),
    }),
    makeEvent({
      key: 'por_para',
      source: 'roleplay',
      sessionId: 's3',
      wrong: 'Gracias para tu ayuda',
      fix: 'Gracias por tu ayuda',
      at: new Date(NOW - 2 * DAY).toISOString(),
    }),
  ];

  const top = getTopFix(events, {language: 'es', currentFloor: 2, weakestSkill: 'speaking', nowMs: NOW});
  assert.ok(top);
  assert.equal(top.key, 'si_clause_present_for_subjunctive');
  assert.equal(top.count, 2);
  assert.equal(top.countLabel, '2×');
  assert.equal(top.sessionRatioLabel, '2 of 3');
  assert.deepEqual(top.sources, ['talk', 'opi']);
  assert.equal(top.sourcesLabel, 'Talk · OPI');
  assert.equal(top.example.wrong, 'Si tengo tiempo, iría al partido');
  assert.equal(top.example.fix, 'Si tuviera tiempo, iría al partido');
});

test('deriveUserSkillProfile derives floor and weakest skill from sessions and DLPT results', () => {
  const profile = deriveUserSkillProfile({
    language: 'es',
    sessions: [
      {
        id: 's1',
        type: 'opi',
        language: 'es',
        dialect: 'mexico',
        startedAt: new Date(NOW - DAY).toISOString(),
        durationSeconds: 300,
        messages: [],
        debrief: {
          generatedAt: new Date(NOW - DAY).toISOString(),
          estimatedIlr: '2+',
          floorLevel: 2,
          summaryAssessment: 'Solid L2 floor.',
          discourseAudit: {
            pointScore: 80,
            reasonScore: 80,
            exampleScore: 80,
            pivotScore: 70,
            cohesionNotes: '',
            subjunctiveControl: '',
            timeFrameStability: '',
          },
          naturalUpgrades: [],
          nextDrillRecommendation: '',
        },
      },
    ],
    dlptResults: [],
    nowMs: NOW,
  });

  assert.equal(profile.currentFloor, 2);
  assert.equal(profile.weakestSkill, 'speaking');
});
