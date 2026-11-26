import type {
  BriefIlrLevel,
  BriefItem,
  BriefMediaType,
  DlptDrillResult,
  DlptEstimatedIlr,
  DlptQuestionType,
  DlptRuleProfileId,
  DlptSkill,
  DlptTrapType,
  TargetLanguage,
} from '../types.ts';
import {isDlptTrapType} from './dlptTypes.ts';

export {DLPT_QUESTION_TYPES, DLPT_TRAP_TYPES, isDlptQuestionType, isDlptTrapType} from './dlptTypes.ts';

export const CHOICE_LETTERS = ['A', 'B', 'C', 'D'] as const;

export const QUESTION_TYPE_LABELS: Record<DlptQuestionType, string> = {
  main_idea: 'Main idea',
  detail: 'Detail',
  inference: 'Inference',
  vocabulary_in_context: 'Vocabulary in context',
  speaker_attitude: 'Speaker attitude',
};

export interface DlptTrapMeta {
  id: DlptTrapType;
  label: string;
  shortHint: string;
}

export const TRAP_TYPE_META: Record<DlptTrapType, DlptTrapMeta> = {
  mentioned_not_answer: {
    id: 'mentioned_not_answer',
    label: 'Mentioned, not the answer',
    shortHint: 'Repeats words from the passage, but answers a different question.',
  },
  not_in_passage: {
    id: 'not_in_passage',
    label: 'Not in passage',
    shortHint: 'Introduces information that never appears in the source.',
  },
  true_not_answer: {
    id: 'true_not_answer',
    label: 'True, but not the answer',
    shortHint: 'Factually accurate in the passage, yet does not address the question stem.',
  },
  wrong_detail: {
    id: 'wrong_detail',
    label: 'Wrong detail',
    shortHint: 'Distorts a number, actor, cause, or polarity stated in the source.',
  },
  over_inference: {
    id: 'over_inference',
    label: 'Over-inference',
    shortHint: 'Stretches beyond what the speaker or author actually supports.',
  },
};

export interface DlptRuleProfile {
  id: DlptRuleProfileId;
  language: TargetLanguage;
  pillLabel: string;
  title: string;
  summary: string;
  adaptive: boolean;
  allowSkip: boolean;
  allowBack: boolean;
  allowFlag: boolean;
  allowEndReview: boolean;
  hideNextUntilPageComplete: boolean;
  singleAudioPlay: boolean;
  allowAnswerWhileAudioPlays: boolean;
  audioReplaysOnReview: boolean;
  noGuessingPenalty: boolean;
  warnUnansweredBeforeSubmit: boolean;
  maxQuestions: Record<BriefMediaType, number>;
  rules: readonly {heading: string; detail: string}[];
}

export const DLPT_RULE_PROFILES: Record<TargetLanguage, DlptRuleProfile> = {
  es: {
    id: 'dlpt5_ca',
    language: 'es',
    pillLabel: 'ES · DLPT5-CA rules',
    title: 'Spanish · DLPT5-CA (Computer Adaptive)',
    summary:
      'Models the Computer Adaptive DLPT5 format used for Spanish: difficulty adapts passage by passage, and once you advance you cannot return.',
    adaptive: true,
    allowSkip: false,
    allowBack: false,
    allowFlag: false,
    allowEndReview: false,
    hideNextUntilPageComplete: true,
    singleAudioPlay: true,
    allowAnswerWhileAudioPlays: true,
    audioReplaysOnReview: false,
    noGuessingPenalty: true,
    warnUnansweredBeforeSubmit: false,
    maxQuestions: {
      audio: 3,
      text: 5,
    },
    rules: [
      {
        heading: 'Adaptive passage routing',
        detail:
          'Starts at a medium-difficulty passage and steps difficulty up or down after each page based on your accuracy.',
      },
      {
        heading: 'No skipping or going back',
        detail:
          'Every question on the current page must be answered before Next appears. There is no back navigation or end-of-test review.',
      },
      {
        heading: 'Single audio playback',
        detail:
          'Listening passages play once in test conditions. You may read questions and select answers while the audio is playing.',
      },
      {
        heading: 'Passage question caps',
        detail: 'Up to 3 questions per listening passage and up to 5 questions per Spanish reading passage.',
      },
    ],
  },
  pt: {
    id: 'dlpt5_lower_range',
    language: 'pt',
    pillLabel: 'PT · DLPT5 Lower-Range rules',
    title: 'Portuguese · DLPT5 Lower-Range (Fixed Form)',
    summary:
      'Models the fixed-order DLPT5 Lower-Range format used for Portuguese: flag pages to revisit and review before submitting, with no guessing penalty.',
    adaptive: false,
    allowSkip: true,
    allowBack: true,
    allowFlag: true,
    allowEndReview: true,
    hideNextUntilPageComplete: false,
    singleAudioPlay: true,
    allowAnswerWhileAudioPlays: true,
    audioReplaysOnReview: false,
    noGuessingPenalty: true,
    warnUnansweredBeforeSubmit: true,
    maxQuestions: {
      audio: 3,
      text: 4,
    },
    rules: [
      {
        heading: 'Fixed passage order',
        detail: 'Passages appear in a fixed sequence so you can pace yourself across the entire set.',
      },
      {
        heading: 'Flag to return & end review',
        detail:
          'Use "Flag to return" on any page and revisit pages from the end-of-session review screen to adjust answers before submitting.',
      },
      {
        heading: 'Audio plays once — never replays on review',
        detail:
          'Listening passages play once only, even if you jump back to a flagged page during review. You can mark answers while listening.',
      },
      {
        heading: 'No guessing penalty',
        detail:
          'Blank answers score zero, so you will be warned about any unanswered questions before final submission. Up to 3 questions for listening and 4 for Portuguese reading.',
      },
    ],
  },
};

