import {
  getFunctionLevel,
  getFunctionsForLevel,
  getFunctionSpec,
  type IlrBaseLevel,
  type IlrFunctionKey,
  isIlrFunctionKey,
} from '../data/ilrSpeakingLevels.ts';
import type {
  IlrFunctionCheck,
  IlrFunctionRating,
  OpiFocusLevel,
  OpiPhase,
  OpiProbeLevel,
  OpiWorkingLevel,
  TurnAssessment,
  TurnOutcome,
} from '../types.ts';

export const OPI_STANDARD_DURATION_SECONDS = 18 * 60;
export const OPI_TARGETED_RETRY_DURATION_SECONDS = 3 * 60;

export const OPI_PHASES: readonly OpiPhase[] = ['warmup', 'level_check', 'probe', 'roleplay', 'wind_down'];

export const BREAKDOWN_DETECTION_SIGNALS: readonly string[] = [
  'long pauses or stalling before answering',
  'falling back to English words or explanations',
  'retreating to simpler structures instead of performing the requested function',
  'being unable to complete the requested function',
  'frequent requests for repetition or rewording',
];

const LEGACY_FUNCTION_MAP: Record<string, IlrFunctionKey> = {
  support_opinion: 'l3_support_opinions',
  hypothesize: 'l3_hypothesize',
  abstract_topics: 'l3_unfamiliar_abstract',
  extended_discourse: 'l3_describe_explain_detail',
};

export function normalizeIlrFunctionKey(raw: unknown, fallbackLevel: IlrBaseLevel = 3): IlrFunctionKey {
  if (isIlrFunctionKey(raw)) return raw;
  const text = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (text in LEGACY_FUNCTION_MAP) return LEGACY_FUNCTION_MAP[text];

  if (text.includes('hypothe') || text.includes('subjunc') || text.includes('counterfactual')) return 'l3_hypothesize';
  if (text.includes('overtone') || text.includes('emotion') || text.includes('tone')) return 'l3_detect_overtones';
  if (text.includes('infer') || text.includes('between the lines')) return 'l3_infer';
  if (text.includes('opinion') || text.includes('support') || text.includes('defend')) return 'l3_support_opinions';
  if (text.includes('abstract') || text.includes('unfamiliar') || text.includes('policy')) {
    return 'l3_unfamiliar_abstract';
  }
  if (text.includes('explain') || text.includes('detail') || text.includes('extended') || text.includes('discourse')) {
    return 'l3_describe_explain_detail';
  }
  if (text.includes('complicat') || text.includes('resolv')) return 'l2_resolve_complication';
  if (text.includes('narrat') || text.includes('past') || text.includes('future') || text.includes('time')) {
    return 'l2_narration_timeframes';
  }
  if (text.includes('instruct') || text.includes('direction')) return 'l2_instructions_directions';
  if (text.includes('descrip')) return 'l2_concrete_descriptions';
  if (text.includes('casual')) return 'l2_casual_conversation';
  if (text.includes('fact')) return 'l2_facts';
  if (text.includes('courtesy')) return 'l1_courtesy';
  if (text.includes('creat')) return 'l1_creating_language';
  if (text.includes('travel') || text.includes('daily')) return 'l1_daily_travel_questions';
  if (text.includes('short')) return 'l1_short_conversations';
  if (text.includes('main')) return 'l1_main_ideas';
  if (text.includes('simple') || text.includes('q&a')) return 'l1_simple_qa';

  if (fallbackLevel === 1) return 'l1_simple_qa';
  if (fallbackLevel === 2) return 'l2_narration_timeframes';
  return 'l3_hypothesize';
}

export function normalizeIlrFunctionRating(raw: unknown): IlrFunctionRating {
  const text = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (text === 'met' || text === 'pass' || text === 'strong' || text === 'sustained') return 'met';
  if (text === 'partly' || text === 'partial' || text === 'partially' || text === 'developing') return 'partly';
  return 'not_met';
}

export function normalizeTurnOutcome(raw: unknown): TurnOutcome {
  const text = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (text === 'sustained' || text === 'met' || text === 'strong') return 'sustained';
  if (text === 'partial' || text === 'partly' || text === 'developing') return 'partial';
  return 'breakdown';
}

