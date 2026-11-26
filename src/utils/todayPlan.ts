import type {ErrorTaxonomyKey} from '../data/errorTaxonomy.ts';
import type {IlrBaseLevel} from '../data/ilrSpeakingLevels.ts';
import type {
  BriefIlrLevel,
  BriefItem,
  DlptDrillResult,
  ErrorEvent,
  IlrGoalLevel,
  IlrGoals,
  MilitaryDomain,
  OpiSession,
  TargetLanguage,
  TodayPlanStepId,
  VocabItem,
} from '../types.ts';
import {isBriefItemDrillable, SEED_BRIEF_ITEMS} from './briefLogic.ts';
import {computeDlptSkillEstimates} from './dlptRules.ts';
import {deriveUserSkillProfile, getTopFix, type RankedErrorPattern} from './errorPatterns.ts';
import {getDomainInfo} from './ilrLogic.ts';
import {getDueVocabCards, sortVocabDeckByFsrs} from './vocabFsrs.ts';

export const ILR_GOAL_OPTIONS: readonly IlrGoalLevel[] = ['1', '1+', '2', '2+', '3', '3+'];

export const DEFAULT_ILR_GOALS: IlrGoals = {
  listening: '3',
  reading: '3',
  speaking: '3',
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function parseIlrLevelNumber(level: string | null | undefined): number | null {
  if (!level) return null;
  const trimmed = level.trim();
  if (trimmed === '0+') return 0.5;
  if (trimmed === '1') return 1.0;
  if (trimmed === '1+') return 1.5;
  if (trimmed === '2') return 2.0;
  if (trimmed === '2+') return 2.5;
  if (trimmed === '3') return 3.0;
  if (trimmed === '3+') return 3.5;
  return null;
}

export function getLocalDateKey(nowMs = Date.now()): string {
  const d = new Date(nowMs);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getPlanCompletionKey(language: TargetLanguage, dateKey: string): string {
  return `${dateKey}:${language}`;
}

/**
 * Computes integer days from local today until an optional YYYY-MM-DD test date.
 * Returns null if unset or invalid.
 */
export function getDaysUntilTest(testDate: string | undefined, nowMs = Date.now()): number | null {
  if (!testDate || !/^\d{4}-\d{2}-\d{2}$/.test(testDate.trim())) return null;
  const [y, m, d] = testDate.trim().split('-').map(Number);
  const targetMidnightUtc = Date.UTC(y, m - 1, d);
  if (!Number.isFinite(targetMidnightUtc)) return null;

  const now = new Date(nowMs);
  const todayMidnightUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((targetMidnightUtc - todayMidnightUtc) / MS_PER_DAY);
}

export function formatTestCountdown(daysUntil: number | null): string | null {
  if (daysUntil === null) return null;
  if (daysUntil < 0) return null;
  if (daysUntil === 0) return 'Test today';
  if (daysUntil === 1) return 'Test in 1 day';
  return `Test in ${daysUntil} days`;
}

export interface SpeakingSkillEstimate {
  estimatedIlr: string | null;
  numeric: number | null;
  floorLevel: 0 | 1 | 2 | 3 | null;
  sessionsRated: number;
  sourceLabel: 'OPI-style';
}

/**
 * Derives a practice Speaking ILR estimate from debriefed OPI sessions and Role-play debriefs.
 */
export function computeSpeakingEstimate(
  sessions: readonly OpiSession[],
  language: TargetLanguage
): SpeakingSkillEstimate {
  const rated = sessions
    .filter((s) => s.language === language && (Boolean(s.debrief) || Boolean(s.roleplayDebrief)))
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

  if (rated.length === 0) {
    return {
      estimatedIlr: null,
      numeric: null,
      floorLevel: null,
      sessionsRated: 0,
      sourceLabel: 'OPI-style',
    };
  }

  // Prefer the newest debriefed OPI; fall back to newest role-play debrief if no OPI debrief exists
  const latestOpi = rated.find((s) => Boolean(s.debrief));
  const latestRoleplay = rated.find((s) => Boolean(s.roleplayDebrief));

  const latestOpiTime = latestOpi ? Date.parse(latestOpi.startedAt) : -Infinity;
  const latestRpTime = latestRoleplay ? Date.parse(latestRoleplay.startedAt) : -Infinity;

  if (latestOpi?.debrief && latestOpiTime >= latestRpTime) {
    const est = latestOpi.debrief.estimatedIlr?.trim() || null;
    const numeric = parseIlrLevelNumber(est);
    const floorLevel =
      latestOpi.debrief.floorLevel === 0 ||
      latestOpi.debrief.floorLevel === 1 ||
      latestOpi.debrief.floorLevel === 2 ||
      latestOpi.debrief.floorLevel === 3
        ? latestOpi.debrief.floorLevel
        : numeric !== null
          ? (Math.max(0, Math.min(3, Math.floor(numeric))) as 0 | 1 | 2 | 3)
          : null;
    return {
      estimatedIlr: est,
      numeric,
      floorLevel,
      sessionsRated: rated.length,
      sourceLabel: 'OPI-style',
    };
  }

  // Derive from role-play debrief
  const rp = latestRoleplay!.roleplayDebrief!;
  let est = String(rp.level);
  if (rp.resolvedOutcome === 'partial') {
    est = rp.level === 1 ? '0+' : rp.level === 2 ? '1+' : '2+';
  } else if (rp.resolvedOutcome === 'unresolved') {
    est = rp.level === 1 ? '0+' : rp.level === 2 ? '1' : '2';
  }
  const numeric = parseIlrLevelNumber(est) ?? rp.level;
  const floorLevel = Math.max(0, Math.min(3, Math.floor(numeric))) as 0 | 1 | 2 | 3;

  return {
    estimatedIlr: est,
    numeric,
    floorLevel,
    sessionsRated: rated.length,
    sourceLabel: 'OPI-style',
  };
}

export type ProfileSkillId = 'listening' | 'reading' | 'speaking';

export interface IlrSkillColumn {
  id: ProfileSkillId;
  label: string;
  level: string | null;
  numeric: number | null;
  goal: IlrGoalLevel;
  goalNumeric: number;
  progressPct: number;
  sourceLabel: 'DLPT-style' | 'OPI-style';
  emptyHint: string;
  drillsCount: number;
}

export interface IlrProfileSummary {
  language: TargetLanguage;
  columns: [IlrSkillColumn, IlrSkillColumn, IlrSkillColumn];
  listening: IlrSkillColumn;
  reading: IlrSkillColumn;
  speaking: IlrSkillColumn;
  speakingFloor: 0 | 1 | 2 | 3 | null;
  weakestSkill: ProfileSkillId;
  weakestSkillLabel: string;
  topError: RankedErrorPattern | null;
  weakestLinkLine: string;
  daysUntilTest: number | null;
  testCountdownLabel: string | null;
}

function computeProgressPct(currentNumeric: number | null, goalNumeric: number): number {
  if (currentNumeric === null || goalNumeric <= 0) return 0;
  return Math.max(4, Math.min(100, Math.round((currentNumeric / goalNumeric) * 100)));
}

const SKILL_LABELS: Record<ProfileSkillId, string> = {
  listening: 'Listening',
  reading: 'Reading',
  speaking: 'Speaking',
};

export function computeIlrProfile(params: {
  language: TargetLanguage;
  sessions: readonly OpiSession[];
  dlptResults: readonly DlptDrillResult[];
  errorEvents: readonly ErrorEvent[];
  goals?: IlrGoals;
  testDate?: string;
  nowMs?: number;
}): IlrProfileSummary {
  const {language, sessions, dlptResults, errorEvents, testDate, nowMs = Date.now()} = params;
  const goals = params.goals ?? DEFAULT_ILR_GOALS;

  const dlpt = computeDlptSkillEstimates(dlptResults, language);
  const speakingEst = computeSpeakingEstimate(sessions, language);

  const lGoalNum = parseIlrLevelNumber(goals.listening) ?? 3;
  const rGoalNum = parseIlrLevelNumber(goals.reading) ?? 3;
  const sGoalNum = parseIlrLevelNumber(goals.speaking) ?? 3;

  const lNum = parseIlrLevelNumber(dlpt.listening.estimatedIlr);
  const rNum = parseIlrLevelNumber(dlpt.reading.estimatedIlr);
  const sNum = speakingEst.numeric;

  const listening: IlrSkillColumn = {
    id: 'listening',
    label: 'Listening',
    level: dlpt.listening.estimatedIlr,
    numeric: lNum,
    goal: goals.listening,
    goalNumeric: lGoalNum,
    progressPct: computeProgressPct(lNum, lGoalNum),
    sourceLabel: 'DLPT-style',
    emptyHint: 'Do 1 drill to estimate',
    drillsCount: dlpt.listening.drillsCompleted,
  };

  const reading: IlrSkillColumn = {
    id: 'reading',
    label: 'Reading',
    level: dlpt.reading.estimatedIlr,
    numeric: rNum,
    goal: goals.reading,
    goalNumeric: rGoalNum,
    progressPct: computeProgressPct(rNum, rGoalNum),
    sourceLabel: 'DLPT-style',
    emptyHint: 'Do 1 drill to estimate',
    drillsCount: dlpt.reading.drillsCompleted,
  };

  const speaking: IlrSkillColumn = {
    id: 'speaking',
    label: 'Speaking',
    level: speakingEst.estimatedIlr,
    numeric: sNum,
    goal: goals.speaking,
    goalNumeric: sGoalNum,
    progressPct: computeProgressPct(sNum, sGoalNum),
    sourceLabel: 'OPI-style',
    emptyHint: 'Do 1 drill to estimate',
    drillsCount: speakingEst.sessionsRated,
  };

  const columns: [IlrSkillColumn, IlrSkillColumn, IlrSkillColumn] = [listening, reading, speaking];

  // Lowest skill: compare measured skills by distance below goal (or raw numeric); if some are unrated, prefer lowest measured, or listening if none rated
  const measured = columns.filter((c) => c.numeric !== null);
  let weakestSkill: ProfileSkillId = 'listening';
  if (measured.length > 0) {
    measured.sort((a, b) => {
      if (a.numeric! !== b.numeric!) return a.numeric! - b.numeric!;
      return b.goalNumeric - b.numeric! - (a.goalNumeric - a.numeric!);
    });
    weakestSkill = measured[0].id;
  }

  const skillProfile = deriveUserSkillProfile({
    language,
    sessions,
    dlptResults,
    events: errorEvents,
    nowMs,
  });

  const topError = getTopFix(errorEvents, {
    language,
    currentFloor: skillProfile.currentFloor,
    weakestSkill: skillProfile.weakestSkill,
    nowMs,
  });

  const weakestSkillLabel = SKILL_LABELS[weakestSkill];
  const weakestLinkLine = topError
    ? `${weakestSkillLabel} · ${topError.entry.label} (${topError.displayCount})`
    : measured.length === 0
      ? `${weakestSkillLabel} · Complete 1 drill to calibrate`
      : `${weakestSkillLabel} · No recurring errors logged yet`;

  const daysUntilTest = getDaysUntilTest(testDate, nowMs);
  const testCountdownLabel = formatTestCountdown(daysUntilTest);

  return {
    language,
    columns,
    listening,
    reading,
    speaking,
    speakingFloor: speakingEst.floorLevel,
    weakestSkill,
    weakestSkillLabel,
    topError,
    weakestLinkLine,
    daysUntilTest,
    testCountdownLabel,
  };
}

// ---------------------------------------------------------------------------
// Local ~25-min Daily Plan Generator (3 items, zero AI calls)
// ---------------------------------------------------------------------------

export interface TodayPlanVocabItem {
  id: 'vocab';
  stepNumber: 1;
  title: string;
  subtitle: string;
  minutes: number;
  dueCount: number;
  warmupCards: VocabItem[];
  isWorkAddon: false;
  highlightAmber: false;
}

export interface TodayPlanBriefItem {
  id: 'brief';
  stepNumber: 2;
  title: string;
  subtitle: string;
  minutes: number;
  drillType: 'dlpt' | 'gist';
  targetSkill: 'listening' | 'reading';
  targetLevel: BriefIlrLevel;
  briefItem: BriefItem;
  isWorkAddon: boolean;
  highlightAmber: false;
}

export type TodayPlanSpeakingKind = 'fix_drill' | 'opi_brief_back' | 'roleplay' | 'talk_work';

export interface TodayPlanSpeakingItem {
  id: 'speaking';
  stepNumber: 3;
  kind: TodayPlanSpeakingKind;
  title: string;
  subtitle: string;
  minutes: number;
  errorKey?: ErrorTaxonomyKey;
  errorLabel?: string;
  briefItem?: BriefItem;
  probeLevel?: IlrBaseLevel;
  workDomain?: MilitaryDomain;
  isWorkAddon: boolean;
  highlightAmber: true;
}

export type TodayPlanItem = TodayPlanVocabItem | TodayPlanBriefItem | TodayPlanSpeakingItem;

export interface TodayPlan {
  dateKey: string;
  language: TargetLanguage;
  totalMinutes: number;
  items: [TodayPlanVocabItem, TodayPlanBriefItem, TodayPlanSpeakingItem];
  workAddonSlot: 'brief' | 'speaking' | null;
}

const BRIEF_LEVELS_ORDER: readonly BriefIlrLevel[] = ['2', '2+', '3', '3+'];

function dateKeyToDayNumber(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return 0;
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

function targetBriefLevelFromEstimate(estimateNumeric: number | null): BriefIlrLevel {
  if (estimateNumeric === null) return '2+';
  if (estimateNumeric < 2.0) return '2';
  if (estimateNumeric < 2.5) return '2+';
  if (estimateNumeric < 3.0) return '3';
  return '3+';
}

function levelDistance(a: BriefIlrLevel, b: BriefIlrLevel): number {
  return Math.abs(BRIEF_LEVELS_ORDER.indexOf(a) - BRIEF_LEVELS_ORDER.indexOf(b));
}

function pickBriefStory(params: {
  pool: readonly BriefItem[];
  language: TargetLanguage;
  mediaType: 'audio' | 'text';
  targetLevel: BriefIlrLevel;
  dayNumber: number;
  workDomain?: MilitaryDomain;
}): BriefItem {
  const {pool, language, mediaType, targetLevel, dayNumber, workDomain} = params;
  // Only items with real source text can be drilled (REVIEW C-2).
  const langItems = pool.filter((item) => item.language === language && isBriefItemDrillable(item));
  const sourcePool = langItems.length > 0 ? langItems : SEED_BRIEF_ITEMS.filter((item) => item.language === language);

  let candidates = sourcePool.filter((item) => item.mediaType === mediaType);
  if (candidates.length === 0) candidates = sourcePool;

  if (workDomain) {
    const domainExact = candidates.filter((item) => item.matchingDomains?.includes(workDomain));
    if (domainExact.length > 0) {
      candidates = domainExact;
    } else {
      const anyDomainInLang = sourcePool.filter((item) => item.matchingDomains?.includes(workDomain));
      if (anyDomainInLang.length > 0) candidates = anyDomainInLang;
      else {
        const anyWorkItem = sourcePool.filter((item) => item.matchingDomains && item.matchingDomains.length > 0);
        if (anyWorkItem.length > 0) candidates = anyWorkItem;
      }
    }
  }

  // Sort by closest ILR level, then rotate deterministically by dayNumber among close ties
  const ranked = [...candidates].sort((a, b) => {
    const distDiff = levelDistance(a.ilrLevel, targetLevel) - levelDistance(b.ilrLevel, targetLevel);
    if (distDiff !== 0) return distDiff;
    return a.id.localeCompare(b.id);
  });

  const bestDist = levelDistance(ranked[0].ilrLevel, targetLevel);
  const topTier = ranked.filter((item) => levelDistance(item.ilrLevel, targetLevel) <= bestDist + 1);
  return topTier[Math.abs(dayNumber) % topTier.length] ?? ranked[0];
}

function isSpeakingFixCategory(topError: RankedErrorPattern | null): boolean {
  if (!topError) return false;
  const cat = topError.entry.category;
  return cat === 'grammar' || cat === 'opi_function' || cat === 'register';
}

/**
 * Generates the daily 3-item (~25 min) training plan locally with zero AI calls.
 *
 * (1) Vocab warm-up of FSRS cards due today.
 * (2) Brief drill (DLPT or Gist) for the weaker of Listening/Reading at the right level from all topics.
 * (3) Speaking item (amber border): 2-min fix if a grammar/function error tops the list;
 *     otherwise OPI "Brief it back" on Item 2's story when speaking floor >= 2+, or a Role-play at probe level.
 *
 * When Work focus is ON, every other day alternates replacing either Item 2 (Work Brief)
 * or Item 3 (Talk -> Work talk) so work language remains an add-on rather than the core.
 */
export function generateTodayPlan(params: {
  language: TargetLanguage;
  domain: MilitaryDomain;
  workFocusEnabled: boolean;
  vocabItems: readonly VocabItem[];
  sessions: readonly OpiSession[];
  dlptResults: readonly DlptDrillResult[];
  errorEvents: readonly ErrorEvent[];
  briefPool?: readonly BriefItem[];
  goals?: IlrGoals;
  testDate?: string;
  dateKey?: string;
  nowMs?: number;
}): {plan: TodayPlan; profile: IlrProfileSummary} {
  const {
    language,
    domain,
    workFocusEnabled,
    vocabItems,
    sessions,
    dlptResults,
    errorEvents,
    briefPool = SEED_BRIEF_ITEMS,
    goals = DEFAULT_ILR_GOALS,
    testDate,
    nowMs = Date.now(),
  } = params;

  const dateKey = params.dateKey ?? getLocalDateKey(nowMs);
  const dayNumber = dateKeyToDayNumber(dateKey);

  const profile = computeIlrProfile({
    language,
    sessions,
    dlptResults,
    errorEvents,
    goals,
    testDate,
    nowMs,
  });

  // Work focus alternation: every other day (even dayNumber), alternate between slot 2 ('brief') and slot 3 ('speaking')
  let workAddonSlot: 'brief' | 'speaking' | null = null;
  if (workFocusEnabled && Math.abs(dayNumber) % 2 === 0) {
    workAddonSlot = Math.abs(dayNumber) % 4 === 0 ? 'brief' : 'speaking';
  }

  // --- Item 1: Vocab warm-up (FSRS due today) ---
  const dueCards = getDueVocabCards(vocabItems, language, nowMs);
  const langVocabSorted = sortVocabDeckByFsrs(
    vocabItems.filter((v) => v.language === language),
    nowMs
  );
  const warmupCards = (dueCards.length > 0 ? dueCards : langVocabSorted).slice(0, 6);
  const vocabItem: TodayPlanVocabItem = {
    id: 'vocab',
    stepNumber: 1,
    title: 'Vocab warm-up',
    subtitle:
      dueCards.length > 0
        ? `${dueCards.length} ${dueCards.length === 1 ? 'card' : 'cards'} due today · FSRS active recall`
        : warmupCards.length > 0
          ? `All caught up · Quick ${warmupCards.length}-card refresh`
          : 'Save a word in Talk or Brief to start FSRS recall',
    minutes: 5,
    dueCount: dueCards.length,
    warmupCards,
    isWorkAddon: false,
    highlightAmber: false,
  };

  // --- Item 2: Brief drill (weaker of Listening vs Reading) ---
  const lNum = profile.listening.numeric;
  const rNum = profile.reading.numeric;
  let weakerBriefSkill: 'listening' | 'reading' = 'listening';
  if (lNum !== null && rNum !== null) {
    weakerBriefSkill = rNum < lNum ? 'reading' : 'listening';
  } else if (lNum !== null && rNum === null) {
    weakerBriefSkill = 'reading';
  } else {
    weakerBriefSkill = 'listening';
  }

  const targetLevel = targetBriefLevelFromEstimate(weakerBriefSkill === 'listening' ? lNum : rNum);
  const isWorkBrief = workAddonSlot === 'brief';
  const domainInfo = getDomainInfo(domain);

  const chosenStory = pickBriefStory({
    pool: briefPool.length > 0 ? briefPool : SEED_BRIEF_ITEMS,
    language,
    mediaType: weakerBriefSkill === 'listening' ? 'audio' : 'text',
    targetLevel,
    dayNumber,
    workDomain: isWorkBrief ? domain : undefined,
  });

  const effectiveSkill: 'listening' | 'reading' = chosenStory.mediaType === 'audio' ? 'listening' : 'reading';
  const preferGist =
    chosenStory.mediaType === 'audio' &&
    !isWorkBrief &&
    (profile.topError?.entry.category === 'gist' || Math.abs(dayNumber) % 3 === 1);
  const drillType: 'dlpt' | 'gist' = preferGist ? 'gist' : 'dlpt';

  const briefItem: TodayPlanBriefItem = {
    id: 'brief',
    stepNumber: 2,
    title: isWorkBrief
      ? `Work Brief · ${domainInfo.shortLabel}`
      : drillType === 'gist'
        ? `Listening Gist · ILR ${chosenStory.ilrLevel}`
        : `${effectiveSkill === 'listening' ? 'Listening' : 'Reading'} DLPT · ILR ${chosenStory.ilrLevel}`,
    subtitle: chosenStory.title,
    minutes: drillType === 'gist' ? 6 : 10,
    drillType,
    targetSkill: effectiveSkill,
    targetLevel: chosenStory.ilrLevel,
    briefItem: chosenStory,
    isWorkAddon: isWorkBrief,
    highlightAmber: false,
  };

  // --- Item 3: Speaking (amber border) ---
  let speakingItem: TodayPlanSpeakingItem;

  if (workAddonSlot === 'speaking') {
    speakingItem = {
      id: 'speaking',
      stepNumber: 3,
      kind: 'talk_work',
      title: `Work talk · ${domainInfo.shortLabel}`,
      subtitle: 'Job-focused dialect conversation on duties, procedures & coordination',
      minutes: 10,
      workDomain: domain,
      isWorkAddon: true,
      highlightAmber: true,
    };
  } else if (isSpeakingFixCategory(profile.topError) && profile.topError) {
    speakingItem = {
      id: 'speaking',
      stepNumber: 3,
      kind: 'fix_drill',
      title: `2-min fix · ${profile.topError.entry.label}`,
      subtitle: `8 rapid voice prompts targeting your #1 recurring error (${profile.topError.displayCount})`,
      minutes: 2,
      errorKey: profile.topError.key,
      errorLabel: profile.topError.entry.label,
      isWorkAddon: false,
      highlightAmber: true,
    };
  } else if (profile.speaking.numeric !== null && profile.speaking.numeric >= 2.5) {
    speakingItem = {
      id: 'speaking',
      stepNumber: 3,
      kind: 'opi_brief_back',
      title: 'OPI · Brief it back',
      subtitle: `Defend and analyze today's Brief story: "${chosenStory.title}"`,
      minutes: 10,
      briefItem: chosenStory,
      isWorkAddon: false,
      highlightAmber: true,
    };
  } else {
    // Role-play at user's probe level (floor + 1, clamped 2..3 for L1/L2, or 2 if unrated)
    const probeLevel: IlrBaseLevel =
      profile.speakingFloor === null ? 2 : profile.speakingFloor >= 2 ? 3 : profile.speakingFloor === 1 ? 2 : 1;
    speakingItem = {
      id: 'speaking',
      stepNumber: 3,
      kind: 'roleplay',
      title: `Role-play · Level ${probeLevel} probe`,
      subtitle: 'Everyday situational task with an unexpected complication',
      minutes: 8,
      probeLevel,
      isWorkAddon: false,
      highlightAmber: true,
    };
  }

  const totalMinutes = vocabItem.minutes + briefItem.minutes + speakingItem.minutes;

  return {
    profile,
    plan: {
      dateKey,
      language,
      totalMinutes,
      items: [vocabItem, briefItem, speakingItem],
      workAddonSlot,
    },
  };
}
