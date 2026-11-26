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
  BriefIlrLevel,
  ChatStruggleSuggestion,
  DebriefReport,
  DlptDrillResult,
  DlptQuestionOutcome,
  DlptTrapType,
  DrillHistoryEntry,
  ErrorEvent,
  ErrorEventSource,
  ErrorLogEntry,
  FreeChatMessage,
  FreeChatThread,
  GeminiLiveVoice,
  IlrGoalLevel,
  IlrGoals,
  MilitaryDomain,
  MissionConfig,
  ModuleTab,
  OpiMessage,
  OpiSession,
  TalkCorrectionMode,
  TalkPickedUpItem,
  TargetLanguage,
  TodayPlanCompletionStore,
  TodayPlanDayCompletion,
  TurnAssessment,
  VocabItem,
} from '../types.ts';
import {normalizeErrorTaxonomyKey} from '../data/errorTaxonomy.ts';
import {getFunctionLevel, getFunctionSpec, type IlrBaseLevel, isIlrFunctionKey} from '../data/ilrSpeakingLevels.ts';
import {getTutorById} from '../data/tutors.ts';
import {isBriefIlrLevel} from './briefLogic.ts';
import {isDlptQuestionType, isDlptTrapType} from './dlptRules.ts';
import {pruneErrorEvents} from './errorPatterns.ts';
import {CHAT_REGISTER_MODES, DIALECTS_BY_LANGUAGE, isVocabCategory, MILITARY_DOMAINS} from './ilrLogic.ts';
import {
  migrateLegacyLevels,
  normalizeIlrFunctionKey,
  normalizeLevelFunctions,
  normalizeOpiPhase,
  normalizeTurnOutcome,
} from './opiLogic.ts';
import {clampSlangLevel, isValidTalkVocabKind} from './talkLogic.ts';
import {isValidVocabFsrsState, migrateVocabItemToFsrs} from './vocabFsrs.ts';

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
const MODULE_TABS: readonly ModuleTab[] = ['today', 'talk', 'test_prep', 'brief', 'vocab'];
export const GEMINI_LIVE_VOICES: readonly GeminiLiveVoice[] = ['Zephyr', 'Puck', 'Kore', 'Fenrir', 'Charon'];

const LEGACY_TAB_MAP: Record<string, ModuleTab> = {
  chat: 'talk',
  opi: 'test_prep',
  debrief: 'test_prep',
  lab: 'test_prep',
  vault: 'vocab',
};

const LEGACY_FUNCTION_KEYS = ['support_opinion', 'hypothesize', 'abstract_topics', 'extended_discourse'];

/** Maps both current and legacy tab IDs ('chat'|'opi'|'debrief'|'vault'|'lab') to Phase 1 ModuleTab values. */
export function mapLegacyModuleTab(value: unknown): ModuleTab | undefined {
  if (typeof value !== 'string') return undefined;
  if ((MODULE_TABS as readonly string[]).includes(value)) return value as ModuleTab;
  return LEGACY_TAB_MAP[value];
}

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

function optionalDomain(value: unknown): MilitaryDomain | undefined {
  return typeof value === 'string' && (DOMAIN_IDS as readonly string[]).includes(value)
    ? (value as MilitaryDomain)
    : undefined;
}

function sanitizeFunctionKeyIfKnown(value: unknown) {
  if (isIlrFunctionKey(value)) return value;
  if (typeof value === 'string' && LEGACY_FUNCTION_KEYS.includes(value)) {
    return normalizeIlrFunctionKey(value);
  }
  return undefined;
}

function sanitizeTurnAssessment(raw: unknown): TurnAssessment | undefined {
  if (!isRecord(raw)) return undefined;
  const fk = sanitizeFunctionKeyIfKnown(raw.functionKey);
  if (!fk) return undefined;
  const targetLevel: IlrBaseLevel =
    raw.targetLevel === 1 || raw.targetLevel === 2 || raw.targetLevel === 3 ? raw.targetLevel : getFunctionLevel(fk);
  return {
    functionKey: fk,
    outcome: normalizeTurnOutcome(raw.outcome),
    evidence: str(raw.evidence),
    ...(raw.phase !== undefined ? {phase: normalizeOpiPhase(raw.phase)} : {}),
    targetLevel,
  };
}

