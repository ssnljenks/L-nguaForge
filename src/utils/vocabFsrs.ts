import {
  dateChrono,
  defineScheduler,
  Rating,
  schedulerDesiredRetentionMiddleware,
  schedulerLearningStepsMiddleware,
  schedulerMaximumIntervalMiddleware,
  schedulerMonotonicIntervalMiddleware,
  schedulerScheduledDaysMiddleware,
  schedulerStatsMiddleware,
  State,
} from 'ts-fsrs';
import {FSRS6_DEFAULT_WEIGHTS, FSRS6Model} from 'ts-fsrs/models/fsrs-6';
import type {TargetLanguage, VocabFsrsRating, VocabFsrsState, VocabItem} from '../types.ts';

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Synchronous FSRS-6 scheduler configured for vocabulary active recall.
 * Uses ts-fsrs v6 `defineScheduler` so it runs synchronously in React hooks,
 * localStorage sanitizers, and unit tests without top-level await.
 */
const vocabFsrsScheduler = defineScheduler({
  model: FSRS6Model,
  chrono: dateChrono,
})
  .use(schedulerDesiredRetentionMiddleware)
  .use(schedulerStatsMiddleware)
  .use(schedulerScheduledDaysMiddleware)
  .use(schedulerLearningStepsMiddleware)
  .use(schedulerMaximumIntervalMiddleware)
  .use(schedulerMonotonicIntervalMiddleware)
  .create({
    config: {
      weights: [...FSRS6_DEFAULT_WEIGHTS],
      enableShortTerm: true,
      numRelearningSteps: 1,
      desiredRetention: 0.9,
      learningSteps: ['1m', '10m'],
      relearningSteps: ['10m'],
      graduatingInterval: 1,
      maximumInterval: 365,
    },
  });

const RATING_MAP: Record<
  VocabFsrsRating,
  typeof Rating.Again | typeof Rating.Hard | typeof Rating.Good | typeof Rating.Easy
> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

function stateToString(state: State): VocabFsrsState['state'] {
  if (state === State.Learning) return 'learning';
  if (state === State.Review) return 'review';
  if (state === State.Relearning) return 'relearning';
  return 'new';
}

function stringToState(state: VocabFsrsState['state']): State {
  if (state === 'learning') return State.Learning;
  if (state === 'review') return State.Review;
  if (state === 'relearning') return State.Relearning;
  return State.New;
}

type SchedulerCard = ReturnType<typeof vocabFsrsScheduler.newCard>;

function serializeCard(card: SchedulerCard): VocabFsrsState {
  return {
    dueAt: card.dueAt.toISOString(),
    lastReviewAt: card.lastReviewAt ? card.lastReviewAt.toISOString() : null,
    stability: Number(card.stability.toFixed(4)),
    difficulty: Number(card.difficulty.toFixed(4)),
    scheduledDays: Number(card.scheduledDays.toFixed(4)),
    learningStep: Math.max(0, Math.round(card.learningStep)),
    reps: Math.max(0, Math.round(card.reps)),
    lapses: Math.max(0, Math.round(card.lapses)),
    state: stateToString(card.state),
  };
}

function deserializeCard(fsrsState: VocabFsrsState): SchedulerCard {
  const scheduleStatus: SchedulerCard['scheduleStatus'] =
    fsrsState.state === 'new' ? 'new' : fsrsState.state === 'review' ? 'review' : 'learning';
  return {
    dueAt: new Date(fsrsState.dueAt),
    lastReviewAt: fsrsState.lastReviewAt ? new Date(fsrsState.lastReviewAt) : null,
    stability: Math.max(0, fsrsState.stability),
    difficulty: Math.max(0, fsrsState.difficulty),
    scheduledDays: Math.max(0, fsrsState.scheduledDays),
    learningStep: Math.max(0, Math.round(fsrsState.learningStep)),
    reps: Math.max(0, Math.round(fsrsState.reps)),
    lapses: Math.max(0, Math.round(fsrsState.lapses)),
    state: stringToState(fsrsState.state),
    scheduleStatus,
  };
}

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
 * Creates a fresh FSRS card state for a newly saved vocabulary item (due immediately).
 */
export function createInitialVocabFsrs(nowMs = Date.now()): VocabFsrsState {
  const card = vocabFsrsScheduler.newCard({now: new Date(nowMs)});
  return serializeCard(card);
}

/**
 * Migrates a legacy VocabItem (mastery + reviewCount + createdAt) to an FSRS card state.
 * Preserves existing valid `item.fsrs` untouched.
 */