export function getDlptProfileForLanguage(language: TargetLanguage): DlptRuleProfile {
  return DLPT_RULE_PROFILES[language];
}

export function getMaxQuestionsForPassage(language: TargetLanguage, mediaType: BriefMediaType): number {
  return DLPT_RULE_PROFILES[language].maxQuestions[mediaType];
}

export function mediaTypeToDlptSkill(mediaType: BriefMediaType): DlptSkill {
  return mediaType === 'audio' ? 'listening' : 'reading';
}

const ILR_RANK: Record<BriefIlrLevel, number> = {
  '2': 0,
  '2+': 1,
  '3': 2,
  '3+': 3,
};

const RANK_TO_ILR: readonly BriefIlrLevel[] = ['2', '2+', '3', '3+'];

export function ilrLevelToRank(level: BriefIlrLevel): number {
  return ILR_RANK[level];
}

/**
 * Computes the next target ILR level for DLPT5-CA adaptive routing.
 * Strong performance (>= 67% correct) steps up by 1 notch; weak performance (< 50%) steps down by 1 notch;
 * borderline performance (50%–66%) holds steady at the current level.
 */
export function computeNextAdaptiveLevel(
  currentLevel: BriefIlrLevel,
  pageCorrect: number,
  pageTotal: number
): BriefIlrLevel {
  if (pageTotal <= 0) return currentLevel;
  const ratio = pageCorrect / pageTotal;
  const currentRank = ILR_RANK[currentLevel];
  if (ratio >= 2 / 3) {
    return RANK_TO_ILR[Math.min(RANK_TO_ILR.length - 1, currentRank + 1)];
  }
  if (ratio < 0.5) {
    return RANK_TO_ILR[Math.max(0, currentRank - 1)];
  }
  return currentLevel;
}

/**
 * Selects the best next unseen passage for DLPT5-CA adaptive stepping.
 * Picks an unused passage matching the same language and mediaType whose ILR level
 * is closest to the target level (breaking ties in favor of the stepping direction).
 */
export function pickNextAdaptivePassage(params: {
  currentLevel: BriefIlrLevel;
  pageCorrect: number;
  pageTotal: number;
  candidates: readonly BriefItem[];
  usedIds: ReadonlySet<string>;
  language: TargetLanguage;
  mediaType: BriefMediaType;
}): BriefItem | null {
  const pool = params.candidates.filter(
    (item) => item.language === params.language && item.mediaType === params.mediaType && !params.usedIds.has(item.id)
  );
  if (pool.length === 0) return null;

  const targetLevel = computeNextAdaptiveLevel(params.currentLevel, params.pageCorrect, params.pageTotal);
  const targetRank = ILR_RANK[targetLevel];
  const currentRank = ILR_RANK[params.currentLevel];
  const preferHigher = targetRank >= currentRank;

  const sorted = [...pool].sort((a, b) => {
    const distA = Math.abs(ILR_RANK[a.ilrLevel] - targetRank);
    const distB = Math.abs(ILR_RANK[b.ilrLevel] - targetRank);
    if (distA !== distB) return distA - distB;
    return preferHigher ? ILR_RANK[b.ilrLevel] - ILR_RANK[a.ilrLevel] : ILR_RANK[a.ilrLevel] - ILR_RANK[b.ilrLevel];
  });

  return sorted[0] ?? null;
}