// ---------------------------------------------------------------------------
// Per-key sanitizers
// ---------------------------------------------------------------------------

const ILR_GOAL_LEVELS: readonly IlrGoalLevel[] = ['1', '1+', '2', '2+', '3', '3+'];
const DEFAULT_ILR_GOALS: IlrGoals = {listening: '3', reading: '3', speaking: '3'};
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeIlrGoals(raw: unknown, fallback: IlrGoals = DEFAULT_ILR_GOALS): IlrGoals {
  if (!isRecord(raw)) return {...fallback};
  return {
    listening: oneOf(raw.listening, ILR_GOAL_LEVELS, fallback.listening),
    reading: oneOf(raw.reading, ILR_GOAL_LEVELS, fallback.reading),
    speaking: oneOf(raw.speaking, ILR_GOAL_LEVELS, fallback.speaking),
  };
}

function sanitizeOptionalTestDate(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!DATE_ONLY_REGEX.test(trimmed)) return undefined;
  const parsed = Date.parse(`${trimmed}T00:00:00Z`);
  return Number.isFinite(parsed) ? trimmed : undefined;
}

export function sanitizeMissionConfig(defaults: MissionConfig): Sanitizer<MissionConfig> {
  return (raw) => {
    if (!isRecord(raw)) return undefined;
    const lang = oneOf(raw.language, LANGUAGES, defaults.language);
    const testDate = sanitizeOptionalTestDate(raw.testDate);
    return {
      language: lang,
      dialect: dialectFor(lang, raw.dialect),
      domain: oneOf(raw.domain, DOMAIN_IDS, defaults.domain),
      workFocusEnabled: bool(raw.workFocusEnabled, defaults.workFocusEnabled),
      speechRate: num(raw.speechRate, defaults.speechRate, 0.5, 2),
      autoSpeakExaminer: bool(raw.autoSpeakExaminer, defaults.autoSpeakExaminer),
      handsFreeMode: bool(raw.handsFreeMode, defaults.handsFreeMode),
      voiceURI: str(raw.voiceURI, defaults.voiceURI),
      liveVoice: oneOf(raw.liveVoice, GEMINI_LIVE_VOICES, defaults.liveVoice),
      ilrGoals: sanitizeIlrGoals(raw.ilrGoals, defaults.ilrGoals ?? DEFAULT_ILR_GOALS),
      ...(testDate ? {testDate} : {}),
    };
  };
}

export const sanitizeActiveTab: Sanitizer<ModuleTab> = (raw) => mapLegacyModuleTab(raw);

export const sanitizeSeenTabs: Sanitizer<ModuleTab[]> = (raw) => {
  if (!Array.isArray(raw)) return undefined;
  return [...new Set(arrayOf(raw, mapLegacyModuleTab))];
};

const VOCAB_SOURCES = ['talk', 'opi', 'brief', 'manual'] as const;

function vocabItem(raw: unknown): VocabItem | undefined {
  if (!isRecord(raw)) return undefined;
  const id = reqStr(raw.id);
  const term = reqStr(raw.term);
  if (!id || !term) return undefined;
  const lang = language(raw.language);
  const dom = optionalDomain(raw.domain);
  const item: VocabItem = {
    id,
    term,
    englishConcept: str(raw.englishConcept),
    contextSentence: str(raw.contextSentence),
    registerTag: str(raw.registerTag, 'General Usage'),
    category: isVocabCategory(raw.category) ? raw.category : 'Regional Idioms',
    language: lang,
    dialect: dialectFor(lang, raw.dialect),
    ...(dom ? {domain: dom} : {}),
    createdAt: isoDate(raw.createdAt),
    mastery: oneOf(raw.mastery, ['new', 'practicing', 'mastered'] as const, 'new'),
    reviewCount: Math.round(num(raw.reviewCount, 0, 0)),
  };
  if (typeof raw.source === 'string' && (VOCAB_SOURCES as readonly string[]).includes(raw.source)) {
    item.source = raw.source as VocabItem['source'];
  }
  if (typeof raw.regionTag === 'string' && raw.regionTag.trim()) {
    item.regionTag = raw.regionTag.trim();
  }
  if (isValidTalkVocabKind(raw.kind)) {
    item.kind = raw.kind;
  }
  item.fsrs = isValidVocabFsrsState(raw.fsrs) ? raw.fsrs : migrateVocabItemToFsrs(item);
  return item;
}

