import {
  type ErrorSkillArea,
  type ErrorTaxonomyEntry,
  type ErrorTaxonomyKey,
  getTaxonomyEntry,
  normalizeErrorTaxonomyKey,
} from '../data/errorTaxonomy.ts';
import type {DlptDrillResult, ErrorEvent, ErrorEventSource, OpiSession, TargetLanguage} from '../types.ts';
import {computeDlptSkillEstimates} from './dlptRules.ts';

export const ERROR_EVENT_RETENTION_DAYS = 60;
export const ERROR_RANKING_WINDOW_DAYS = 14;
export const MAX_STORED_ERROR_EVENTS = 500;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const ERROR_SOURCE_LABELS: Readonly<Record<ErrorEventSource, string>> = {
  opi: 'OPI',
  redo: 'OPI Redo',
  roleplay: 'Role-play',
  talk: 'Talk',
  interp: 'Interp',
  dlpt: 'DLPT',
  gist: 'Gist',
};

export interface ErrorPatternExample {
  wrong: string;
  fix: string;
  quote?: string;
  source: ErrorEventSource;
  at: string;
}

export interface RankedErrorPattern {
  key: ErrorTaxonomyKey;
  entry: ErrorTaxonomyEntry;
  count: number;
  sessionCount: number;
  totalSessionsInWindow: number;
  /** Compact display count like "9×" or "4 of 7" */
  displayCount: string;
  /** Always "N×" */
  countLabel: string;
  /** "X of Y" when multiple sessions exist */
  sessionRatioLabel: string | null;
  score: number;
  recencyScore: number;
  impactMultiplier: number;
  isAboveFloorTarget: boolean;
  matchesWeakestSkill: boolean;
  sources: ErrorEventSource[];
  sourcesLabel: string;
  example: ErrorPatternExample;
  lastSeenAt: string;
}

export interface RankErrorOptions {
  language: TargetLanguage;
  /** User's current confirmed floor (0..3). Errors at floor + 1 rank highest. Defaults to 2 (so Level 3 ranks highest). */
  currentFloor?: 0 | 1 | 2 | 3;
  /** User's weakest skill area. Errors in this skill get an impact boost. */
  weakestSkill?: ErrorSkillArea;
  /** Reference timestamp in ms (defaults to Date.now()). */
  nowMs?: number;
  /** Ranking window in days (defaults to 14). */
  windowDays?: number;
}

/**
 * Keeps only events within the rolling 60-day retention window.
 */
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

function parseIlrNumeric(label: string | null | undefined): number | null {
  if (!label) return null;
  const trimmed = label.trim();
  if (trimmed === '0+') return 0.5;
  if (trimmed === '1') return 1.0;
  if (trimmed === '1+') return 1.5;
  if (trimmed === '2') return 2.0;
  if (trimmed === '2+') return 2.5;
  if (trimmed === '3') return 3.0;
  if (trimmed === '3+') return 3.5;
  return null;
}

/**
 * Estimates the user's current ILR floor (0..3) and weakest skill area from OPI sessions,
 * DLPT listening/reading estimates, and recent gist error density.
 */
export function deriveUserSkillProfile(params: {
  language: TargetLanguage;
  sessions?: readonly OpiSession[];
  dlptResults?: readonly DlptDrillResult[];
  events?: readonly ErrorEvent[];
  nowMs?: number;
}): {currentFloor: 0 | 1 | 2 | 3; weakestSkill: ErrorSkillArea} {
  const {language, sessions = [], dlptResults = [], events = [], nowMs = Date.now()} = params;

  // 1. Speaking floor from latest debriefed OPI session for active language
  const langSessions = sessions
    .filter((s) => s.language === language && s.debrief)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const latestDebrief = langSessions[0]?.debrief;

  let speakingScore: number | null = null;
  let speakingFloor: 0 | 1 | 2 | 3 | null = null;
  if (latestDebrief) {
    if (
      latestDebrief.floorLevel === 0 ||
      latestDebrief.floorLevel === 1 ||
      latestDebrief.floorLevel === 2 ||
      latestDebrief.floorLevel === 3
    ) {
      speakingFloor = latestDebrief.floorLevel;
    }
    speakingScore = parseIlrNumeric(latestDebrief.estimatedIlr) ?? speakingFloor;
  }

  // 2. Listening & Reading from DLPT estimates
  const dlpt = computeDlptSkillEstimates(dlptResults, language);
  const listeningScore = parseIlrNumeric(dlpt.listening.estimatedIlr);
  const readingScore = parseIlrNumeric(dlpt.reading.estimatedIlr);

  // 3. Determine currentFloor (conservative minimum across measured speaking/listening/reading, default 2)
  const measuredScores: Array<{skill: ErrorSkillArea; score: number}> = [];
  if (speakingScore !== null) measuredScores.push({skill: 'speaking', score: speakingScore});
  if (listeningScore !== null) measuredScores.push({skill: 'listening', score: listeningScore});
  if (readingScore !== null) measuredScores.push({skill: 'reading', score: readingScore});

  // Also check if recent gist additions/distortions are high
  const cutoff14d = nowMs - ERROR_RANKING_WINDOW_DAYS * MS_PER_DAY;
  const recentGistErrors = events.filter(
    (e) => e.language === language && e.source === 'gist' && Date.parse(e.at) >= cutoff14d
  ).length;

  let currentFloor: 0 | 1 | 2 | 3 = 2;
  let weakestSkill: ErrorSkillArea = 'speaking';

  if (measuredScores.length > 0) {
    measuredScores.sort((a, b) => a.score - b.score);
    weakestSkill = measuredScores[0].skill;
    const minFloor = speakingFloor ?? Math.floor(measuredScores[0].score);
    currentFloor = Math.max(0, Math.min(3, Math.floor(minFloor))) as 0 | 1 | 2 | 3;
  } else if (recentGistErrors >= 3) {
    weakestSkill = 'gist';
  }

  return {currentFloor, weakestSkill};
}

