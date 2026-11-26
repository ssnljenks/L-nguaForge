import {getTutorById, type TutorPersona} from '../data/tutors.ts';
import type {
  MilitaryDomain,
  TalkCorrectionMode,
  TalkPickedUpItem,
  TalkVocabKind,
  TalkWrapUpItem,
  TargetLanguage,
  VocabCategory,
  VocabItem,
} from '../types.ts';

export interface SlangLevelSpec {
  level: 0 | 1 | 2 | 3 | 4;
  label: string;
  shortDesc: string;
}

export const SLANG_LEVEL_SPECS: readonly SlangLevelSpec[] = [
  {level: 0, label: 'Textbook', shortDesc: 'Clear, standard everyday phrasing without slang'},
  {level: 1, label: 'Polite casual', shortDesc: 'Warm everyday speech with light local expressions'},
  {level: 2, label: 'Everyday local', shortDesc: 'Natural neighborhood rhythm and common idioms'},
  {level: 3, label: 'Colloquial', shortDesc: 'Frequent local slang, contractions, and fillers'},
  {level: 4, label: 'Full street', shortDesc: 'Unfiltered street slang, local humor, and rapid rhythm'},
];

export function clampSlangLevel(value: unknown): 0 | 1 | 2 | 3 | 4 {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 2;
  const rounded = Math.round(value);
  if (rounded <= 0) return 0;
  if (rounded === 1) return 1;
  if (rounded === 2) return 2;
  if (rounded === 3) return 3;
  return 4;
}

export function getSlangLevelSpec(level: unknown): SlangLevelSpec {
  const clamped = clampSlangLevel(level);
  return SLANG_LEVEL_SPECS[clamped];
}

export const TALK_CORRECTION_OPTIONS: readonly {
  id: TalkCorrectionMode;
  label: string;
  hint: string;
}[] = [
  {id: 'recast', label: 'Recast as I go', hint: 'Echoes the natural local form in conversation'},
  {id: 'end_only', label: 'At the end only', hint: 'Flows uninterrupted; shares tips when wrapping up'},
  {id: 'off', label: 'Off', hint: 'Pure conversation with zero corrections'},
];

export function normalizeTalkTerm(text: string): string {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿¡.,!?;:"'()[\]]+/g, '')
    .replace(/\s+/g, ' ');
}

export function isTermInVocab(term: string, language: TargetLanguage, vocabItems: readonly VocabItem[]): boolean {
  const target = normalizeTalkTerm(term);
  if (!target) return false;
  return vocabItems.some((item) => item.language === language && normalizeTalkTerm(item.term) === target);
}

export interface RegionalTermCandidate {
  term: string;
  meaning: string;
  regionTag: string;
}

export interface HighlightedSegment {
  text: string;
  match?: RegionalTermCandidate;
}

/** Collects regional/colloquial candidates for a tutor + message/thread pickedUp items, deduped longest-first. */
export function buildRegionalCandidates(
  tutor: TutorPersona | undefined,
  pickedUpLists: ReadonlyArray<readonly TalkPickedUpItem[] | undefined>
): RegionalTermCandidate[] {
  const byNorm = new Map<string, RegionalTermCandidate>();
  for (const list of pickedUpLists) {
    for (const item of list ?? []) {
      const norm = normalizeTalkTerm(item.term);
      if (norm.length < 2) continue;
      byNorm.set(norm, {
        term: item.term.trim(),
        meaning: item.meaning.trim(),
        regionTag: item.regionTag.trim() || tutor?.regionTag || 'Local',
      });
    }
  }
  for (const ex of tutor?.slangExamples ?? []) {
    const norm = normalizeTalkTerm(ex.term);
    if (norm.length < 2 || byNorm.has(norm)) continue;
    byNorm.set(norm, {
      term: ex.term,
      meaning: ex.meaning,
      regionTag: tutor?.regionTag || 'Local',
    });
  }
  return [...byNorm.values()].sort((a, b) => b.term.length - a.term.length);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function accentFoldWithMap(text: string): {folded: string; startMap: number[]; endMap: number[]} {
  let folded = '';
  const startMap: number[] = [];
  const endMap: number[] = [];
  let idx = 0;
  for (const ch of text) {
    const base = ch
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    for (let j = 0; j < base.length; j++) {
      folded += base[j];
      startMap.push(idx);
      endMap.push(idx + ch.length);
    }
    idx += ch.length;
  }
  return {folded, startMap, endMap};
}

/**
 * Splits `text` into plain segments and dotted-underline colloquial spans using accent-insensitive
 * whole-word matching against known regional terms and AI-spotted `pickedUp` expressions.
 */
export function detectRegionalTermsInText(
  text: string,
  candidates: readonly RegionalTermCandidate[]
): HighlightedSegment[] {
  if (!text) return [];
  if (candidates.length === 0) return [{text}];

  const usable = candidates
    .map((c) => ({candidate: c, norm: normalizeTalkTerm(c.term)}))
    .filter((x) => x.norm.length >= 2)
    .sort((a, b) => b.norm.length - a.norm.length);

  if (usable.length === 0) return [{text}];

  const {folded, startMap, endMap} = accentFoldWithMap(text);
  const ranges: Array<{start: number; end: number; match: RegionalTermCandidate}> = [];
  const taken = (s: number, e: number) => ranges.some((r) => s < r.end && e > r.start);

  const wordChar = /[a-z0-9]/;
  for (const {candidate, norm} of usable) {
    const pattern = new RegExp(escapeRegExp(norm), 'g');
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(folded)) !== null) {
      const fStart = m.index;
      const fEnd = m.index + m[0].length;
      const before = fStart > 0 ? folded[fStart - 1] : '';
      const after = fEnd < folded.length ? folded[fEnd] : '';
      if ((before && wordChar.test(before)) || (after && wordChar.test(after))) continue;
      const origStart = startMap[fStart];
      const origEnd = endMap[fEnd - 1];
      if (origStart === undefined || origEnd === undefined) continue;
      if (!taken(origStart, origEnd)) {
        ranges.push({start: origStart, end: origEnd, match: candidate});
      }
    }
  }

  if (ranges.length === 0) return [{text}];
  ranges.sort((a, b) => a.start - b.start);

  const segments: HighlightedSegment[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) segments.push({text: text.slice(cursor, r.start)});
    segments.push({text: text.slice(r.start, r.end), match: r.match});
    cursor = r.end;
  }
  if (cursor < text.length) segments.push({text: text.slice(cursor)});
  return segments;
}

