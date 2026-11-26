import {
  getAccuracyDescriptors,
  getFunctionLevel,
  getFunctionsForLevel,
  getFunctionSpec,
  getIlrLevelDescriptor,
  type IlrBaseLevel,
  type IlrFunctionKey,
} from '../data/ilrSpeakingLevels.ts';
import type {IlrDisplayRating, IlrFunctionCheck, IlrFunctionRating, OpiAccuracyNote, TurnAssessment} from '../types.ts';

export const PRACTICE_RATING_DISCLAIMER = 'Practice estimate, not an official rating';
export const HIGHER_LEVELS_NOT_RATED_NOTE = 'Higher levels not rated in practice';

export interface OpiRatingResult {
  floor: 0 | 1 | 2 | 3;
  ceiling: 1 | 2 | 3 | null;
  displayRating: IlrDisplayRating;
  isPlus: boolean;
  disclaimer: string;
  ratingNote?: string;
  rationale: string;
  gridLevel: IlrBaseLevel;
  accuracyLevel: IlrBaseLevel;
  functionChecks: IlrFunctionCheck[];
  accuracyNotes: OpiAccuracyNote[];
  hasEnoughEvidence: boolean;
}

function resolveAssessmentLevel(a: TurnAssessment): IlrBaseLevel {
  return a.targetLevel ?? getFunctionLevel(a.functionKey);
}

/**
 * Computes Floor, Ceiling, Plus (+), display rating (0+ to 3), next-level function grid,
 * and level-mapped accuracy notes from non-warmup TurnAssessment entries.
 */
export function calculateOpiRating(assessments: readonly TurnAssessment[]): OpiRatingResult {
  const rated = assessments.filter((a) => a.phase !== 'warmup');
  const hasEnoughEvidence = rated.length > 0;

  const byLevel = new Map<IlrBaseLevel, TurnAssessment[]>([
    [1, []],
    [2, []],
    [3, []],
  ]);

  for (const item of rated) {
    const lvl = resolveAssessmentLevel(item);
    byLevel.get(lvl)?.push(item);
  }

  const isLevelSustained = (lvl: IlrBaseLevel): boolean => {
    const items = byLevel.get(lvl) ?? [];
    if (items.length === 0) return false;
    return items.every((i) => i.outcome === 'sustained');
  };

  const hasLevelBreakdownsOrPartials = (lvl: IlrBaseLevel): boolean => {
    const items = byLevel.get(lvl) ?? [];
    return items.some((i) => i.outcome === 'breakdown' || i.outcome === 'partial');
  };

  const l3Sustained = isLevelSustained(3);
  const l2Sustained = isLevelSustained(2);
  const l1Assessments = byLevel.get(1) ?? [];
  const l1Failed = hasLevelBreakdownsOrPartials(1);

  let floor: 0 | 1 | 2 | 3;
  if (l3Sustained && !hasLevelBreakdownsOrPartials(2) && !l1Failed) {
    floor = 3;
  } else if (l2Sustained && !l1Failed) {
    floor = 2;
  } else if (l1Assessments.length > 0) {
    floor = isLevelSustained(1) ? 1 : 0;
  } else if (!hasEnoughEvidence) {
    floor = 1;
  } else {
    // Only Level 2/3 were tested and Level 2 broke down before explicit L1 checks completed.
    floor = 1;
  }

  let displayRating: IlrDisplayRating;
  let ceiling: 1 | 2 | 3 | null;
  let isPlus = false;
  let ratingNote: string | undefined;

  if (floor === 3) {
    displayRating = '3';
    ceiling = null;
    ratingNote = HIGHER_LEVELS_NOT_RATED_NOTE;
  } else if (floor === 0) {
    displayRating = '0+';
    ceiling = 1;
    isPlus = true;
  } else {
    const nextLevel = (floor + 1) as 2 | 3;
    ceiling = nextLevel;
    const nextItems = byLevel.get(nextLevel) ?? [];
    const positiveCount = nextItems.filter((i) => i.outcome === 'sustained' || i.outcome === 'partial').length;
    const qualifiesForPlus = nextItems.length > 0 && positiveCount / nextItems.length >= 0.5;
    isPlus = qualifiesForPlus;
    if (floor === 1) {
      displayRating = qualifiesForPlus ? '1+' : '1';
    } else {
      displayRating = qualifiesForPlus ? '2+' : '2';
    }
  }

  const gridLevel: IlrBaseLevel = floor >= 3 ? 3 : ((floor + 1) as IlrBaseLevel);
  const accuracyLevel: IlrBaseLevel = floor === 0 ? 1 : gridLevel;

  const functionChecks = buildLevelFunctionChecks(gridLevel, rated);
  const accuracyNotes = buildAccuracyNotes(accuracyLevel, rated, floor);
  const rationale = buildRatingRationale(floor, ceiling, isPlus, functionChecks, hasEnoughEvidence);

  return {
    floor,
    ceiling,
    displayRating,
    isPlus,
    disclaimer: PRACTICE_RATING_DISCLAIMER,
    ratingNote,
    rationale,
    gridLevel,
    accuracyLevel,
    functionChecks,
    accuracyNotes,
    hasEnoughEvidence,
  };
}

