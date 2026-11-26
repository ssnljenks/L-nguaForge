import type {ErrorEvent} from '../types.ts';

/** The 60-day error event log, light enough for startup storage and App (REVIEW M-7). */

export const ERROR_EVENT_RETENTION_DAYS = 60;
export const MAX_STORED_ERROR_EVENTS = 500;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Keeps only events within the rolling 60-day retention window. */
export function pruneErrorEvents(
  events: readonly ErrorEvent[],
  nowMs = Date.now(),
  retentionDays = ERROR_EVENT_RETENTION_DAYS
): ErrorEvent[] {
  const cutoff = nowMs - retentionDays * MS_PER_DAY;
  return events
    .filter((ev) => {
      const ts = Date.parse(ev.at);
      return Number.isFinite(ts) && ts >= cutoff;
    })
    .slice(-MAX_STORED_ERROR_EVENTS);
}

/**
 * Append-only event store helper: appends new events and enforces the 60-day window.
 */
export function appendErrorEventsToStore(
  existing: readonly ErrorEvent[],
  incoming: readonly ErrorEvent[],
  nowMs = Date.now()
): ErrorEvent[] {
  if (incoming.length === 0) return pruneErrorEvents(existing, nowMs);
  return pruneErrorEvents([...existing, ...incoming], nowMs);
}