/**
 * Builds the fixed passage lineup for PT DLPT5 Lower-Range, starting with the launched item
 * followed by additional same-language, same-skill items sorted by ILR level ascending.
 */
export function buildFixedOrderPassages(
  initialItem: BriefItem,
  candidates: readonly BriefItem[],
  maxPassages = 3
): BriefItem[] {
  const extras = candidates
    .filter(
      (item) =>
        item.id !== initialItem.id && item.language === initialItem.language && item.mediaType === initialItem.mediaType
    )
    .sort((a, b) => ILR_RANK[a.ilrLevel] - ILR_RANK[b.ilrLevel]);

  return [initialItem, ...extras].slice(0, Math.max(1, maxPassages));
}

/**
 * Picks the starting passage for an adaptive session when launched from a specific Brief card.
 * Always honors the card the user clicked, and caps the session length to the available pool (up to maxPassages).
 */
export function getPlannedPassageCount(
  initialItem: BriefItem,
  candidates: readonly BriefItem[],
  maxPassages = 3
): number {
  const sameBucket = candidates.filter(
    (item) => item.language === initialItem.language && item.mediaType === initialItem.mediaType
  );
  const uniqueIds = new Set([initialItem.id, ...sameBucket.map((i) => i.id)]);
  return Math.min(maxPassages, uniqueIds.size);
}

/**
 * Returns whether the user may advance from the current passage page under the active rule profile.
 * Under ES DLPT5-CA, Next stays hidden until every question on the page is answered.
 * Under PT DLPT5 Lower-Range, skipping is permitted so the user can move on and return during review.
 */
export function canAdvancePage(
  profile: DlptRuleProfile,
  pageQuestionIds: readonly string[],
  selectedAnswers: Record<string, number>
): boolean {
  if (!profile.hideNextUntilPageComplete) return true;
  if (pageQuestionIds.length === 0) return false;
  return pageQuestionIds.every((id) => typeof selectedAnswers[id] === 'number');
}

export interface UnansweredSummary {
  totalUnanswered: number;
  byPassageIndex: Array<{passageIndex: number; unansweredCount: number; questionNumbers: number[]}>;
}

/**
 * Computes unanswered questions across all passages (used for PT Lower-Range no-guessing-penalty warning).
 */
export function getUnansweredSummary(
  pages: readonly {questionIds: readonly string[]}[],
  selectedAnswers: Record<string, number>
): UnansweredSummary {
  let totalUnanswered = 0;
  const byPassageIndex: UnansweredSummary['byPassageIndex'] = [];
  let runningQuestionNumber = 0;

  pages.forEach((page, passageIndex) => {
    const missingNumbers: number[] = [];
    for (const qId of page.questionIds) {
      runningQuestionNumber += 1;
      if (typeof selectedAnswers[qId] !== 'number') {
        totalUnanswered += 1;
        missingNumbers.push(runningQuestionNumber);
      }
    }
    if (missingNumbers.length > 0) {
      byPassageIndex.push({
        passageIndex,
        unansweredCount: missingNumbers.length,
        questionNumbers: missingNumbers,
      });
    }
  });

  return {totalUnanswered, byPassageIndex};
}

export interface DlptSkillEstimate {
  skill: DlptSkill;
  estimatedIlr: DlptEstimatedIlr | null;
  drillsCompleted: number;
  questionsAnswered: number;
  recentAccuracy: number | null;
  topTraps: Array<{trapType: DlptTrapType; count: number}>;
  disclaimer: string;
}

export interface DlptProfileEstimates {
  language: TargetLanguage;
  listening: DlptSkillEstimate;
  reading: DlptSkillEstimate;
}

const ESTIMATE_LEVEL_ORDER: readonly BriefIlrLevel[] = ['2', '2+', '3', '3+'];