/**
 * Ranks recurring errors over the last 14 days by count, weighted by:
 * 1) Recency (exponential decay so fresher errors outweigh stale ones),
 * 2) Target level just above current floor (currentFloor + 1 gets the highest impact multiplier),
 * 3) Weakest skill area match.
 */
export function rankRecurringErrors(events: readonly ErrorEvent[], options: RankErrorOptions): RankedErrorPattern[] {
  const {
    language,
    currentFloor = 2,
    weakestSkill = 'speaking',
    nowMs = Date.now(),
    windowDays = ERROR_RANKING_WINDOW_DAYS,
  } = options;

  const cutoff = nowMs - windowDays * MS_PER_DAY;
  const targetAboveFloor = Math.min(3, Math.max(1, currentFloor + 1));

  // Filter valid events within window for the active language
  const windowEvents: ErrorEvent[] = [];
  const allSessionsInWindow = new Set<string>();

  for (const ev of events) {
    if (ev.language !== language) continue;
    const ts = Date.parse(ev.at);
    if (!Number.isFinite(ts) || ts < cutoff || ts > nowMs + MS_PER_DAY) continue;
    const canonical = normalizeErrorTaxonomyKey(ev.key, language);
    if (!canonical) continue;
    const normalizedEvent = canonical === ev.key ? ev : {...ev, key: canonical};
    windowEvents.push(normalizedEvent);
    if (normalizedEvent.sessionId) {
      allSessionsInWindow.add(normalizedEvent.sessionId);
    }
  }

  if (windowEvents.length === 0) return [];

  const totalSessionsInWindow = Math.max(1, allSessionsInWindow.size);

  // Group events by taxonomy key
  const groups = new Map<ErrorTaxonomyKey, ErrorEvent[]>();
  for (const ev of windowEvents) {
    const list = groups.get(ev.key);
    if (list) list.push(ev);
    else groups.set(ev.key, [ev]);
  }

  const ranked: RankedErrorPattern[] = [];

  for (const [key, list] of groups.entries()) {
    const entry = getTaxonomyEntry(key);
    // Sort newest first so we pick the freshest real wrong -> fix example
    list.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

    let recencyScore = 0;
    const sessionSet = new Set<string>();
    const sourceSet = new Set<ErrorEventSource>();

    for (const ev of list) {
      const ts = Date.parse(ev.at);
      const ageDays = Math.max(0, (nowMs - ts) / MS_PER_DAY);
      // Half-life ~5.5 days: today = 1.0, 5.5d ago = 0.5, 14d ago ≈ 0.17
      recencyScore += Math.pow(0.5, ageDays / 5.5);
      if (ev.sessionId) sessionSet.add(ev.sessionId);
      sourceSet.add(ev.source);
    }

    const isAboveFloorTarget = entry.ilrLevel === targetAboveFloor;
    const levelWeight = isAboveFloorTarget ? 1.65 : entry.ilrLevel === currentFloor ? 1.15 : 0.9;

    const matchesWeakestSkill =
      entry.skill === weakestSkill ||
      (weakestSkill === 'listening' && entry.skill === 'gist') ||
      (weakestSkill === 'gist' && entry.skill === 'listening');
    const skillWeight = entry.skill === weakestSkill ? 1.45 : matchesWeakestSkill ? 1.2 : 1.0;

    const impactMultiplier = Number((levelWeight * skillWeight).toFixed(3));
    const score = Number((recencyScore * impactMultiplier).toFixed(4));

    const count = list.length;
    const sessionCount = Math.max(1, sessionSet.size);
    const countLabel = `${count}×`;
    const sessionRatioLabel =
      totalSessionsInWindow >= 3 && sessionCount >= 2 ? `${sessionCount} of ${totalSessionsInWindow}` : null;
    const displayCount = sessionRatioLabel && count === sessionCount ? sessionRatioLabel : countLabel;

    // Pick best real wrong -> fix example from the user's own sessions
    const bestExampleEvent = list.find((e) => e.wrong.trim() && e.fix.trim()) ?? list[0];
    const example: ErrorPatternExample = {
      wrong: bestExampleEvent.wrong.trim(),
      fix: bestExampleEvent.fix.trim(),
      ...(bestExampleEvent.quote?.trim() ? {quote: bestExampleEvent.quote.trim()} : {}),
      source: bestExampleEvent.source,
      at: bestExampleEvent.at,
    };

    const sources = Array.from(sourceSet);
    const sourcesLabel = sources.map((s) => ERROR_SOURCE_LABELS[s]).join(' · ');

    ranked.push({
      key,
      entry,
      count,
      sessionCount,
      totalSessionsInWindow,
      displayCount,
      countLabel,
      sessionRatioLabel,
      score,
      recencyScore: Number(recencyScore.toFixed(4)),
      impactMultiplier,
      isAboveFloorTarget,
      matchesWeakestSkill,
      sources,
      sourcesLabel,
      example,
      lastSeenAt: list[0].at,
    });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.count !== a.count) return b.count - a.count;
    return Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt);
  });

  return ranked;
}

/**
 * Returns the #1 ranked recurring error for the Today view ("Top Fix"), or null if none exist.
 */
export function getTopFix(events: readonly ErrorEvent[], options: RankErrorOptions): RankedErrorPattern | null {
  const ranked = rankRecurringErrors(events, options);
  return ranked[0] ?? null;
}