export function normalizeOpiPhase(raw: unknown, fallback: OpiPhase = 'level_check'): OpiPhase {
  if (raw === 'probes') return 'probe';
  if (typeof raw === 'string' && (OPI_PHASES as readonly string[]).includes(raw)) {
    return raw as OpiPhase;
  }
  return fallback;
}

export function migrateLegacyLevels(
  rawWorkingLevel: unknown,
  rawProbeLevel: unknown
): {workingLevel: OpiWorkingLevel; probeLevel: OpiProbeLevel} {
  let workingLevel: OpiWorkingLevel = 2;
  if (rawWorkingLevel === 1 || rawWorkingLevel === 2 || rawWorkingLevel === 3) {
    workingLevel = rawWorkingLevel;
  } else if (rawProbeLevel === 'level_2_baseline') {
    workingLevel = 2;
  }

  let probeLevel: OpiProbeLevel;
  if (rawProbeLevel === 2 || rawProbeLevel === 3) {
    probeLevel = rawProbeLevel;
  } else if (rawProbeLevel === 'level_3_probe') {
    probeLevel = 3;
  } else if (rawProbeLevel === 'level_2_baseline') {
    probeLevel = 3;
  } else {
    probeLevel = workingLevel === 1 ? 2 : 3;
  }

  return {workingLevel, probeLevel};
}

export function normalizeLevelFunctions(raw: unknown, targetLevel: IlrBaseLevel = 3): IlrFunctionCheck[] {
  const specs = getFunctionsForLevel(targetLevel);
  const byKey = new Map<IlrFunctionKey, IlrFunctionCheck>();
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const rec = entry as Record<string, unknown>;
      const key = normalizeIlrFunctionKey(rec.functionKey ?? rec.id ?? rec.label, targetLevel);
      if (getFunctionLevel(key) !== targetLevel) continue;
      const spec = getFunctionSpec(key);
      if (!spec) continue;
      const evidence = Array.isArray(rec.evidence)
        ? rec.evidence.filter((e): e is string => typeof e === 'string' && Boolean(e.trim())).slice(0, 6)
        : undefined;
      byKey.set(key, {
        functionKey: key,
        label: spec.label,
        status: normalizeIlrFunctionRating(rec.status),
        note: typeof rec.note === 'string' ? rec.note.trim().slice(0, 260) : '',
        ...(evidence?.length ? {evidence} : {}),
      });
    }
  }

  return specs.map(
    (spec) =>
      byKey.get(spec.functionKey) ?? {
        functionKey: spec.functionKey,
        label: spec.label,
        status: 'partly',
        note: 'Limited evidence captured in this sample.',
      }
  );
}

/** Counts how many non-warmup turns have assessed each functionKey. */
export function countAssessmentsByFunction(assessments: readonly TurnAssessment[]): Map<IlrFunctionKey, number> {
  const counts = new Map<IlrFunctionKey, number>();
  for (const a of assessments) {
    if (a.phase === 'warmup') continue;
    counts.set(a.functionKey, (counts.get(a.functionKey) ?? 0) + 1);
  }
  return counts;
}

/**
 * Picks the next function to check/probe at `level`, prioritizing functions with fewer than 2 probes
 * so ceiling checks always satisfy >= 2 probes per function before rotation completes.
 */
export function pickNextFunctionForLevel(
  level: IlrBaseLevel,
  assessments: readonly TurnAssessment[],
  preferredKey?: IlrFunctionKey,
  preferFollowUp = false
): IlrFunctionKey {
  const specs = getFunctionsForLevel(level);
  if (preferredKey && getFunctionLevel(preferredKey) === level) {
    return preferredKey;
  }
  const counts = countAssessmentsByFunction(assessments);
  if (preferFollowUp) {
    const needsSecondProbe = specs.find((s) => (counts.get(s.functionKey) ?? 0) === 1);
    if (needsSecondProbe) return needsSecondProbe.functionKey;
  }
  const underTwo = specs.filter((s) => (counts.get(s.functionKey) ?? 0) < 2);
  const pool = underTwo.length > 0 ? underTwo : specs;
  let best = pool[0];
  let minCount = counts.get(best.functionKey) ?? 0;
  for (const candidate of pool) {
    const c = counts.get(candidate.functionKey) ?? 0;
    if (c < minCount) {
      best = candidate;
      minCount = c;
    }
  }
  return best.functionKey;
}