function estimateSingleSkill(
  results: readonly DlptDrillResult[],
  language: TargetLanguage,
  skill: DlptSkill
): DlptSkillEstimate {
  // Sort newest first and inspect up to the 12 most recent drills for this language & skill
  const matching = results
    .filter((r) => r.language === language && r.skill === skill)
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
    .slice(0, 12);

  if (matching.length === 0) {
    return {
      skill,
      estimatedIlr: null,
      drillsCompleted: 0,
      questionsAnswered: 0,
      recentAccuracy: null,
      topTraps: [],
      disclaimer: 'Practice estimate, not an official rating.',
    };
  }

  // Weight newer drills slightly higher (exponential decay 0.88^idx)
  const levelStats: Record<BriefIlrLevel, {weightedCorrect: number; weightedTotal: number; rawTotal: number}> = {
    '2': {weightedCorrect: 0, weightedTotal: 0, rawTotal: 0},
    '2+': {weightedCorrect: 0, weightedTotal: 0, rawTotal: 0},
    '3': {weightedCorrect: 0, weightedTotal: 0, rawTotal: 0},
    '3+': {weightedCorrect: 0, weightedTotal: 0, rawTotal: 0},
  };

  let rawAnswered = 0;
  let rawCorrect = 0;
  const trapCounts: Partial<Record<DlptTrapType, number>> = {};

  matching.forEach((drill, drillIdx) => {
    const weight = Math.pow(0.88, drillIdx);
    for (const outcome of drill.outcomes) {
      rawAnswered += 1;
      if (outcome.correct) rawCorrect += 1;
      const bucket = levelStats[outcome.ilrLevel];
      if (bucket) {
        bucket.rawTotal += 1;
        bucket.weightedTotal += weight;
        if (outcome.correct) bucket.weightedCorrect += weight;
      }
      if (!outcome.correct && outcome.trapType && isDlptTrapType(outcome.trapType)) {
        trapCounts[outcome.trapType] = (trapCounts[outcome.trapType] ?? 0) + 1;
      }
    }
    // Also merge any aggregate trapsMissed if outcomes lacked per-item trap tags
    if (drill.outcomes.length === 0 && drill.trapsMissed) {
      for (const [k, v] of Object.entries(drill.trapsMissed)) {
        if (isDlptTrapType(k) && typeof v === 'number' && v > 0) {
          trapCounts[k] = (trapCounts[k] ?? 0) + v;
        }
      }
    }
  });

  const topTraps = Object.entries(trapCounts)
    .filter(
      (entry): entry is [DlptTrapType, number] =>
        isDlptTrapType(entry[0]) && typeof entry[1] === 'number' && entry[1] > 0
    )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([trapType, count]) => ({trapType, count}));

  const recentAccuracy = rawAnswered > 0 ? Math.round((rawCorrect / rawAnswered) * 100) : null;

  // Require at least 3 answered questions to issue a practice ILR estimate
  if (rawAnswered < 3) {
    return {
      skill,
      estimatedIlr: null,
      drillsCompleted: matching.length,
      questionsAnswered: rawAnswered,
      recentAccuracy,
      topTraps,
      disclaimer: 'Practice estimate, not an official rating.',
    };
  }

  // Determine highest level with sustained accuracy (>= 70%), allowing a single step up
  // if the learner demonstrates solid performance (>= 70%) on a higher level tested directly.
  let highestSustained: BriefIlrLevel | null = null;
  let highestPartial: BriefIlrLevel | null = null;

  for (const lvl of ESTIMATE_LEVEL_ORDER) {
    const stat = levelStats[lvl];
    if (stat.rawTotal === 0 || stat.weightedTotal <= 0) continue;
    const acc = stat.weightedCorrect / stat.weightedTotal;
    if (acc >= 0.7) {
      highestSustained = lvl;
    } else if (acc >= 0.5) {
      highestPartial = lvl;
    }
  }

  let estimatedIlr: DlptEstimatedIlr;
  if (highestSustained) {
    estimatedIlr = highestSustained;
  } else if (highestPartial) {
    // One notch below partial higher level, floored at '1+'
    const partialRank = ILR_RANK[highestPartial];
    estimatedIlr = partialRank === 0 ? '1+' : RANK_TO_ILR[partialRank - 1];
  } else {
    estimatedIlr = '1+';
  }

  return {
    skill,
    estimatedIlr,
    drillsCompleted: matching.length,
    questionsAnswered: rawAnswered,
    recentAccuracy,
    topTraps,
    disclaimer: 'Practice estimate, not an official rating.',
  };
}

/**
 * Computes Listening and Reading ILR practice estimates from recent stored DLPT drill results
 * for the Today profile.
 */
export function computeDlptSkillEstimates(
  results: readonly DlptDrillResult[],
  language: TargetLanguage
): DlptProfileEstimates {
  return {
    language,
    listening: estimateSingleSkill(results, language, 'listening'),
    reading: estimateSingleSkill(results, language, 'reading'),
  };
}
