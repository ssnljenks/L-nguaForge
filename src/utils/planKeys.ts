import type {TargetLanguage} from '../types.ts';

/** Today-plan storage keys, kept apart from `todayPlan.ts` so the startup bundle doesn't load the planner. */
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