export function mergePickedUpItems(
  existing: readonly TalkPickedUpItem[],
  incoming: readonly TalkPickedUpItem[]
): TalkPickedUpItem[] {
  const byNorm = new Map<string, TalkPickedUpItem>();
  for (const item of existing) {
    const norm = normalizeTalkTerm(item.term);
    if (norm) byNorm.set(norm, item);
  }
  for (const item of incoming) {
    const norm = normalizeTalkTerm(item.term);
    if (!norm) continue;
    const prev = byNorm.get(norm);
    byNorm.set(norm, {
      term: item.term.trim(),
      meaning: item.meaning.trim() || prev?.meaning || '',
      regionTag: item.regionTag.trim() || prev?.regionTag || 'Local',
      ...(item.example?.trim() ? {example: item.example.trim()} : prev?.example ? {example: prev.example} : {}),
      ...(item.kind ? {kind: item.kind} : prev?.kind ? {kind: prev.kind} : {}),
    });
  }
  return [...byNorm.values()];
}

export function buildTalkVocabSaveInput(params: {
  term: string;
  meaning: string;
  exampleSentence: string;
  language: TargetLanguage;
  dialect: string;
  tutorId?: string;
  regionTag?: string;
  kind?: TalkVocabKind;
  workTalk?: boolean;
  domain?: MilitaryDomain;
  registerTag?: string;
  category?: VocabCategory;
}): Omit<VocabItem, 'id' | 'createdAt' | 'mastery' | 'reviewCount'> {
  const tutor = getTutorById(params.tutorId);
  const isWork = Boolean(params.workTalk && params.domain);
  return {
    term: params.term.trim(),
    englishConcept: params.meaning.trim(),
    contextSentence: params.exampleSentence.trim() || params.term.trim(),
    registerTag: params.registerTag?.trim() || (isWork ? 'Work Conversation' : 'Casual Local'),
    category: params.category ?? (isWork ? 'Operational/Military Terms' : 'Regional Idioms'),
    language: params.language,
    dialect: params.dialect,
    ...(isWork && params.domain ? {domain: params.domain} : {}),
    source: 'talk',
    regionTag: params.regionTag?.trim() || tutor?.regionTag || 'Widespread',
    kind: params.kind ?? (params.term.trim().includes(' ') ? 'phrase' : 'word'),
  };
}

export interface AnnotatedWrapUpItem extends TalkWrapUpItem {
  alreadyInVocab: boolean;
}

export function annotateWrapUpItems(
  items: readonly TalkWrapUpItem[],
  language: TargetLanguage,
  vocabItems: readonly VocabItem[]
): AnnotatedWrapUpItem[] {
  const seen = new Set<string>();
  const out: AnnotatedWrapUpItem[] = [];
  for (const item of items) {
    const norm = normalizeTalkTerm(item.term);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push({
      ...item,
      alreadyInVocab: isTermInVocab(item.term, language, vocabItems),
    });
    if (out.length >= 8) break;
  }
  return out;
}

export function isValidTalkVocabKind(value: unknown): value is TalkVocabKind {
  return value === 'word' || value === 'phrase' || value === 'pattern';
}
