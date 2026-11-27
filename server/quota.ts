import {UserFacingError} from './errors.ts';

/**
 * Daily protection for the Gemini API key's quota, on top of the per-minute IP limiter in security.ts.
 * Counters are per process and reset at 00:00 UTC; with Cloud Run max-instances=1 that is the whole service.
 */

export const GEMINI_DAILY_CAP_MESSAGE =
  'The daily limit for AI requests during testing has been reached. It resets at 00:00 UTC. Saved Vocab and offline drills still work.';

export interface DailyBudget {
  /** Throws a 429 UserFacingError when today's cap is spent. Does not count. */
  assertAvailable(): void;
  /** Counts one upstream attempt (retries count too: they spend real quota). */
  record(): void;
  used(): number;
  cap(): number;
  /** 0 disables the cap. */
  configure(cap: number): void;
}

function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function createDailyBudget(initialCap = 0, now: () => number = Date.now): DailyBudget {
  let cap = initialCap;
  let day = utcDay(now());
  let count = 0;
  const roll = () => {
    const today = utcDay(now());
    if (today !== day) {
      day = today;
      count = 0;
    }
  };
  return {
    assertAvailable() {
      roll();
      if (cap > 0 && count >= cap) throw new UserFacingError(429, GEMINI_DAILY_CAP_MESSAGE);
    },
    record() {
      roll();
      count += 1;
    },
    used() {
      roll();
      return count;
    },
    cap: () => cap,
    configure(next) {
      cap = Math.max(0, Math.floor(next));
    },
  };
}

/** Process-wide Gemini budget, configured from GEMINI_DAILY_CALL_CAP at startup. */
export const geminiBudget = createDailyBudget();

/** Per-key (client IP) counter for events like Live voice session starts, reset at 00:00 UTC. */
export function createDailyKeyedCounter(now: () => number = Date.now) {
  let day = utcDay(now());
  const counts = new Map<string, number>();
  return {
    /** Counts one event for `key`; false if `cap` was already reached today (cap 0 = unlimited). */
    tryTake(key: string, cap: number): boolean {
      const today = utcDay(now());
      if (today !== day) {
        day = today;
        counts.clear();
      }
      if (cap <= 0) return true;
      const used = counts.get(key) ?? 0;
      if (used >= cap) return false;
      counts.set(key, used + 1);
      return true;
    },
  };
}
