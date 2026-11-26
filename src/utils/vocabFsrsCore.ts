import type {TargetLanguage, VocabFsrsRating, VocabFsrsState, VocabItem} from '../types.ts';

/**
 * FSRS helpers that don't need the ts-fsrs scheduler: validation, new cards, due dates, deck order
 * and labels. Kept separate so the startup bundle doesn't carry ts-fsrs (REVIEW M-7); reviews,
 * interval previews and legacy migration live in `vocabFsrs.ts`, which is loaded on demand.
 */

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export function isValidVocabFsrsState(value: unknown): value is VocabFsrsState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const validState = v.state === 'new' || v.state === 'learning' || v.state === 'review' || v.state === 'relearning';
  const validDue = typeof v.dueAt === 'string' && !Number.isNaN(Date.parse(v.dueAt));
  const validLast =
    v.lastReviewAt === null ||
    v.lastReviewAt === undefined ||
    (typeof v.lastReviewAt === 'string' && !Number.isNaN(Date.parse(v.lastReviewAt)));
  return (
    validState &&
    validDue &&
    validLast &&
    typeof v.stability === 'number' &&
    Number.isFinite(v.stability) &&
    v.stability >= 0 &&
    typeof v.difficulty === 'number' &&
    Number.isFinite(v.difficulty) &&
    v.difficulty >= 0 &&
    typeof v.scheduledDays === 'number' &&
    Number.isFinite(v.scheduledDays) &&
    v.scheduledDays >= 0 &&
    typeof v.learningStep === 'number' &&
    Number.isFinite(v.learningStep) &&
    typeof v.reps === 'number' &&
    Number.isFinite(v.reps) &&
    typeof v.lapses === 'number' &&
    Number.isFinite(v.lapses)
  );
}

/**
 * Creates a fresh FSRS card state for a newly saved vocabulary item (due immediately). Same
 * values as the ts-fsrs scheduler's `newCard`, without loading the scheduler (REVIEW M-7).
 */
export function createInitialVocabFsrs(nowMs = Date.now()): VocabFsrsState {
  return {
    dueAt: new Date(nowMs).toISOString(),
    lastReviewAt: null,
    stability: 0,
    difficulty: 0,
    scheduledDays: 0,
    learningStep: 0,
    reps: 0,
    lapses: 0,
    state: 'new',
  };
}

/** The item's stored FSRS state; items without one (never the case after load) count as new cards. */
function fsrsOrNew(item: VocabItem, nowMs: number): VocabFsrsState {
  return isValidVocabFsrsState(item.fsrs) ? item.fsrs : createInitialVocabFsrs(nowMs);
}

export function ensureVocabFsrs(item: VocabItem, nowMs = Date.now()): VocabItem {
  if (isValidVocabFsrsState(item.fsrs)) return item;
  return {...item, fsrs: createInitialVocabFsrs(nowMs)};
}

/** End of the current local calendar day (23:59:59.999) for "due today" checks. */
export function getEndOfTodayMs(nowMs = Date.now()): number {
  const d = new Date(nowMs);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function isVocabCardDueToday(item: VocabItem, nowMs = Date.now()): boolean {
  const fsrs = fsrsOrNew(item, nowMs);
  const dueMs = Date.parse(fsrs.dueAt);
  if (!Number.isFinite(dueMs)) return true;
  return dueMs <= getEndOfTodayMs(nowMs);
}

/**
 * Returns cards in the target language due on or before the end of today,
 * ordered most overdue / earliest due first.
 */
export function getDueVocabCards(
  items: readonly VocabItem[],
  language: TargetLanguage,
  nowMs = Date.now()
): VocabItem[] {
  return items
    .filter((item) => item.language === language && isVocabCardDueToday(item, nowMs))
    .map((item) => ensureVocabFsrs(item, nowMs))
    .sort((a, b) => Date.parse(a.fsrs!.dueAt) - Date.parse(b.fsrs!.dueAt));
}

/**
 * Sorts a vocab deck for Active Recall: due-today cards first (earliest due first),
 * followed by upcoming cards ordered by soonest next review.
 */
export function sortVocabDeckByFsrs(items: readonly VocabItem[], nowMs = Date.now()): VocabItem[] {
  const endOfToday = getEndOfTodayMs(nowMs);
  return items
    .map((item) => ensureVocabFsrs(item, nowMs))
    .sort((a, b) => {
      const dueA = Date.parse(a.fsrs!.dueAt);
      const dueB = Date.parse(b.fsrs!.dueAt);
      const isDueA = dueA <= endOfToday ? 0 : 1;
      const isDueB = dueB <= endOfToday ? 0 : 1;
      if (isDueA !== isDueB) return isDueA - isDueB;
      return dueA - dueB;
    });
}

export function formatFsrsInterval(deltaMs: number): string {
  const safeMs = Math.max(MS_PER_MINUTE, deltaMs);
  const minutes = Math.round(safeMs / MS_PER_MINUTE);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(safeMs / MS_PER_HOUR);
  if (hours < 24) return `${hours}h`;
  const days = Math.max(1, Math.round(safeMs / MS_PER_DAY));
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  const years = (days / 365).toFixed(1).replace(/\.0$/, '');
  return `${years}y`;
}

export function formatDueSummary(item: VocabItem, nowMs = Date.now()): string {
  const fsrs = fsrsOrNew(item, nowMs);
  const dueMs = Date.parse(fsrs.dueAt);
  if (!Number.isFinite(dueMs) || dueMs <= getEndOfTodayMs(nowMs)) {
    return fsrs.state === 'new' ? 'New · due today' : 'Due today';
  }
  const daysAhead = Math.max(1, Math.round((dueMs - nowMs) / MS_PER_DAY));
  return daysAhead === 1 ? 'Due tomorrow' : `Due in ${daysAhead}d`;
}

export function legacyMasteryToFsrsRating(mastery: VocabItem['mastery']): VocabFsrsRating {
  if (mastery === 'new') return 'again';
  if (mastery === 'mastered') return 'easy';
  return 'good';
}