const CLIENT_BREAKDOWN_HINTS = [
  'no entiendo',
  'não entendo',
  'no sé cómo decir',
  'não sei como dizer',
  'puede repetir',
  'pode repetir',
  'no recuerdo la palabra',
  'não lembro a palavra',
  "i don't know how to say",
  'in english',
];

export function hasCandidateBreakdownSignal(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return false;
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 5) return true;
  return CLIENT_BREAKDOWN_HINTS.some((sig) => trimmed.includes(sig));
}

export interface DetermineNextOpiStepInput {
  elapsedSeconds: number;
  candidateTurnCount: number;
  currentPhase: OpiPhase;
  workingLevel: OpiWorkingLevel;
  focusLevel?: OpiFocusLevel;
  includeRoleplay?: boolean;
  roleplayDone?: boolean;
  roleplayTurnsCount?: number;
  roleplayResolved?: boolean;
  assessments?: readonly TurnAssessment[];
  durationTargetSeconds?: number;
  targetFunctionKey?: IlrFunctionKey;
  lastCandidateText?: string;
  lastOutcome?: TurnOutcome;
}

export interface DetermineNextOpiStepOutput {
  phase: OpiPhase;
  workingLevel: OpiWorkingLevel;
  probeLevel: OpiProbeLevel;
  targetFunctionKey: IlrFunctionKey;
  reason: string;
}

/**
 * Pure ILR OPI adaptive state machine:
 * - Warmup (~2 min): unrated personal relaxation turns.
 * - Default adaptive flow: Level 2 checks -> alternate L2 checks and L3 probes (at least 2 probes per ceiling fn)
 *   -> drop to Level 1 checks & L2 probes if L2 breaks down -> optional Role-play hook -> Wind-down at comfortable level.
 * - Fixed focus (Practice mode 1/2/3): keeps checks & probes anchored around the chosen level.
 * - Never ends mid-breakdown: backs down to a comfortable level before/during wind-down.
 */