export const sanitizeVocabItems: Sanitizer<VocabItem[]> = (raw) =>
  Array.isArray(raw) ? arrayOf(raw, vocabItem) : undefined;

function opiMessage(raw: unknown): OpiMessage | undefined {
  if (!isRecord(raw)) return undefined;
  const id = reqStr(raw.id);
  if (!id || typeof raw.text !== 'string') return undefined;
  const {workingLevel, probeLevel} = migrateLegacyLevels(raw.workingLevel, raw.probeLevel);
  const defaultPhase = raw.probeLevel === 'level_3_probe' ? 'probe' : 'level_check';
  const message: OpiMessage = {
    id,
    role: oneOf(raw.role, ['examiner', 'candidate'] as const, 'candidate'),
    text: raw.text,
    timestamp: isoDate(raw.timestamp),
    workingLevel,
    probeLevel,
    phase: normalizeOpiPhase(raw.phase, defaultPhase),
  };
  if (typeof raw.elapsedSeconds === 'number' && Number.isFinite(raw.elapsedSeconds)) {
    message.elapsedSeconds = Math.max(0, Math.round(raw.elapsedSeconds));
  }
  const fnKey = sanitizeFunctionKeyIfKnown(raw.targetFunctionKey ?? raw.targetFunction);
  if (fnKey) message.targetFunctionKey = fnKey;
  const assessment = sanitizeTurnAssessment(raw.assessment);
  if (assessment) message.assessment = assessment;
  if (typeof raw.probeReason === 'string') message.probeReason = raw.probeReason;
  return message;
}