export function migrateVocabItemToFsrs(
  item: Pick<VocabItem, 'mastery' | 'reviewCount' | 'createdAt' | 'fsrs'>,
  nowMs = Date.now()
): VocabFsrsState {
  if (isValidVocabFsrsState(item.fsrs)) {
    return item.fsrs;
  }

  const createdMs = Date.parse(item.createdAt);
  const safeCreatedMs = Number.isFinite(createdMs) ? Math.min(createdMs, nowMs) : nowMs;
  const reviewCount = Math.max(0, Math.round(item.reviewCount || 0));

  // Unreviewed "new" card -> fresh FSRS card due right now
  if (item.mastery === 'new' && reviewCount === 0) {
    return createInitialVocabFsrs(nowMs);
  }

  if (item.mastery === 'mastered') {
    // Replay realistic Good/Easy reviews anchored in the past so stability & future due date reflect mastery
    const steps = Math.min(6, Math.max(3, reviewCount));
    const spanMs = Math.max(steps * 2 * MS_PER_DAY, nowMs - safeCreatedMs);
    let reviewTimeMs = nowMs - Math.min(spanMs, 21 * MS_PER_DAY);
    let card = vocabFsrsScheduler.newCard({now: new Date(reviewTimeMs)});

    for (let i = 0; i < steps; i += 1) {
      const grade = i === steps - 1 ? Rating.Easy : Rating.Good;
      const result = vocabFsrsScheduler.review({card, grade, now: new Date(reviewTimeMs)});
      card = result.card;
      const nextDueMs = card.dueAt.getTime();
      // Advance next simulated review toward `nowMs` without exceeding it
      reviewTimeMs = Math.min(nowMs - MS_PER_HOUR, Math.max(reviewTimeMs + MS_PER_DAY, nextDueMs));
    }

    return serializeCard({
      ...card,
      reps: Math.max(card.reps, reviewCount),
    });
  }

  // 'practicing' (or 'new' with reviewCount > 0): near-term review state so it enters active rotation soon
  const steps = Math.min(3, Math.max(1, reviewCount));
  let reviewTimeMs = nowMs - Math.max(MS_PER_DAY, steps * MS_PER_DAY);
  let card = vocabFsrsScheduler.newCard({now: new Date(reviewTimeMs)});
  for (let i = 0; i < steps; i += 1) {
    const grade = item.mastery === 'new' ? Rating.Hard : Rating.Good;
    const result = vocabFsrsScheduler.review({card, grade, now: new Date(reviewTimeMs)});
    card = result.card;
    reviewTimeMs = Math.min(nowMs - 2 * MS_PER_HOUR, reviewTimeMs + MS_PER_DAY);
  }

  return serializeCard({
    ...card,
    reps: Math.max(card.reps, reviewCount),
  });
}

export function ensureVocabFsrs(item: VocabItem, nowMs = Date.now()): VocabItem {
  if (isValidVocabFsrsState(item.fsrs)) return item;
  return {
    ...item,
    fsrs: migrateVocabItemToFsrs(item, nowMs),
  };
}

/** End of the current local calendar day (23:59:59.999) for "due today" checks. */
export function getEndOfTodayMs(nowMs = Date.now()): number {
  const d = new Date(nowMs);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function isVocabCardDueToday(item: VocabItem, nowMs = Date.now()): boolean {
  const fsrs = migrateVocabItemToFsrs(item, nowMs);
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
  const fsrs = migrateVocabItemToFsrs(item, nowMs);
  const dueMs = Date.parse(fsrs.dueAt);
  if (!Number.isFinite(dueMs) || dueMs <= getEndOfTodayMs(nowMs)) {
    return fsrs.state === 'new' ? 'New · due today' : 'Due today';
  }
  const daysAhead = Math.max(1, Math.round((dueMs - nowMs) / MS_PER_DAY));
  return daysAhead === 1 ? 'Due tomorrow' : `Due in ${daysAhead}d`;
}

export interface FsrsIntervalPreviews {
  again: string;
  hard: string;
  good: string;
  easy: string;
}

/**
 * Previews the next FSRS interval for each rating button on the current card.
 */
export function getFsrsIntervalPreviews(item: VocabItem, nowMs = Date.now()): FsrsIntervalPreviews {
  const card = deserializeCard(migrateVocabItemToFsrs(item, nowMs));
  const now = new Date(nowMs);
  const preview = vocabFsrsScheduler.preview({card, now});

  const out: FsrsIntervalPreviews = {
    again: '1m',
    hard: '6m',
    good: '10m',
    easy: '4d',
  };

  for (const entry of preview) {
    const label = formatFsrsInterval(entry.card.dueAt.getTime() - nowMs);
    if (entry.grade === Rating.Again) out.again = label;
    else if (entry.grade === Rating.Hard) out.hard = label;
    else if (entry.grade === Rating.Good) out.good = label;
    else if (entry.grade === Rating.Easy) out.easy = label;
  }

  return out;
}

/**
 * Applies an FSRS review grade to a VocabItem and returns the updated item
 * with recalculated FSRS card state, incremented reviewCount, and synced mastery label.
 */
export function reviewVocabCardWithFsrs(item: VocabItem, rating: VocabFsrsRating, nowMs = Date.now()): VocabItem {
  const card = deserializeCard(migrateVocabItemToFsrs(item, nowMs));
  const now = new Date(nowMs);
  const {card: nextCard} = vocabFsrsScheduler.review({
    card,
    grade: RATING_MAP[rating],
    now,
  });

  const nextFsrs = serializeCard(nextCard);

  let nextMastery: VocabItem['mastery'] = 'practicing';
  if (rating === 'again') {
    nextMastery = 'new';
  } else if (rating === 'easy' || (nextFsrs.state === 'review' && nextFsrs.stability >= 14)) {
    nextMastery = 'mastered';
  }

  return {
    ...item,
    mastery: nextMastery,
    reviewCount: (item.reviewCount ?? 0) + 1,
    fsrs: nextFsrs,
  };
}

export function legacyMasteryToFsrsRating(mastery: VocabItem['mastery']): VocabFsrsRating {
  if (mastery === 'new') return 'again';
  if (mastery === 'mastered') return 'easy';
  return 'good';
}
