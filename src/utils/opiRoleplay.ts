import type {IlrBaseLevel, IlrFunctionKey} from '../data/ilrSpeakingLevels.ts';
import type {RoleplayChecklistItem, RoleplayRegister, TargetLanguage, TurnAssessment} from '../types.ts';
import {normalizeIlrFunctionRating} from './opiLogic.ts';

export const ROLEPLAY_DURATION_SECONDS = 4 * 60;
export const ROLEPLAY_TWIST_HINT = 'The other person has a reason of their own. Expect a complication.';

export interface RoleplayChecklistSpec {
  itemKey: string;
  label: string;
  functionKey: IlrFunctionKey;
}

const CHECKLIST_BY_LEVEL: Record<IlrBaseLevel, readonly RoleplayChecklistSpec[]> = {
  1: [
    {
      itemKey: 'rp_l1_request',
      label: 'Made the request',
      functionKey: 'l1_creating_language',
    },
    {
      itemKey: 'rp_l1_courtesy',
      label: 'Handled courtesy',
      functionKey: 'l1_courtesy',
    },
    {
      itemKey: 'rp_l1_basic_qa',
      label: 'Asked and answered basic questions',
      functionKey: 'l1_simple_qa',
    },
  ],
  2: [
    {
      itemKey: 'rp_l2_explain',
      label: 'Explained the situation',
      functionKey: 'l2_concrete_descriptions',
    },
    {
      itemKey: 'rp_l2_resolve',
      label: 'Resolved the complication',
      functionKey: 'l2_resolve_complication',
    },
    {
      itemKey: 'rp_l2_narrate',
      label: 'Narrated what happened',
      functionKey: 'l2_narration_timeframes',
    },
  ],
  3: [
    {
      itemKey: 'rp_l3_support',
      label: 'Supported a position',
      functionKey: 'l3_support_opinions',
    },
    {
      itemKey: 'rp_l3_adapt',
      label: "Adapted to the other side's concern",
      functionKey: 'l3_hypothesize',
    },
    {
      itemKey: 'rp_l3_tone_register',
      label: 'Handled tone and register',
      functionKey: 'l3_detect_overtones',
    },
  ],
};

export function getRoleplayChecklistSpecs(level: IlrBaseLevel): readonly RoleplayChecklistSpec[] {
  return CHECKLIST_BY_LEVEL[level] ?? CHECKLIST_BY_LEVEL[2];
}

export function isTwistHintVisible(level: IlrBaseLevel): boolean {
  return level >= 2;
}

export function normalizeRoleplayRegister(raw: unknown, language: TargetLanguage, dialect: string): RoleplayRegister {
  const cleaned = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (language === 'es') {
    if (cleaned === 'usted' || cleaned === 'tú' || cleaned === 'tu') {
      return cleaned === 'tu' ? 'tú' : cleaned;
    }
    if (cleaned === 'vos') return 'vos';
    if (dialect === 'rioplatense' && cleaned.includes('vos')) return 'vos';
    return 'usted';
  }
  if (cleaned === 'tu') return 'tu';
  if (cleaned === 'você' || cleaned === 'voce') return 'você';
  return 'você';
}

export function normalizeRoleplayChecklist(raw: unknown, level: IlrBaseLevel): RoleplayChecklistItem[] {
  const specs = getRoleplayChecklistSpecs(level);
  const items = Array.isArray(raw) ? raw : [];

  return specs.map((spec, idx) => {
    const matched =
      items.find(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          ((entry as Record<string, unknown>).itemKey === spec.itemKey ||
            String((entry as Record<string, unknown>).label ?? '')
              .trim()
              .toLowerCase() === spec.label.toLowerCase())
      ) ?? items[idx];

    const rec = matched && typeof matched === 'object' ? (matched as Record<string, unknown>) : {};
    const status = normalizeIlrFunctionRating(rec.status);
    const evidence =
      typeof rec.evidence === 'string' && rec.evidence.trim()
        ? rec.evidence.trim().slice(0, 280)
        : status === 'met'
          ? `Demonstrated "${spec.label.toLowerCase()}" cleanly.`
          : status === 'partly'
            ? `Partially addressed "${spec.label.toLowerCase()}".`
            : `Did not yet complete "${spec.label.toLowerCase()}" in transcript.`;

    return {
      itemKey: spec.itemKey,
      label: spec.label,
      functionKey: spec.functionKey,
      status,
      evidence,
    };
  });
}

/**
 * Feeds role-play checklist outcomes back into `opiRating` (`calculateOpiRating`) as rated
 * `TurnAssessment` entries targeting `level`.
 */
export function roleplayChecklistToAssessments(
  level: IlrBaseLevel,
  checklist: readonly RoleplayChecklistItem[]
): TurnAssessment[] {
  return checklist.map((item) => ({
    functionKey: item.functionKey,
    outcome: item.status === 'met' ? 'sustained' : item.status === 'partly' ? 'partial' : 'breakdown',
    evidence: `${item.label}: ${item.evidence}`,
    phase: 'roleplay',
    targetLevel: level,
  }));
}

export interface RoleplayPacingDecision {
  stage: 'opening' | 'complication' | 'negotiation' | 'closing';
  shouldIntroduceComplication: boolean;
  shouldWrapUp: boolean;
}

/**
 * Controls twist timing and wrap-up in role-play calls:
 * - Level 1: survival transaction with no real complication; wraps cleanly around >= 4 candidate turns or >= 210s.
 * - Levels 2–3: introduces the complication roughly a third of the way in (candidate turn >= 1 once elapsed >= 65s,
 *   or candidate turn >= 2), then negotiates until the hidden goal / compromise is met or wraps around >= 6 turns / >= 210s.
 */
export function determineRoleplayPacing(input: {
  level: IlrBaseLevel;
  candidateTurnCount: number;
  elapsedSeconds: number;
  complicationIntroduced?: boolean;
  durationTargetSeconds?: number;
}): RoleplayPacingDecision {
  const {
    level,
    candidateTurnCount,
    elapsedSeconds,
    complicationIntroduced = false,
    durationTargetSeconds = ROLEPLAY_DURATION_SECONDS,
  } = input;

  const safeTurns = Math.max(0, Math.floor(candidateTurnCount));
  const safeElapsed = Math.max(0, Math.floor(elapsedSeconds));
  const closingThresholdSec = Math.round(durationTargetSeconds * 0.85);
  const maxTurns = level === 1 ? 4 : 6;

  if (safeTurns >= maxTurns || (safeTurns >= 2 && safeElapsed >= closingThresholdSec)) {
    return {
      stage: 'closing',
      shouldIntroduceComplication: false,
      shouldWrapUp: true,
    };
  }

  if (
    level >= 2 &&
    !complicationIntroduced &&
    (safeTurns >= 2 || (safeTurns >= 1 && safeElapsed >= Math.round(durationTargetSeconds / 3)))
  ) {
    return {
      stage: 'complication',
      shouldIntroduceComplication: true,
      shouldWrapUp: false,
    };
  }

  return {
    stage: safeTurns === 0 ? 'opening' : 'negotiation',
    shouldIntroduceComplication: false,
    shouldWrapUp: false,
  };
}