function debriefReport(raw: unknown): DebriefReport | undefined {
  if (!isRecord(raw) || !isRecord(raw.discourseAudit)) return undefined;
  const audit = raw.discourseAudit;
  const score = (v: unknown) => Math.round(num(v, 0, 0, 100));
  const report: DebriefReport = {
    generatedAt: isoDate(raw.generatedAt),
    estimatedIlr: str(raw.estimatedIlr, '2'),
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

  if (raw.floorLevel === 0 || raw.floorLevel === 1 || raw.floorLevel === 2 || raw.floorLevel === 3) {
    report.floorLevel = raw.floorLevel;
  }
  if (raw.ceilingLevel === 1 || raw.ceilingLevel === 2 || raw.ceilingLevel === 3 || raw.ceilingLevel === null) {
    report.ceilingLevel = raw.ceilingLevel;
  }
  if (raw.gridLevel === 1 || raw.gridLevel === 2 || raw.gridLevel === 3) {
    report.gridLevel = raw.gridLevel;
  }
  if (typeof raw.ratingNote === 'string' && raw.ratingNote.trim()) {
    report.ratingNote = raw.ratingNote.trim();
  }
  if (typeof raw.oneLineRationale === 'string' && raw.oneLineRationale.trim()) {
    report.oneLineRationale = raw.oneLineRationale.trim();
  }

  if (isRecord(raw.ceilingMoment) && reqStr(raw.ceilingMoment.candidateUtterance)) {
    const cm = raw.ceilingMoment;
    const failedFunction = normalizeIlrFunctionKey(cm.failedFunction);
    report.ceilingMoment = {
      timestampSeconds: Math.round(num(cm.timestampSeconds, 0, 0, 24 * 60 * 60)),
      examinerPrompt: str(cm.examinerPrompt),
      candidateUtterance: str(cm.candidateUtterance),
      problemSpan: str(cm.problemSpan),
      fix: str(cm.fix),
      failedFunction,
      failedFunctionLabel: str(cm.failedFunctionLabel, getFunctionSpec(failedFunction)?.label ?? 'Hypothesize'),
      explanation: str(cm.explanation),
    };
  }

  const rawFns = raw.levelFunctions ?? raw.level3Functions;
  if (Array.isArray(rawFns) && rawFns.length > 0) {
    const inferredGrid: IlrBaseLevel = report.gridLevel ?? 3;
    report.levelFunctions = normalizeLevelFunctions(rawFns, inferredGrid);
  }

  if (Array.isArray(raw.accuracyNotes)) {
    report.accuracyNotes = arrayOf(raw.accuracyNotes, (a) => {
      if (!isRecord(a) || !reqStr(a.descriptor)) return undefined;
      return {
        descriptor: str(a.descriptor),
        observation: str(a.observation),
        status: oneOf(a.status, ['strength', 'watch', 'gap'] as const, 'watch'),
      };
    });
  }

  if (Array.isArray(raw.autoAddedVocab)) {
    report.autoAddedVocab = arrayOf(raw.autoAddedVocab, (v) => {
      if (!isRecord(v) || !reqStr(v.term)) return undefined;
      return {
        term: str(v.term),
        englishConcept: str(v.englishConcept),
        contextSentence: str(v.contextSentence),
        registerTag: str(v.registerTag, 'ILR 2+ Upgrade'),
        category: isVocabCategory(v.category) ? v.category : 'High-Register Connectors',
      };
    });
  }

  return report;
}

function opiSession(raw: unknown): OpiSession | undefined {
  if (!isRecord(raw)) return undefined;
  const id = reqStr(raw.id);
  if (!id) return undefined;
  const lang = language(raw.language);
  const session: OpiSession = {
    id,
    type: oneOf(raw.type, ['opi', 'prep_monologue', 'roleplay'] as const, 'opi'),
    language: lang,
    dialect: dialectFor(lang, raw.dialect),
    startedAt: isoDate(raw.startedAt),
    durationSeconds: Math.round(num(raw.durationSeconds, 0, 0)),
    messages: arrayOf(raw.messages, opiMessage),
  };

  const dom = optionalDomain(raw.domain);
  if (dom) session.domain = dom;
  if (raw.mode === 'exam' || raw.mode === 'practice') session.mode = raw.mode;
  if (raw.focusLevel === 'adaptive' || raw.focusLevel === 1 || raw.focusLevel === 2 || raw.focusLevel === 3) {
    session.focusLevel = raw.focusLevel;
  }
  if (typeof raw.includeRoleplay === 'boolean') session.includeRoleplay = raw.includeRoleplay;

  if (raw.topicSource === 'brief') {
    session.topicSource = 'brief';
  } else if (raw.topicSource === 'examiner_choice' || raw.topicSource === 'domain') {
    // Migrate legacy OPI 'domain' topicSource to general 'examiner_choice'
    session.topicSource = 'examiner_choice';
  }

  const targetKey = sanitizeFunctionKeyIfKnown(raw.targetFunctionKey ?? raw.targetFunction);
  if (targetKey) session.targetFunctionKey = targetKey;

  if (typeof raw.durationTargetSeconds === 'number' && Number.isFinite(raw.durationTargetSeconds)) {
    session.durationTargetSeconds = Math.max(60, Math.round(raw.durationTargetSeconds));
  }
  if (typeof raw.hasLocalAudio === 'boolean') session.hasLocalAudio = raw.hasLocalAudio;

  if (Array.isArray(raw.assessments)) {
    session.assessments = arrayOf(raw.assessments, sanitizeTurnAssessment);
  }

  const debrief = debriefReport(raw.debrief);
  if (debrief) session.debrief = debrief;

  if (isRecord(raw.roleplayScenario) && reqStr(raw.roleplayScenario.scenarioId)) {
    const sc = raw.roleplayScenario;
    const scLang = language(sc.language ?? lang);
    const scLevel: IlrBaseLevel = sc.level === 1 || sc.level === 2 || sc.level === 3 ? sc.level : 2;
    const scReg = oneOf(sc.register, ['usted', 'tú', 'vos', 'você', 'tu'] as const, scLang === 'pt' ? 'você' : 'usted');
    session.roleplayScenario = {
      scenarioId: str(sc.scenarioId),
      level: scLevel,
      language: scLang,
      dialect: dialectFor(scLang, sc.dialect ?? raw.dialect),
      situationEnglish: str(sc.situationEnglish),
      learnerGoal: str(sc.learnerGoal),
      register: scReg,
      characterRole: str(sc.characterRole, 'Local counterpart'),
    };
  }

  if (isRecord(raw.roleplayDebrief) && reqStr(raw.roleplayDebrief.scenarioId)) {
    const rd = raw.roleplayDebrief;
    const rdLevel: IlrBaseLevel = rd.level === 1 || rd.level === 2 || rd.level === 3 ? rd.level : 2;
    const rdReg = oneOf(rd.register, ['usted', 'tú', 'vos', 'você', 'tu'] as const, lang === 'pt' ? 'você' : 'usted');
    session.roleplayDebrief = {
      scenarioId: str(rd.scenarioId),
      level: rdLevel,
      situationEnglish: str(rd.situationEnglish),
      learnerGoal: str(rd.learnerGoal),
      characterRole: str(rd.characterRole),
      register: rdReg,
      hiddenGoal: str(rd.hiddenGoal),
      complication: str(rd.complication),
      checklist: arrayOf(rd.checklist, (c) => {
        if (!isRecord(c) || !reqStr(c.label)) return undefined;
        const fk =
          sanitizeFunctionKeyIfKnown(c.functionKey) ??
          (rdLevel === 1 ? 'l1_simple_qa' : rdLevel === 2 ? 'l2_resolve_complication' : 'l3_support_opinions');
        return {
          itemKey: str(c.itemKey, fk),
          label: str(c.label),
          functionKey: fk,
          status: oneOf(c.status, ['met', 'partly', 'not_met'] as const, 'partly'),
          evidence: str(c.evidence),
        };
      }),
      summary: str(rd.summary),
      resolvedOutcome: oneOf(rd.resolvedOutcome, ['resolved', 'partial', 'unresolved'] as const, 'partial'),
      generatedAt: isoDate(rd.generatedAt),
    };
  }

  if (isRecord(raw.redoRecord) && reqStr(raw.redoRecord.redoAnswer) && isRecord(raw.redoRecord.evaluation)) {
    const ev = raw.redoRecord.evaluation;
    session.redoRecord = {
      examinerPrompt: str(raw.redoRecord.examinerPrompt),
      redoAnswer: str(raw.redoRecord.redoAnswer),
      completedAt: isoDate(raw.redoRecord.completedAt),
      evaluation: {
        improved: bool(ev.improved, false),
        verdictLabel: str(ev.verdictLabel, 'Reviewed'),
        comparisonSummary: str(ev.comparisonSummary),
        strengths: stringArray(ev.strengths),
        remainingGap: str(ev.remainingGap),
        upgradedModelAnswer: str(ev.upgradedModelAnswer),
      },
    };
  }

  if (typeof raw.prepPrompt === 'string') session.prepPrompt = raw.prepPrompt;
  if (isRecord(raw.briefStory) && typeof raw.briefStory.title === 'string') {
    session.briefStory = {
      id: str(raw.briefStory.id),
      title: str(raw.briefStory.title),
      summary: str(raw.briefStory.summary),
      ...(typeof raw.briefStory.orientationLine === 'string' ? {orientationLine: raw.briefStory.orientationLine} : {}),
      ...(typeof raw.briefStory.topic === 'string' ? {topic: raw.briefStory.topic} : {}),
    };
  }
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
    module: oneOf(
      raw.module,
      ['chat', 'opi', 'prep', 'interp', 'vocab_recall', 'roleplay', 'brief_drill', 'brief_gist', 'fix_drill'] as const,
      'chat'
    ),
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

const CORRECTION_MODES: readonly TalkCorrectionMode[] = ['recast', 'end_only', 'off'];

function sanitizePickedUp(raw: unknown): TalkPickedUpItem | undefined {
  if (!isRecord(raw)) return undefined;
  const term = reqStr(raw.term);
  if (!term) return undefined;
  const out: TalkPickedUpItem = {
    term: term.trim(),
    meaning: str(raw.meaning),
    regionTag: str(raw.regionTag, 'Local'),
  };
  if (typeof raw.example === 'string' && raw.example.trim()) out.example = raw.example.trim();
  if (isValidTalkVocabKind(raw.kind)) out.kind = raw.kind;
  return out;
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
  if (typeof raw.recastNote === 'string' && raw.recastNote.trim()) {
    message.recastNote = raw.recastNote.trim();
  }
  if (Array.isArray(raw.pickedUp)) {
    message.pickedUp = arrayOf(raw.pickedUp, sanitizePickedUp);
  }
  return message;
}

function chatThread(raw: unknown): FreeChatThread | undefined {
  if (!isRecord(raw)) return undefined;
  const id = reqStr(raw.id);
  if (!id) return undefined;
  const lang = language(raw.language);
  const thread: FreeChatThread = {
    id,
    title: str(raw.title, 'Conversation'),
    language: lang,
    dialect: dialectFor(lang, raw.dialect),
    registerMode: oneOf(raw.registerMode, CHAT_REGISTER_MODES, 'professional'),
    updatedAt: isoDate(raw.updatedAt),
    messages: arrayOf(raw.messages, chatMessage),
    savedTerms: stringArray(raw.savedTerms),
  };
  if (typeof raw.tutorId === 'string') {
    const tutor = getTutorById(raw.tutorId);
    if (tutor && tutor.language === lang) thread.tutorId = tutor.id;
  }
  if (typeof raw.sceneId === 'string' && raw.sceneId.trim()) {
    thread.sceneId = raw.sceneId.trim();
  }
  if (typeof raw.workTalk === 'boolean') thread.workTalk = raw.workTalk;
  const dom = optionalDomain(raw.domain);
  if (dom) thread.domain = dom;
  if (typeof raw.slangLevel === 'number') thread.slangLevel = clampSlangLevel(raw.slangLevel);
  if (typeof raw.correctionMode === 'string' && (CORRECTION_MODES as readonly string[]).includes(raw.correctionMode)) {
    thread.correctionMode = raw.correctionMode as TalkCorrectionMode;
  }
  if (Array.isArray(raw.pickedUp)) thread.pickedUp = arrayOf(raw.pickedUp, sanitizePickedUp);
  if (Array.isArray(raw.recastNotes)) thread.recastNotes = stringArray(raw.recastNotes);
  return thread;
}

export const sanitizeChatThreads: Sanitizer<FreeChatThread[]> = (raw) =>
  Array.isArray(raw) ? arrayOf(raw, chatThread) : undefined;

function dlptQuestionOutcome(raw: unknown): DlptQuestionOutcome | undefined {
  if (!isRecord(raw)) return undefined;
  const questionId = reqStr(raw.questionId);
  const briefId = reqStr(raw.briefId);
  if (!questionId || !briefId) return undefined;
  const outcome: DlptQuestionOutcome = {
    questionId,
    briefId,
    ilrLevel: isBriefIlrLevel(raw.ilrLevel) ? raw.ilrLevel : '2+',
    questionType: isDlptQuestionType(raw.questionType) ? raw.questionType : 'detail',
    correct: bool(raw.correct, false),
    answered: bool(raw.answered, true),
  };
  if (!outcome.correct && isDlptTrapType(raw.trapType)) {
    outcome.trapType = raw.trapType;
  }
  return outcome;
}

function dlptDrillResult(raw: unknown): DlptDrillResult | undefined {
  if (!isRecord(raw)) return undefined;
  const id = reqStr(raw.id);
  if (!id) return undefined;
  const lang = language(raw.language);
  const outcomes = arrayOf(raw.outcomes, dlptQuestionOutcome);
  const trapsMissed: Partial<Record<DlptTrapType, number>> = {};
  if (isRecord(raw.trapsMissed)) {
    for (const [key, value] of Object.entries(raw.trapsMissed)) {
      if (isDlptTrapType(key) && typeof value === 'number' && Number.isFinite(value) && value > 0) {
        trapsMissed[key] = Math.round(value);
      }
    }
  }
  const passageLevels: BriefIlrLevel[] = Array.isArray(raw.passageLevels)
    ? raw.passageLevels.filter(isBriefIlrLevel)
    : [];

  return {
    id,
    completedAt: isoDate(raw.completedAt),
    language: lang,
    dialect: dialectFor(lang, raw.dialect),
    skill: oneOf(raw.skill, ['listening', 'reading'] as const, 'listening'),
    mode: oneOf(raw.mode, ['practice', 'test'] as const, 'practice'),
    profileId: oneOf(
      raw.profileId,
      ['dlpt5_ca', 'dlpt5_lower_range'] as const,
      lang === 'es' ? 'dlpt5_ca' : 'dlpt5_lower_range'
    ),
    passageIds: stringArray(raw.passageIds),
    passageLevels,
    totalQuestions: num(raw.totalQuestions, outcomes.length, 0, 100),
    correctCount: num(raw.correctCount, outcomes.filter((o) => o.correct).length, 0, 100),
    outcomes,
    trapsMissed,
  };
}

export const sanitizeDlptResults: Sanitizer<DlptDrillResult[]> = (raw) =>
  Array.isArray(raw) ? arrayOf(raw, dlptDrillResult) : undefined;

function errorLogEntry(raw: unknown): ErrorLogEntry | undefined {
  if (!isRecord(raw)) return undefined;
  const id = reqStr(raw.id);
  const summary = reqStr(raw.summary);
  if (!id || !summary) return undefined;
  const lang = language(raw.language);
  const entry: ErrorLogEntry = {
    id,
    createdAt: isoDate(raw.createdAt),
    source: oneOf(raw.source, ['gist', 'dlpt', 'opi', 'roleplay', 'talk'] as const, 'gist'),
    category: oneOf(
      raw.category,
      ['addition', 'omission', 'distortion', 'dlpt_trap', 'speaking_gap'] as const,
      'addition'
    ),
    severity: oneOf(raw.severity, ['high', 'medium', 'low'] as const, 'medium'),
    language: lang,
    dialect: dialectFor(lang, raw.dialect),
    summary,
  };
  if (typeof raw.briefId === 'string' && raw.briefId.trim()) entry.briefId = raw.briefId.trim();
  if (typeof raw.learnerSpan === 'string' && raw.learnerSpan.trim()) entry.learnerSpan = raw.learnerSpan.trim();
  if (typeof raw.sourceQuote === 'string' && raw.sourceQuote.trim()) entry.sourceQuote = raw.sourceQuote.trim();
  return entry;
}

export const sanitizeErrorLogEntries: Sanitizer<ErrorLogEntry[]> = (raw) =>
  Array.isArray(raw) ? arrayOf(raw, errorLogEntry) : undefined;

const ERROR_EVENT_SOURCES: readonly ErrorEventSource[] = ['opi', 'redo', 'roleplay', 'talk', 'interp', 'dlpt', 'gist'];

function errorEvent(raw: unknown): ErrorEvent | undefined {
  if (!isRecord(raw)) return undefined;
  const id = reqStr(raw.id);
  const lang = language(raw.language);
  const key = normalizeErrorTaxonomyKey(raw.key, lang);
  if (!id || !key) return undefined;
  const wrong = str(raw.wrong).trim();
  const fix = str(raw.fix).trim();
  if (!wrong && !fix) return undefined;

  const ev: ErrorEvent = {
    id,
    key,
    source: oneOf(raw.source, ERROR_EVENT_SOURCES, 'opi'),
    sessionId: reqStr(raw.sessionId) ?? id,
    wrong: wrong || fix,
    fix,
    language: lang,
    at: isoDate(raw.at, new Date().toISOString()),
  };
  if (typeof raw.quote === 'string' && raw.quote.trim()) {
    ev.quote = raw.quote.trim();
  }
  return ev;
}

export const sanitizeErrorEvents: Sanitizer<ErrorEvent[]> = (raw) =>
  Array.isArray(raw) ? pruneErrorEvents(arrayOf(raw, errorEvent)) : undefined;

const PLAN_COMPLETION_KEY_REGEX = /^\d{4}-\d{2}-\d{2}:(es|pt)$/;

export const sanitizeTodayPlanCompletion: Sanitizer<TodayPlanCompletionStore> = (raw) => {
  if (!isRecord(raw)) return undefined;
  const entries = Object.entries(raw)
    .filter(([k]) => PLAN_COMPLETION_KEY_REGEX.test(k))
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 60);
  const out: TodayPlanCompletionStore = {};
  for (const [key, val] of entries) {
    if (!isRecord(val)) continue;
    const day: TodayPlanDayCompletion = {};
    if (val.vocab === true) day.vocab = true;
    if (val.brief === true) day.brief = true;
    if (val.speaking === true) day.speaking = true;
    out[key] = day;
  }
  return out;
};
