/**
 * Validation for data persisted in localStorage.
 *
 * Stored JSON can be corrupted, edited by hand, or written by an older/newer version of the
 * app. Each sanitizer repairs what it can (filling defaults, clamping numbers) and drops
 * records that are missing essential fields, so one bad entry never wipes the rest of the
 * user's data or crashes a module. A sanitizer returns `undefined` when nothing is usable,
 * which makes `useLocalStorage` fall back to its initial value.
 */
import type {
  ChatStruggleSuggestion,
  DebriefReport,
  DrillHistoryEntry,
  FreeChatMessage,
  FreeChatThread,
  MilitaryDomain,
  MissionConfig,
  ModuleTab,
  OpiMessage,
  OpiSession,
  TargetLanguage,
  VocabItem,
} from '../types';
import {CHAT_REGISTER_MODES, DIALECTS_BY_LANGUAGE, isVocabCategory, MILITARY_DOMAINS} from './ilrLogic';

export type Sanitizer<T> = (raw: unknown) => T | undefined;

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Required non-empty string, or undefined. */
function reqStr(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function num(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isoDate(value: unknown, fallback = new Date(0).toISOString()): string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

/** Sanitizes every item, dropping the ones that come back undefined. */
function arrayOf<T>(value: unknown, item: (raw: unknown) => T | undefined): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(item).filter((x): x is T => x !== undefined);
}

function stringArray(value: unknown): string[] {
  return arrayOf(value, (v) => (typeof v === 'string' ? v : undefined));
}

const LANGUAGES: readonly TargetLanguage[] = ['es', 'pt'];
const DOMAIN_IDS = MILITARY_DOMAINS.map((d) => d.id) as readonly MilitaryDomain[];
const MODULE_TABS: readonly ModuleTab[] = ['chat', 'opi', 'debrief', 'vault', 'lab'];

function language(value: unknown): TargetLanguage {
  return oneOf(value, LANGUAGES, 'es');
}

function dialectFor(lang: TargetLanguage, value: unknown): string {
  const dialects = DIALECTS_BY_LANGUAGE[lang];
  return dialects.some((d) => d.id === value) ? (value as string) : dialects[0].id;
}

function domain(value: unknown): MilitaryDomain {
  return oneOf(value, DOMAIN_IDS, 'general_policy');
}

// ---------------------------------------------------------------------------
// Per-key sanitizers
// ---------------------------------------------------------------------------

export function sanitizeMissionConfig(defaults: MissionConfig): Sanitizer<MissionConfig> {
  return (raw) => {
    if (!isRecord(raw)) return undefined;
    const lang = oneOf(raw.language, LANGUAGES, defaults.language);
    return {
      language: lang,
      dialect: dialectFor(lang, raw.dialect),
      domain: oneOf(raw.domain, DOMAIN_IDS, defaults.domain),
      speechRate: num(raw.speechRate, defaults.speechRate, 0.5, 2),
      autoSpeakExaminer: bool(raw.autoSpeakExaminer, defaults.autoSpeakExaminer),
      handsFreeMode: bool(raw.handsFreeMode, defaults.handsFreeMode),
      voiceURI: str(raw.voiceURI, defaults.voiceURI),
    };
  };
}

export const sanitizeSeenTabs: Sanitizer<ModuleTab[]> = (raw) => {
  if (!Array.isArray(raw)) return undefined;
  return [...new Set(arrayOf(raw, (v) => (MODULE_TABS.includes(v as ModuleTab) ? (v as ModuleTab) : undefined)))];
};

function vocabItem(raw: unknown): VocabItem | undefined {
  if (!isRecord(raw)) return undefined;
  const id = reqStr(raw.id);
  const term = reqStr(raw.term);
  if (!id || !term) return undefined;
  const lang = language(raw.language);
  return {
    id,
    term,
    englishConcept: str(raw.englishConcept),
    contextSentence: str(raw.contextSentence),
    registerTag: str(raw.registerTag, 'General Usage'),
    category: isVocabCategory(raw.category) ? raw.category : 'Regional Idioms',
    language: lang,
    dialect: dialectFor(lang, raw.dialect),
    domain: domain(raw.domain),
    createdAt: isoDate(raw.createdAt),
    mastery: oneOf(raw.mastery, ['new', 'practicing', 'mastered'] as const, 'new'),
    reviewCount: Math.round(num(raw.reviewCount, 0, 0)),
  };
}

export const sanitizeVocabItems: Sanitizer<VocabItem[]> = (raw) =>
  Array.isArray(raw) ? arrayOf(raw, vocabItem) : undefined;

function opiMessage(raw: unknown): OpiMessage | undefined {
  if (!isRecord(raw)) return undefined;
  const id = reqStr(raw.id);
  if (!id || typeof raw.text !== 'string') return undefined;
  const message: OpiMessage = {
    id,
    role: oneOf(raw.role, ['examiner', 'candidate'] as const, 'candidate'),
    text: raw.text,
    timestamp: isoDate(raw.timestamp),
    probeLevel: oneOf(raw.probeLevel, ['level_2_baseline', 'level_3_probe'] as const, 'level_2_baseline'),
  };
  if (typeof raw.probeReason === 'string') message.probeReason = raw.probeReason;
  return message;
}

function debriefReport(raw: unknown): DebriefReport | undefined {
  if (!isRecord(raw) || !isRecord(raw.discourseAudit)) return undefined;
  const audit = raw.discourseAudit;
  const score = (v: unknown) => Math.round(num(v, 0, 0, 100));
  return {
    generatedAt: isoDate(raw.generatedAt),
    estimatedIlr: str(raw.estimatedIlr, 'Unrated'),
    summaryAssessment: str(raw.summaryAssessment),
    discourseAudit: {
      pointScore: score(audit.pointScore),
      reasonScore: score(audit.reasonScore),
      exampleScore: score(audit.exampleScore),
      pivotScore: score(audit.pivotScore),
      cohesionNotes: str(audit.cohesionNotes),
      subjunctiveControl: str(audit.subjunctiveControl),
      timeFrameStability: str(audit.timeFrameStability),
    },
    naturalUpgrades: arrayOf(raw.naturalUpgrades, (u) => {
      if (!isRecord(u) || !reqStr(u.originalLevel2) || !reqStr(u.upgradedLevel2Plus)) return undefined;
      return {
        originalLevel2: str(u.originalLevel2),
        upgradedLevel2Plus: str(u.upgradedLevel2Plus),
        connectorsUsed: stringArray(u.connectorsUsed),
        whyItUpgrades: str(u.whyItUpgrades),
      };
    }),
    nextDrillRecommendation: str(raw.nextDrillRecommendation),
  };
}

function opiSession(raw: unknown): OpiSession | undefined {
  if (!isRecord(raw)) return undefined;
  const id = reqStr(raw.id);
  if (!id) return undefined;
  const lang = language(raw.language);
  const session: OpiSession = {
    id,
    type: oneOf(raw.type, ['opi', 'prep_monologue'] as const, 'opi'),
    language: lang,
    dialect: dialectFor(lang, raw.dialect),
    domain: domain(raw.domain),
    startedAt: isoDate(raw.startedAt),
    durationSeconds: Math.round(num(raw.durationSeconds, 0, 0)),
    messages: arrayOf(raw.messages, opiMessage),
  };
  const debrief = debriefReport(raw.debrief);
  if (debrief) session.debrief = debrief;
  if (typeof raw.prepPrompt === 'string') session.prepPrompt = raw.prepPrompt;
  return session;
}

export const sanitizeSessions: Sanitizer<OpiSession[]> = (raw) =>
  Array.isArray(raw) ? arrayOf(raw, opiSession) : undefined;

function historyEntry(raw: unknown): DrillHistoryEntry | undefined {
  if (!isRecord(raw)) return undefined;
  const id = reqStr(raw.id);
  if (!id) return undefined;
  const lang = language(raw.language);
  return {
    id,
    module: oneOf(raw.module, ['chat', 'opi', 'prep', 'interp', 'vocab_recall'] as const, 'chat'),
    language: lang,
    dialect: dialectFor(lang, raw.dialect),
    domain: domain(raw.domain),
    completedAt: isoDate(raw.completedAt),
    summary: str(raw.summary),
    scoreLabel: str(raw.scoreLabel),
  };
}

export const sanitizeHistory: Sanitizer<DrillHistoryEntry[]> = (raw) =>
  Array.isArray(raw) ? arrayOf(raw, historyEntry) : undefined;

function struggleSuggestion(raw: unknown): ChatStruggleSuggestion | undefined {
  if (!isRecord(raw)) return undefined;
  const targetPhrase = reqStr(raw.targetPhrase);
  if (!targetPhrase) return undefined;
  return {
    targetPhrase,
    englishConcept: str(raw.englishConcept),
    contextSentence: str(raw.contextSentence),
    reasonTag: str(raw.reasonTag, 'Useful expression'),
    note: str(raw.note),
    suggestedCategory: isVocabCategory(raw.suggestedCategory) ? raw.suggestedCategory : 'Regional Idioms',
  };
}

function chatMessage(raw: unknown): FreeChatMessage | undefined {
  if (!isRecord(raw)) return undefined;
  const id = reqStr(raw.id);
  if (!id || typeof raw.text !== 'string') return undefined;
  const message: FreeChatMessage = {
    id,
    role: oneOf(raw.role, ['user', 'assistant'] as const, 'user'),
    text: raw.text,
    timestamp: isoDate(raw.timestamp),
  };
  if (Array.isArray(raw.struggleSuggestions)) {
    message.struggleSuggestions = arrayOf(raw.struggleSuggestions, struggleSuggestion);
  }
  return message;
}

function chatThread(raw: unknown): FreeChatThread | undefined {
  if (!isRecord(raw)) return undefined;
  const id = reqStr(raw.id);
  if (!id) return undefined;
  const lang = language(raw.language);
  return {
    id,
    title: str(raw.title, 'Conversation'),
    language: lang,
    dialect: dialectFor(lang, raw.dialect),
    registerMode: oneOf(raw.registerMode, CHAT_REGISTER_MODES, 'professional'),
    updatedAt: isoDate(raw.updatedAt),
    messages: arrayOf(raw.messages, chatMessage),
    savedTerms: stringArray(raw.savedTerms),
  };
}

export const sanitizeChatThreads: Sanitizer<FreeChatThread[]> = (raw) =>
  Array.isArray(raw) ? arrayOf(raw, chatThread) : undefined;