export function determineNextOpiStep(input: DetermineNextOpiStepInput): DetermineNextOpiStepOutput {
  const {
    elapsedSeconds,
    candidateTurnCount,
    currentPhase,
    workingLevel: prevWorking,
    focusLevel = 'adaptive',
    includeRoleplay = true,
    roleplayDone = false,
    roleplayTurnsCount = 0,
    roleplayResolved = false,
    assessments = [],
    durationTargetSeconds = input.targetFunctionKey
      ? OPI_TARGETED_RETRY_DURATION_SECONDS
      : OPI_STANDARD_DURATION_SECONDS,
    targetFunctionKey,
    lastCandidateText = '',
    lastOutcome,
  } = input;

  const safeElapsed = Math.max(0, Math.floor(elapsedSeconds));
  const safeTarget = Math.max(60, Math.floor(durationTargetSeconds));
  const rated = assessments.filter((a) => a.phase !== 'warmup');
  const effectiveOutcome: TurnOutcome | undefined =
    lastOutcome ??
    (candidateTurnCount >= 2 && hasCandidateBreakdownSignal(lastCandidateText) ? 'breakdown' : undefined);

  const windDownSeconds = Math.round(safeTarget * 0.82);
  const windDownTurns = targetFunctionKey ? 3 : 12;
  const nearTimeLimit = safeElapsed >= windDownSeconds || candidateTurnCount >= windDownTurns;

  // Continue an in-progress role-play for ~3 turns (until hidden goal/compromise is resolved) before wrapping up
  if (
    includeRoleplay &&
    !roleplayDone &&
    currentPhase === 'roleplay' &&
    !roleplayResolved &&
    roleplayTurnsCount < 3 &&
    safeElapsed < Math.round(safeTarget * 0.92)
  ) {
    const activeProbe: OpiProbeLevel =
      focusLevel !== 'adaptive' ? (focusLevel === 1 ? 2 : 3) : prevWorking === 1 ? 2 : 3;
    const rpKey: IlrFunctionKey = activeProbe === 2 ? 'l2_resolve_complication' : 'l3_support_opinions';
    return {
      phase: 'roleplay',
      workingLevel: prevWorking,
      probeLevel: activeProbe,
      targetFunctionKey: rpKey,
      reason: `Continuing role-play interaction (${roleplayTurnsCount + 1}/3 turns) at Level ${activeProbe}.`,
    };
  }

  // Never end mid-breakdown: if right at the wind-down boundary after a breakdown and still under 92% budget,
  // give one comfortable stabilization check first, otherwise drop workingLevel for a smooth wind-down win.
  if (nearTimeLimit) {
    const safeFinishLevel: OpiWorkingLevel =
      effectiveOutcome === 'breakdown'
        ? (Math.max(1, prevWorking - 1) as OpiWorkingLevel)
        : prevWorking === 3
          ? 2
          : prevWorking;

    if (
      effectiveOutcome === 'breakdown' &&
      safeElapsed < Math.round(safeTarget * 0.92) &&
      candidateTurnCount < windDownTurns + 1
    ) {
      const recoveryFn = pickNextFunctionForLevel(safeFinishLevel, rated);
      return {
        phase: 'level_check',
        workingLevel: safeFinishLevel,
        probeLevel: safeFinishLevel === 1 ? 2 : 3,
        targetFunctionKey: recoveryFn,
        reason: `Stepping back to Level ${safeFinishLevel} so the candidate stabilizes before wind-down.`,
      };
    }

    const closingFn = pickNextFunctionForLevel(safeFinishLevel, rated);
    return {
      phase: 'wind_down',
      workingLevel: safeFinishLevel,
      probeLevel: safeFinishLevel === 1 ? 2 : 3,
      targetFunctionKey: closingFn,
      reason: `Wind-down at comfortable Level ${safeFinishLevel}: close naturally on a conversational success.`,
    };
  }

  // Targeted 3-minute single-function retry skips warm-up and drills targetFunctionKey directly.
  if (targetFunctionKey) {
    const fnLevel = getFunctionLevel(targetFunctionKey);
    const fnSpec = getFunctionSpec(targetFunctionKey);
    const targetWorking: OpiWorkingLevel = fnLevel === 3 ? 2 : fnLevel;
    const targetProbe: OpiProbeLevel = fnLevel === 1 ? 2 : (fnLevel as OpiProbeLevel);
    return {
      phase: 'probe',
      workingLevel: targetWorking,
      probeLevel: targetProbe,
      targetFunctionKey,
      reason: `Targeted 3-minute probe focusing on ${fnSpec?.label ?? targetFunctionKey}.`,
    };
  }

  // Warmup (~2 min or first < 2 candidate turns)
  const initialWorking: OpiWorkingLevel = focusLevel === 'adaptive' ? 2 : focusLevel;
  if (safeElapsed < 120 && candidateTurnCount < 2) {
    return {
      phase: 'warmup',
      workingLevel: initialWorking,
      probeLevel: initialWorking === 1 ? 2 : 3,
      targetFunctionKey: pickNextFunctionForLevel(initialWorking === 3 ? 2 : initialWorking, rated),
      reason: 'Unrated warm-up: relaxed greetings and simple personal questions.',
    };
  }

  // Fixed Focus mode (Practice mode: focusLevel 1 | 2 | 3)
  if (focusLevel !== 'adaptive') {
    const fixedWorking: OpiWorkingLevel = focusLevel;
    const fixedProbe: OpiProbeLevel = fixedWorking === 1 ? 2 : 3;

    if (
      includeRoleplay &&
      !roleplayDone &&
      rated.length >= 3 &&
      currentPhase !== 'roleplay' &&
      effectiveOutcome !== 'breakdown'
    ) {
      const rpKey: IlrFunctionKey =
        fixedWorking === 1
          ? 'l2_resolve_complication'
          : fixedProbe === 2
            ? 'l2_resolve_complication'
            : 'l3_support_opinions';
      return {
        phase: 'roleplay',
        workingLevel: fixedWorking,
        probeLevel: fixedProbe,
        targetFunctionKey: rpKey,
        reason: `Practice Focus Level ${focusLevel} role-play scenario at Level ${fixedProbe}.`,
      };
    }

    const shouldProbe = currentPhase === 'level_check' && effectiveOutcome !== 'breakdown';
    const nextPhase: OpiPhase = shouldProbe ? 'probe' : 'level_check';
    const fnLvl: IlrBaseLevel = nextPhase === 'probe' ? fixedProbe : fixedWorking;
    return {
      phase: nextPhase,
      workingLevel: fixedWorking,
      probeLevel: fixedProbe,
      targetFunctionKey: pickNextFunctionForLevel(fnLvl, rated, undefined, nextPhase === 'probe'),
      reason: `Focused Level ${focusLevel} ${nextPhase === 'probe' ? 'probe' : 'level check'}.`,
    };
  }

  // Adaptive Interview Flow
  const l2Items = rated.filter((a) => (a.targetLevel ?? getFunctionLevel(a.functionKey)) === 2);
  const l3Items = rated.filter((a) => (a.targetLevel ?? getFunctionLevel(a.functionKey)) === 3);
  const l2SustainedCount = l2Items.filter((a) => a.outcome === 'sustained').length;
  const l3SustainedCount = l3Items.filter((a) => a.outcome === 'sustained').length;
  const l3Breakdowns = l3Items.filter((a) => a.outcome === 'breakdown').length;

  let workingLevel: OpiWorkingLevel = prevWorking;

  // Level moves use RECENT Level 2 evidence (assessments are chronological), so one early breakdown
  // doesn't cap the rest of the interview (REVIEW H-6).
  const lastL2 = l2Items[l2Items.length - 1];
  const lastTwoL2Sustained = l2Items.length >= 2 && l2Items.slice(-2).every((a) => a.outcome === 'sustained');
  const l1SustainedSoFar = rated.filter(
    (a) => getFunctionLevel(a.functionKey) === 1 && a.outcome === 'sustained'
  ).length;

  // Drop to Level 1 if the latest Level 2 evidence broke down
  if (
    workingLevel === 2 &&
    (lastL2?.outcome === 'breakdown' || (currentPhase === 'level_check' && effectiveOutcome === 'breakdown'))
  ) {
    workingLevel = 1;
  } else if (
    // Recover to Level 2 once the Level 1 floor holds and the last two Level 2 probes were sustained
    workingLevel === 1 &&
    l1SustainedSoFar >= 2 &&
    lastTwoL2Sustained &&
    effectiveOutcome !== 'breakdown'
  ) {
    workingLevel = 2;
  } else if (workingLevel === 3 && (effectiveOutcome === 'breakdown' || l3Breakdowns > 0)) {
    workingLevel = 2;
  } else if (workingLevel === 2 && l3SustainedCount >= 4 && l3Breakdowns === 0 && l2SustainedCount >= 2) {
    workingLevel = 3;
  }

  const probeLevel: OpiProbeLevel = workingLevel === 1 ? 2 : 3;

  // Optional Role-play hook after initial baseline & probes
  if (
    includeRoleplay &&
    !roleplayDone &&
    rated.length >= 4 &&
    currentPhase !== 'roleplay' &&
    effectiveOutcome !== 'breakdown' &&
    (safeElapsed >= Math.round(safeTarget * 0.45) || candidateTurnCount >= 5)
  ) {
    const rpKey: IlrFunctionKey = probeLevel === 2 ? 'l2_resolve_complication' : 'l3_support_opinions';
    return {
      phase: 'roleplay',
      workingLevel,
      probeLevel,
      targetFunctionKey: rpKey,
      reason: `Role-play check at probe Level ${probeLevel}.`,
    };
  }

  // If the candidate just broke down -> step back to a comfortable check at workingLevel
  if (effectiveOutcome === 'breakdown') {
    return {
      phase: 'level_check',
      workingLevel,
      probeLevel,
      targetFunctionKey: pickNextFunctionForLevel(workingLevel, rated),
      reason: `Breakdown detected — returning to Level ${workingLevel} check to verify floor and rebuild comfort.`,
    };
  }

  // Confirm Level 2 floor over at least 2 turns before escalating to Level 3 probes
  if (workingLevel === 2 && l2SustainedCount < 2) {
    return {
      phase: 'level_check',
      workingLevel: 2,
      probeLevel: 3,
      targetFunctionKey: pickNextFunctionForLevel(2, rated),
      reason: 'Confirming Level 2 floor across topics and time frames before Level 3 probes.',
    };
  }

  // Confirm Level 1 floor over at least 2 turns before probing Level 2
  const l1SustainedCount = rated.filter(
    (a) => getFunctionLevel(a.functionKey) === 1 && a.outcome === 'sustained'
  ).length;
  if (workingLevel === 1 && l1SustainedCount < 2) {
    return {
      phase: 'level_check',
      workingLevel: 1,
      probeLevel: 2,
      targetFunctionKey: pickNextFunctionForLevel(1, rated),
      reason: 'Checking Level 1 elementary baseline after Level 2 breakdown.',
    };
  }

  // Alternate between floor level_check and ceiling probe (>= 2 probes per ceiling function)
  const nextPhase: OpiPhase = currentPhase === 'probe' ? 'level_check' : 'probe';
  const targetLvl: IlrBaseLevel = nextPhase === 'probe' ? probeLevel : workingLevel;
  const nextKey = pickNextFunctionForLevel(targetLvl, rated, undefined, nextPhase === 'probe');

  return {
    phase: nextPhase,
    workingLevel,
    probeLevel,
    targetFunctionKey: nextKey,
    reason:
      nextPhase === 'probe'
        ? `Probing Level ${probeLevel} function (${getFunctionSpec(nextKey)?.label ?? nextKey}).`
        : `Checking Level ${workingLevel} function (${getFunctionSpec(nextKey)?.label ?? nextKey}).`,
  };
}

