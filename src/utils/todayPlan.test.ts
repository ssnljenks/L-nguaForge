import assert from 'node:assert/strict';
import test from 'node:test';
import type {BriefItem, DlptDrillResult, ErrorEvent, OpiSession, VocabItem} from '../types.ts';
import {SEED_BRIEF_ITEMS} from './briefLogic.ts';
import {computeIlrProfile, formatTestCountdown, generateTodayPlan, getDaysUntilTest} from './todayPlan.ts';

const NOW = Date.parse('2026-11-24T15:00:00.000Z');

function makeVocab(id: string, language: 'es' | 'pt' = 'es'): VocabItem {
  return {
    id,
    term: `term-${id}`,
    englishConcept: `meaning-${id}`,
    contextSentence: `Sentence for ${id}`,
    registerTag: 'Formal',
    category: 'High-Register Connectors',
    language,
    dialect: language === 'es' ? 'neutral_latam' : 'br_standard',
    createdAt: '2026-11-20T12:00:00.000Z',
    mastery: 'new',
    reviewCount: 0,
  };
}

function makeDlptResult(
  skill: 'listening' | 'reading',
  level: '2' | '2+' | '3',
  correctCount: number
): DlptDrillResult {
  const outcomes = [0, 1, 2].map((i) => ({
    questionId: `q-${skill}-${i}`,
    briefId: `b-${skill}`,
    ilrLevel: level,
    questionType: 'detail' as const,
    correct: i < correctCount,
    answered: true,
  }));
  return {
    id: `dlpt-${skill}`,
    completedAt: new Date(NOW - 3600 * 1000).toISOString(),
    language: 'es',
    dialect: 'neutral_latam',
    skill,
    mode: 'test',
    profileId: 'dlpt5_ca',
    passageIds: [`b-${skill}`],
    passageLevels: [level],
    totalQuestions: 3,
    correctCount,
    outcomes,
    trapsMissed: {},
  };
}

function makeOpiSession(estimatedIlr: string, floorLevel: 0 | 1 | 2 | 3): OpiSession {
  return {
    id: `opi-${estimatedIlr}`,
    type: 'opi',
    language: 'es',
    dialect: 'neutral_latam',
    startedAt: new Date(NOW - 2 * 3600 * 1000).toISOString(),
    durationSeconds: 300,
    messages: [],
    debrief: {
      generatedAt: new Date(NOW - 2 * 3600 * 1000).toISOString(),
      estimatedIlr,
      floorLevel,
      summaryAssessment: 'Practice summary',
      discourseAudit: {
        pointScore: 80,
        reasonScore: 78,
        exampleScore: 75,
        pivotScore: 70,
        cohesionNotes: '',
        subjunctiveControl: '',
        timeFrameStability: '',
      },
      naturalUpgrades: [],
      nextDrillRecommendation: '',
    },
  };
}

function makeErrorEvent(key: ErrorEvent['key']): ErrorEvent {
  return {
    id: `ev-${key}`,
    key,
    source: 'opi',
    sessionId: 'sess-1',
    wrong: 'si tengo dinero, compro',
    fix: 'si tuviera dinero, compraría',
    language: 'es',
    at: new Date(NOW - 1000 * 60 * 60).toISOString(),
  };
}

test('computeIlrProfile shows empty state with Do 1 drill to estimate and formats test countdown', () => {
  const profile = computeIlrProfile({
    language: 'es',
    sessions: [],
    dlptResults: [],
    errorEvents: [],
    testDate: '2026-12-08',
    nowMs: NOW,
  });

  assert.equal(profile.listening.level, null);
  assert.equal(profile.reading.level, null);
  assert.equal(profile.speaking.level, null);
  assert.equal(profile.listening.emptyHint, 'Do 1 drill to estimate');
  assert.equal(profile.listening.sourceLabel, 'DLPT-style');
  assert.equal(profile.speaking.sourceLabel, 'OPI-style');
  assert.equal(profile.listening.goal, '3');
  assert.equal(getDaysUntilTest('2026-12-08', NOW), 14);
  assert.equal(profile.testCountdownLabel, 'Test in 14 days');
  assert.equal(formatTestCountdown(0), 'Test today');
  assert.equal(formatTestCountdown(1), 'Test in 1 day');
});

test('computeIlrProfile computes Speaking estimate from role-play debrief when no OPI debrief exists', () => {
  const rpSession: OpiSession = {
    id: 'rp-1',
    type: 'roleplay',
    language: 'es',
    dialect: 'neutral_latam',
    startedAt: new Date(NOW - 3600 * 1000).toISOString(),
    durationSeconds: 200,
    messages: [],
    roleplayDebrief: {
      scenarioId: 'sc-1',
      level: 2,
      situationEnglish: 'Hotel desk issue',
      learnerGoal: 'Get a quiet room',
      characterRole: 'Clerk',
      register: 'usted',
      hiddenGoal: 'Check availability',
      complication: 'No standard rooms left',
      checklist: [],
      summary: 'Resolved cleanly',
      resolvedOutcome: 'resolved',
      generatedAt: new Date(NOW - 3600 * 1000).toISOString(),
    },
  };

  const profile = computeIlrProfile({
    language: 'es',
    sessions: [rpSession],
    dlptResults: [makeDlptResult('listening', '2+', 3)],
    errorEvents: [],
    nowMs: NOW,
  });

  assert.equal(profile.speaking.level, '2');
  assert.equal(profile.listening.level, '2+');
  assert.equal(profile.weakestSkill, 'speaking');
});