function toFunctionStatus(items: readonly TurnAssessment[]): IlrFunctionRating {
  if (items.length === 0) return 'partly';
  if (items.every((i) => i.outcome === 'sustained')) return 'met';
  if (items.every((i) => i.outcome === 'breakdown')) return 'not_met';
  const latest = items[items.length - 1];
  if (latest.outcome === 'breakdown') return 'not_met';
  return 'partly';
}

export function buildLevelFunctionChecks(
  level: IlrBaseLevel,
  assessments: readonly TurnAssessment[],
  existing?: readonly IlrFunctionCheck[]
): IlrFunctionCheck[] {
  const specs = getFunctionsForLevel(level);
  const existingByKey = new Map<IlrFunctionKey, IlrFunctionCheck>();
  for (const item of existing ?? []) {
    existingByKey.set(item.functionKey, item);
  }

  const grouped = new Map<IlrFunctionKey, TurnAssessment[]>();
  for (const a of assessments) {
    if (a.phase === 'warmup') continue;
    const arr = grouped.get(a.functionKey) ?? [];
    arr.push(a);
    grouped.set(a.functionKey, arr);
  }

  return specs.map((spec) => {
    const turns = grouped.get(spec.functionKey) ?? [];
    const prev = existingByKey.get(spec.functionKey);
    const evidence = turns.map((t) => t.evidence).filter(Boolean);
    const mergedEvidence = evidence.length > 0 ? evidence : prev?.evidence;

    if (turns.length > 0) {
      const status = toFunctionStatus(turns);
      const note =
        turns[turns.length - 1].evidence ||
        prev?.note ||
        (status === 'met'
          ? `Sustained ${spec.label.toLowerCase()} across turns.`
          : status === 'not_met'
            ? `Broke down on ${spec.label.toLowerCase()}.`
            : `Mixed control on ${spec.label.toLowerCase()}.`);
      return {
        functionKey: spec.functionKey,
        label: spec.label,
        status,
        note,
        ...(mergedEvidence?.length ? {evidence: mergedEvidence} : {}),
      };
    }

    if (prev) {
      return {
        ...prev,
        label: spec.label,
      };
    }

    return {
      functionKey: spec.functionKey,
      label: spec.label,
      status: 'partly',
      note: 'Limited probe evidence captured in this call.',
    };
  });
}