/**
 * Safely splits a learner utterance around the problem span for UI highlighting without innerHTML.
 */
export function splitProblemSpan(
  utterance: string,
  problemSpan: string
): {before: string; match: string; after: string} {
  const cleanUtterance = String(utterance ?? '');
  const cleanSpan = String(problemSpan ?? '').trim();
  if (!cleanUtterance || !cleanSpan) {
    return {before: cleanUtterance, match: '', after: ''};
  }

  const exactIdx = cleanUtterance.indexOf(cleanSpan);
  if (exactIdx !== -1) {
    return {
      before: cleanUtterance.slice(0, exactIdx),
      match: cleanUtterance.slice(exactIdx, exactIdx + cleanSpan.length),
      after: cleanUtterance.slice(exactIdx + cleanSpan.length),
    };
  }

  const lowerIdx = cleanUtterance.toLowerCase().indexOf(cleanSpan.toLowerCase());
  if (lowerIdx !== -1) {
    return {
      before: cleanUtterance.slice(0, lowerIdx),
      match: cleanUtterance.slice(lowerIdx, lowerIdx + cleanSpan.length),
      after: cleanUtterance.slice(lowerIdx + cleanSpan.length),
    };
  }

  return {before: cleanUtterance, match: '', after: ''};
}

/**
 * Computes a safe playback clip window around the ceiling moment timestamp.
 */
