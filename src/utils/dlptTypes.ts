import type {DlptQuestionType, DlptTrapType} from '../types.ts';

/** DLPT enum lists and guards, light enough for the startup storage sanitizers (REVIEW M-7). */
export const DLPT_QUESTION_TYPES: readonly DlptQuestionType[] = [
  'main_idea',
  'detail',
  'inference',
  'vocabulary_in_context',
  'speaker_attitude',
];

export const DLPT_TRAP_TYPES: readonly DlptTrapType[] = [
  'mentioned_not_answer',
  'not_in_passage',
  'true_not_answer',
  'wrong_detail',
  'over_inference',
];

export function isDlptQuestionType(val: unknown): val is DlptQuestionType {
  return typeof val === 'string' && (DLPT_QUESTION_TYPES as readonly string[]).includes(val);
}

export function isDlptTrapType(val: unknown): val is DlptTrapType {
  return typeof val === 'string' && (DLPT_TRAP_TYPES as readonly string[]).includes(val);
}
