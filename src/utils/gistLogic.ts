import type {
  BriefItem,
  ErrorLogEntry,
  GistFinding,
  GistGradeResult,
  GistMainPointRating,
  TargetLanguage,
} from '../types.ts';

export const GIST_TIMER_SECONDS = 60;

export function formatGistCountdown(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function countSummarySentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const parts = trimmed
    .split(/[.!?]+(?:\s+|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length;
}

export function isGistMainPointRating(val: unknown): val is GistMainPointRating {
  return val === 'captured' || val === 'partial' || val === 'missed';
}

export interface GistHighlightSegment {
  text: string;
  isAddition: boolean;
  additionIndex?: number;
}

/**
 * Splits the learner's summary into plain text and highlighted addition spans.
 * Matches spans case-insensitively and resolves overlaps cleanly without raw HTML injection.
 */
export function segmentGistHighlights(summary: string, additions: readonly GistFinding[]): GistHighlightSegment[] {
  if (!summary) return [];

  const lowerSummary = summary.toLowerCase();
  const ranges: Array<{start: number; end: number; additionIndex: number}> = [];

  additions.forEach((item, additionIndex) => {
    const rawSpan = item.learnerSpan?.trim();
    if (!rawSpan || rawSpan.length < 3) return;
    const lowerSpan = rawSpan.toLowerCase();
    const idx = lowerSummary.indexOf(lowerSpan);
    if (idx !== -1) {
      ranges.push({start: idx, end: idx + rawSpan.length, additionIndex});
    }
  });

  if (ranges.length === 0) {
    return [{text: summary, isAddition: false}];
  }

  // Sort by start ascending, preferring longer span on tie
  ranges.sort((a, b) => (a.start !== b.start ? a.start - b.start : b.end - a.end));

  // Merge/skip overlapping ranges
  const merged: Array<{start: number; end: number; additionIndex: number}> = [];
  for (const r of ranges) {
    const prev = merged[merged.length - 1];
    if (!prev || r.start >= prev.end) {
      merged.push({...r});
    } else if (r.end > prev.end) {
      prev.end = r.end;
    }
  }

  const segments: GistHighlightSegment[] = [];
  let cursor = 0;

  for (const r of merged) {
    if (r.start > cursor) {
      segments.push({text: summary.slice(cursor, r.start), isAddition: false});
    }
    segments.push({
      text: summary.slice(r.start, r.end),
      isAddition: true,
      additionIndex: r.additionIndex,
    });
    cursor = r.end;
  }

  if (cursor < summary.length) {
    segments.push({text: summary.slice(cursor), isAddition: false});
  }

  return segments;
}

/**
 * Picks the next audio clip in the same language for the Gist "Next clip" button.
 * Prefers unseen clips first, then cycles cleanly through other audio items.
 */
export function pickNextAudioClip(
  currentId: string,
  candidates: readonly BriefItem[],
  language: TargetLanguage,
  seenIds?: ReadonlySet<string>
): BriefItem | null {
  const uniqueAudio = new Map<string, BriefItem>();
  for (const item of candidates) {
    if (item.language === language && item.mediaType === 'audio') {
      uniqueAudio.set(item.id, item);
    }
  }
  const pool = Array.from(uniqueAudio.values()).filter((i) => i.id !== currentId);
  if (pool.length === 0) return null;

  if (seenIds && seenIds.size > 0) {
    const unseen = pool.find((i) => !seenIds.has(i.id));
    if (unseen) return unseen;
  }

  return pool[0] ?? null;
}

/**
 * Builds structured Phase 8 error log entries from a graded Gist drill.
 * Logs additions first (severity: 'high'), followed by omissions and distortions.
 */
export function buildGistErrorLogEntries(
  item: Pick<BriefItem, 'id' | 'language' | 'dialectId'>,
  grade: GistGradeResult
): Array<Omit<ErrorLogEntry, 'id' | 'createdAt'>> {
  const entries: Array<Omit<ErrorLogEntry, 'id' | 'createdAt'>> = [];

  for (const addition of grade.additions) {
    entries.push({
      source: 'gist',
      category: 'addition',
      severity: 'high',
      language: item.language,
      dialect: item.dialectId,
      briefId: item.id,
      summary: addition.description,
      ...(addition.learnerSpan ? {learnerSpan: addition.learnerSpan} : {}),
      ...(addition.sourceQuote ? {sourceQuote: addition.sourceQuote} : {}),
    });
  }

  for (const omission of grade.omissions) {
    entries.push({
      source: 'gist',
      category: 'omission',
      severity: 'medium',
      language: item.language,
      dialect: item.dialectId,
      briefId: item.id,
      summary: omission.description,
      ...(omission.sourceQuote ? {sourceQuote: omission.sourceQuote} : {}),
    });
  }

  for (const distortion of grade.distortions) {
    entries.push({
      source: 'gist',
      category: 'distortion',
      severity: 'medium',
      language: item.language,
      dialect: item.dialectId,
      briefId: item.id,
      summary: distortion.description,
      ...(distortion.learnerSpan ? {learnerSpan: distortion.learnerSpan} : {}),
      ...(distortion.sourceQuote ? {sourceQuote: distortion.sourceQuote} : {}),
    });
  }

  return entries;
}