export function extractClipWindow(
  timestampSeconds: number,
  totalDurationSeconds: number,
  leadInSeconds = 2,
  clipLengthSeconds = 18
): {startSec: number; endSec: number} {
  const safeTotal = Math.max(1, Number.isFinite(totalDurationSeconds) ? totalDurationSeconds : 1);
  const clampedTs = Math.max(0, Math.min(safeTotal, Number.isFinite(timestampSeconds) ? timestampSeconds : 0));
  const startSec = Math.max(0, Math.min(safeTotal - 1, clampedTs - leadInSeconds));
  const endSec = Math.min(safeTotal, Math.max(startSec + 1, startSec + clipLengthSeconds));
  return {startSec, endSec};
}

/**
 * Generates symmetric normalized heights (0.14..1.0) for the live orb waveform bars.
 */
export function buildWaveformBars(audioLevel: number, active: boolean, tick: number, barCount = 20): number[] {
  const count = Math.max(4, Math.min(48, Math.floor(barCount)));
  const clampedLevel = Math.max(0, Math.min(1, Number.isFinite(audioLevel) ? audioLevel : 0));
  const center = (count - 1) / 2;

  return Array.from({length: count}, (_, i) => {
    const distNorm = Math.abs(i - center) / Math.max(1, center);
    const envelope = 1 - distNorm * 0.65;
    if (!active) {
      return Number((0.14 + envelope * 0.08).toFixed(3));
    }
    const wave = 0.5 + 0.5 * Math.sin(tick * 0.45 + i * 0.72);
    const height = 0.16 + envelope * (0.18 + clampedLevel * 0.66 * (0.45 + 0.55 * wave));
    return Number(Math.max(0.14, Math.min(1, height)).toFixed(3));
  });
}

export function formatPhaseLabel(phase: OpiPhase): string {
  switch (phase) {
    case 'warmup':
      return 'Warm-up';
    case 'level_check':
      return 'Level check';
    case 'probe':
      return 'Probe';
    case 'roleplay':
      return 'Role-play';
    case 'wind_down':
      return 'Wind-down';
  }
}