test('generateTodayPlan picks 2-min fix when a grammar/function error tops the error log', () => {
  const {plan} = generateTodayPlan({
    language: 'es',
    domain: 'maritime_surveillance',
    workFocusEnabled: false,
    vocabItems: [makeVocab('1'), makeVocab('2')],
    sessions: [makeOpiSession('2+', 2)],
    dlptResults: [makeDlptResult('listening', '2+', 3), makeDlptResult('reading', '2', 2)],
    errorEvents: [
      makeErrorEvent('si_clause_present_for_subjunctive'),
      makeErrorEvent('si_clause_present_for_subjunctive'),
    ],
    dateKey: '2026-11-25',
    nowMs: NOW,
  });

  assert.equal(plan.items[0].id, 'vocab');
  assert.equal(plan.items[0].dueCount, 2);
  // Reading (2) is weaker than Listening (2+) -> Brief picks a reading item
  assert.equal(plan.items[1].targetSkill, 'reading');
  assert.equal(plan.items[1].briefItem.mediaType, 'text');
  // Item 3 picks 2-min fix with amber highlight
  assert.equal(plan.items[2].kind, 'fix_drill');
  assert.equal(plan.items[2].errorKey, 'si_clause_present_for_subjunctive');
  assert.equal(plan.items[2].highlightAmber, true);
});

test('generateTodayPlan picks OPI Brief-it-back when speaking >= 2+ and Role-play when below 2+', () => {
  const high = generateTodayPlan({
    language: 'es',
    domain: 'maritime_surveillance',
    workFocusEnabled: false,
    vocabItems: [makeVocab('1')],
    sessions: [makeOpiSession('2+', 2)],
    dlptResults: [],
    errorEvents: [],
    dateKey: '2026-11-25',
    nowMs: NOW,
  });
  assert.equal(high.plan.items[2].kind, 'opi_brief_back');
  assert.equal(high.plan.items[2].briefItem?.id, high.plan.items[1].briefItem.id);

  const low = generateTodayPlan({
    language: 'es',
    domain: 'maritime_surveillance',
    workFocusEnabled: false,
    vocabItems: [makeVocab('1')],
    sessions: [makeOpiSession('1+', 1)],
    dlptResults: [],
    errorEvents: [],
    dateKey: '2026-11-25',
    nowMs: NOW,
  });
  assert.equal(low.plan.items[2].kind, 'roleplay');
  assert.equal(low.plan.items[2].probeLevel, 2);
});

test('generateTodayPlan alternates Work focus add-on every other day between Item 2 (Work Brief) and Item 3 (Work talk)', () => {
  const dates = ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27'];
  const slots = dates.map(
    (dateKey) =>
      generateTodayPlan({
        language: 'es',
        domain: 'maritime_surveillance',
        workFocusEnabled: true,
        vocabItems: [makeVocab('1')],
        sessions: [makeOpiSession('2+', 2)],
        dlptResults: [],
        errorEvents: [],
        dateKey,
        nowMs: NOW,
      }).plan.workAddonSlot
  );

  // Every other day is null, and the active work days alternate 'brief' and 'speaking'
  assert.equal(slots.filter((s) => s === null).length, 2);
  assert.equal(slots.filter((s) => s === 'brief').length, 1);
  assert.equal(slots.filter((s) => s === 'speaking').length, 1);

  // Verify the 'speaking' work day creates a talk_work item
  const workTalkDate = dates[slots.indexOf('speaking')];
  const {plan: workTalkPlan} = generateTodayPlan({
    language: 'es',
    domain: 'maritime_surveillance',
    workFocusEnabled: true,
    vocabItems: [makeVocab('1')],
    sessions: [makeOpiSession('2+', 2)],
    dlptResults: [],
    errorEvents: [],
    dateKey: workTalkDate,
    nowMs: NOW,
  });
  assert.equal(workTalkPlan.items[2].kind, 'talk_work');
  assert.equal(workTalkPlan.items[2].isWorkAddon, true);
  assert.equal(workTalkPlan.items[1].isWorkAddon, false);
});

test('generateTodayPlan never picks a non-drillable item (feed audio without a transcript) for the Brief drill (REVIEW C-2)', () => {
  const audioNoTranscript: BriefItem = {
    ...SEED_BRIEF_ITEMS.find((i) => i.language === 'es')!,
    id: 'es-feed-audio-1',
    mediaType: 'audio',
    audioUrl: 'https://audio.example.test/a.mp3',
    sourceName: 'Test Radio',
    sourceUrl: 'https://radio.example.test',
    drillable: false,
  };
  for (const dateKey of ['2026-11-25', '2026-11-26', '2026-11-27']) {
    const {plan} = generateTodayPlan({
      language: 'es',
      domain: 'maritime_surveillance',
      workFocusEnabled: false,
      vocabItems: [],
      sessions: [],
      // Listening is weaker, so the plan wants an audio item.
      dlptResults: [makeDlptResult('listening', '2', 1), makeDlptResult('reading', '3', 3)],
      errorEvents: [],
      briefPool: [audioNoTranscript, ...SEED_BRIEF_ITEMS],
      dateKey,
      nowMs: NOW,
    });
    const brief = plan.items.find((i) => 'briefItem' in i && i.briefItem) as {briefItem: BriefItem} | undefined;
    assert.ok(brief, 'plan includes a Brief item');
    assert.notEqual(brief.briefItem.id, 'es-feed-audio-1');
    assert.notEqual(brief.briefItem.drillable, false);
  }
});