export function buildAccuracyNotes(
  level: IlrBaseLevel,
  assessments: readonly TurnAssessment[],
  floor: 0 | 1 | 2 | 3
): OpiAccuracyNote[] {
  const descriptors = getAccuracyDescriptors(level);
  const levelItems = assessments.filter((a) => a.phase !== 'warmup' && resolveAssessmentLevel(a) === level);
  const breakdowns = levelItems.filter((a) => a.outcome === 'breakdown').length;
  const partials = levelItems.filter((a) => a.outcome === 'partial').length;

  return descriptors.map((descriptor, idx) => {
    if (floor === 3) {
      return {
        descriptor,
        observation: `Sustained Level 3 control aligns with "${descriptor}".`,
        status: 'strength' as const,
      };
    }
    if (level === 1 && floor === 0) {
      return {
        descriptor,
        observation:
          idx === 0 ? 'Repetition and slower pacing helped stabilize basic answers.' : `Emerging area: ${descriptor}.`,
        status: breakdowns > 0 ? ('gap' as const) : ('watch' as const),
      };
    }
    if (level === 2) {
      if (descriptor.includes('NOT used to')) {
        return {
          descriptor,
          observation:
            breakdowns > 0
              ? 'Natives not used to learners would likely ask you to repeat or clarify during complications.'
              : 'Generally understandable to natives not used to learners on familiar everyday topics.',
          status: breakdowns > 0 ? 'gap' : 'watch',
        };
      }
      return {
        descriptor,
        observation:
          breakdowns > 0
            ? `Observed friction on Level 2 tasks (${descriptor}).`
            : `Developing stability (${descriptor}).`,
        status: breakdowns > 0 ? 'watch' : 'strength',
      };
    }
    // level === 3 (with floor === 2 or 2+)
    if (breakdowns > 0) {
      return {
        descriptor,
        observation:
          idx === 0
            ? 'Needed occasional rewording or stepped back to simpler Level 2 structures when probed.'
            : `Ceiling indicator at Level 3: ${descriptor} not yet consistently sustained.`,
        status: 'gap' as const,
      };
    }
    if (partials > 0) {
      return {
        descriptor,
        observation: `Emerging toward Level 3 (${descriptor}), though not consistently automated.`,
        status: 'watch' as const,
      };
    }
    return {
      descriptor,
      observation: `Target Level 3 benchmark: ${descriptor}.`,
      status: 'watch' as const,
    };
  });
}

function buildRatingRationale(
  floor: 0 | 1 | 2 | 3,
  ceiling: 1 | 2 | 3 | null,
  isPlus: boolean,
  functionChecks: readonly IlrFunctionCheck[],
  hasEnoughEvidence: boolean
): string {
  if (!hasEnoughEvidence) {
    return 'Short call with insufficient rated turns; default baseline displayed.';
  }
  if (floor === 3) {
    return 'Sustained Level 3 functions across abstract, opinion, and hypothetical probes.';
  }
  const failed =
    functionChecks.find((f) => f.status === 'not_met') ?? functionChecks.find((f) => f.status === 'partly');
  const failedName = failed ? failed.label.toLowerCase() : 'complex probes';
  if (floor === 0) {
    return `Elementary survival speech broke down on ${failedName} at Level 1.`;
  }
  const floorLabel = getIlrLevelDescriptor(floor).level;
  if (isPlus) {
    return `Sustained Level ${floorLabel} and handled many Level ${ceiling} tasks, while ${failedName} broke down at Level ${ceiling}.`;
  }
  return `Sustained Level ${floorLabel}; ${failedName} broke down at Level ${ceiling}.`;
}

export function formatFunctionListForPrompt(level: IlrBaseLevel): string {
  return getFunctionsForLevel(level)
    .map((f) => `- ${f.functionKey}: ${f.label} (${f.description})`)
    .join('\n');
}

export function resolvePrimaryRetryFunction(
  functionChecks: readonly IlrFunctionCheck[],
  ceilingMomentFunction?: IlrFunctionKey
): {functionKey: IlrFunctionKey; label: string} {
  if (ceilingMomentFunction) {
    const spec = getFunctionSpec(ceilingMomentFunction);
    if (spec) return {functionKey: spec.functionKey, label: spec.label};
  }
  const notMet = functionChecks.find((f) => f.status === 'not_met');
  if (notMet) return {functionKey: notMet.functionKey, label: notMet.label};
  const partly = functionChecks.find((f) => f.status === 'partly');
  if (partly) return {functionKey: partly.functionKey, label: partly.label};
  const first = functionChecks[0];
  return first
    ? {functionKey: first.functionKey, label: first.label}
    : {functionKey: 'l3_hypothesize', label: 'Hypothesize'};
}
