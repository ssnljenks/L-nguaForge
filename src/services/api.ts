import type {IlrFunctionKey} from '../data/ilrSpeakingLevels';
import type {
  BriefDrill,
  BriefItem,
  BriefMediaType,
  ChatRegisterMode,
  ChatStruggleSuggestion,
  DebriefReport,
  ErrorTaxonomyKey,
  FixDrillPayload,
  FixGradeResult,
  FreeChatMessage,
  GistGradeResult,
  InterpBriefing,
  InterpEvaluation,
  MilitaryDomain,
  OpiFocusLevel,
  OpiMessage,
  OpiPhase,
  OpiProbeLevel,
  OpiTopicSource,
  OpiWorkingLevel,
  PrepEvaluation,
  PrepPromptItem,
  RedoTurnEvaluation,
  RoleplayDebriefResult,
  RoleplayRegister,
  RoleplayScenarioPublic,
  TalkCorrectionMode,
  TalkHowDoLocalsSayOption,
  TalkPickedUpItem,
  TalkWrapUpResponse,
  TargetLanguage,
  TotResult,
  TurnAssessment,
  VocabItem,
  WordLookupResult,
} from '../types';
import type {IlrBaseLevel} from '../data/ilrSpeakingLevels';
import {
  type EnrichedTotResult,
  type EnrichedWordLookup,
  incrementApiSavedCount,
  lookupLocalTotPhrase,
  lookupLocalWord,
  normalizeLookupKey,
  saveTotToLocalCache,
  saveWordToLocalCache,
} from '../utils/localDictionary';
import {withWorkFocus} from './requestContext';

const inflightWordLookups = new Map<string, Promise<EnrichedWordLookup>>();

async function postJson<T>(url: string, body: Record<string, unknown>, timeoutMs = 45000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(withWorkFocus(body)),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timed out. Tap Retry to try again.', {cause: err});
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const rawText = await response.text();
  let data: Record<string, unknown> | null = null;
  if (rawText.trim()) {
    try {
      data = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const errMsg =
      typeof data?.error === 'string' && data.error.trim() ? data.error : `Request failed (${response.status})`;
    throw new Error(errMsg);
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Server returned an unexpected empty response. Please try again.');
  }
  return data as T;
}

export interface RequestOpiTurnResponse {
  examinerText: string;
  phase: OpiPhase;
  workingLevel: OpiWorkingLevel;
  probeLevel: OpiProbeLevel;
  targetFunctionKey: IlrFunctionKey;
  lastTurnAssessment: TurnAssessment;
  nextReason: string;
}

export async function requestOpiTurn(params: {
  language: TargetLanguage;
  dialect: string;
  phase: OpiPhase;
  workingLevel: OpiWorkingLevel;
  probeLevel: OpiProbeLevel;
  focusLevel?: OpiFocusLevel;
  includeRoleplay?: boolean;
  roleplayDone?: boolean;
  topicSource?: OpiTopicSource;
  briefStory?: BriefItem | null;
  targetFunctionKey?: IlrFunctionKey;
  assessments?: TurnAssessment[];
  elapsedSeconds: number;
  durationTargetSeconds?: number;
  candidateTurnCount?: number;
  history: Pick<OpiMessage, 'role' | 'text'>[];
  userMessage?: string;
  isOpening?: boolean;
  isRepeat?: boolean;
  lastExaminerText?: string;
}): Promise<RequestOpiTurnResponse> {
  return postJson('/api/opi/turn', params);
}

export async function gradeOpiRedoTurn(params: {
  language: TargetLanguage;
  dialect: string;
  examinerPrompt: string;
  originalAnswer: string;
  redoAnswer: string;
  failedFunction: IlrFunctionKey;
}): Promise<RedoTurnEvaluation> {
  return postJson('/api/opi/redo-turn', params);
}

export async function fetchRoleplayScenario(params: {
  language: TargetLanguage;
  dialect: string;
  level: IlrBaseLevel;
}): Promise<RoleplayScenarioPublic> {
  return postJson('/api/opi/roleplay/scenario', params);
}

export interface RequestRoleplayTurnResponse {
  characterText: string;
  stage: 'opening' | 'complication' | 'negotiation' | 'closing';
  complicationIntroduced: boolean;
  resolved: boolean;
  assessment: {
    functionKey: IlrFunctionKey;
    outcome: 'sustained' | 'partial' | 'breakdown';
    evidence: string;
  };
}

export async function requestRoleplayTurn(params: {
  scenarioId: string;
  language: TargetLanguage;
  dialect: string;
  level: IlrBaseLevel;
  situationEnglish: string;
  learnerGoal: string;
  register: RoleplayRegister;
  characterRole: string;
  candidateTurnCount: number;
  elapsedSeconds: number;
  complicationIntroduced: boolean;
  knownHiddenGoal?: string;
  knownComplication?: string;
  history: Pick<OpiMessage, 'role' | 'text'>[];
  userMessage?: string;
  isOpening?: boolean;
  isRepeat?: boolean;
  lastExaminerText?: string;
}): Promise<RequestRoleplayTurnResponse> {
  return postJson('/api/opi/roleplay/turn', params);
}

export async function gradeRoleplayDebrief(params: {
  scenarioId: string;
  language: TargetLanguage;
  dialect: string;
  level: IlrBaseLevel;
  situationEnglish: string;
  learnerGoal: string;
  register: RoleplayRegister;
  characterRole: string;
  knownHiddenGoal?: string;
  knownComplication?: string;
  messages: Pick<OpiMessage, 'role' | 'text' | 'elapsedSeconds'>[];
}): Promise<RoleplayDebriefResult> {
  return postJson('/api/opi/roleplay/debrief', params);
}

export async function lookupContextualWord(params: {
  language: TargetLanguage;
  dialect: string;
  word: string;
  contextSentence: string;
  vocabItems?: VocabItem[];
  forceAi?: boolean;
}): Promise<EnrichedWordLookup> {
  if (!params.forceAi) {
    const localHit = lookupLocalWord(params.language, params.word, params.vocabItems ?? []);
    if (localHit) {
      incrementApiSavedCount();
      return localHit;
    }
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error(
      'Offline — this term is not in the built-in military dictionary or local cache yet. Reconnect to look it up with AI.'
    );
  }

  const dedupeKey = `${params.language}:${normalizeLookupKey(params.word)}:${params.forceAi ? 'ai' : 'std'}`;
  const existing = inflightWordLookups.get(dedupeKey);
  if (existing) return existing;

  const requestPromise = (async (): Promise<EnrichedWordLookup> => {
    try {
      const result = await postJson<WordLookupResult>(
        '/api/vocab/lookup',
        {
          language: params.language,
          dialect: params.dialect,
          word: params.word,
          contextSentence: params.contextSentence,
        },
        15000
      );
      if (!result || typeof result.contextualMeaning !== 'string' || !result.contextualMeaning.trim()) {
        throw new Error('Word definition came back empty. Tap Retry to look it up again.');
      }
      saveWordToLocalCache(params.language, result, params.word);
      return {...result, source: 'ai'};
    } finally {
      inflightWordLookups.delete(dedupeKey);
    }
  })();

  inflightWordLookups.set(dedupeKey, requestPromise);
  return requestPromise;
}

export async function requestTotPhrase(params: {
  language: TargetLanguage;
  dialect: string;
  domain: MilitaryDomain;
  englishQuery: string;
  forceAi?: boolean;
}): Promise<EnrichedTotResult> {
  if (!params.forceAi) {
    const localHit = lookupLocalTotPhrase(params.language, params.englishQuery);
    if (localHit) {
      incrementApiSavedCount();
      return localHit;
    }
  }

  const res = await postJson<TotResult>(
    '/api/vocab/tot',
    {
      language: params.language,
      dialect: params.dialect,
      domain: params.domain,
      englishQuery: params.englishQuery,
    },
    15000
  );
  saveTotToLocalCache(params.language, params.englishQuery, res);
  return {...res, source: 'ai'};
}

export async function evaluateRecallSentence(params: {
  language: TargetLanguage;
  targetTerm: string;
  userSentence: string;
  domain: MilitaryDomain;
}): Promise<{isNatural: boolean; feedback: string; polishedVersion: string}> {
  return postJson('/api/vocab/evaluate-sentence', params);
}

export async function runSessionDebrief(params: {
  language: TargetLanguage;
  dialect: string;
  sessionType?: 'opi' | 'prep_monologue' | 'roleplay';
  domain?: MilitaryDomain;
  assessments?: TurnAssessment[];
  messages: Pick<OpiMessage, 'role' | 'text' | 'elapsedSeconds'>[];
}): Promise<DebriefReport> {
  return postJson('/api/debrief/analyze', params);
}

export async function generatePrepPrompt(params: {
  language: TargetLanguage;
  dialect: string;
  domain: MilitaryDomain;
}): Promise<PrepPromptItem> {
  return postJson('/api/lab/prep-prompt', params);
}

export async function gradePrepMonologue(params: {
  language: TargetLanguage;
  dialect: string;
  promptTarget: string;
  transcript: string;
  durationSeconds: number;
}): Promise<PrepEvaluation> {
  return postJson('/api/lab/grade-prep', params);
}

export async function generateInterpBriefing(params: {
  language: TargetLanguage;
  dialect: string;
  domain: MilitaryDomain;
}): Promise<InterpBriefing> {
  return postJson('/api/lab/interp-briefing', params);
}

export async function gradeInterpretation(params: {
  language: TargetLanguage;
  briefingText: string;
  candidateRendition: string;
  chunkNotes: string;
  direction: 'target_to_en' | 'en_to_target';
}): Promise<InterpEvaluation> {
  return postJson('/api/lab/grade-interp', params);
}

export async function sendFreeChatTurn(params: {
  language: TargetLanguage;
  dialect: string;
  domain?: MilitaryDomain;
  tutorId?: string;
  sceneId?: string;
  workTalk?: boolean;
  slangLevel?: number;
  correctionMode?: TalkCorrectionMode;
  registerMode?: ChatRegisterMode;
  history: Pick<FreeChatMessage, 'role' | 'text'>[];
  userMessage: string;
}): Promise<{
  replyText: string;
  recastNote?: string;
  pickedUp?: TalkPickedUpItem[];
  struggleSuggestions: ChatStruggleSuggestion[];
}> {
  return postJson('/api/chat/turn', params);
}

export async function requestHowDoLocalsSay(params: {
  language: TargetLanguage;
  dialect: string;
  tutorId?: string;
  workTalk?: boolean;
  domain?: MilitaryDomain;
  slangLevel?: number;
  englishQuery: string;
}): Promise<{
  tutorName: string;
  city: string;
  regionTag: string;
  versions: TalkHowDoLocalsSayOption[];
}> {
  return postJson('/api/talk/how-do-locals-say', params, 20000);
}

export async function requestTalkWrapUp(params: {
  language: TargetLanguage;
  dialect: string;
  tutorId?: string;
  sceneId?: string;
  workTalk?: boolean;
  domain?: MilitaryDomain;
  slangLevel?: number;
  correctionMode?: TalkCorrectionMode;
  messages: Pick<FreeChatMessage, 'role' | 'text'>[];
}): Promise<TalkWrapUpResponse> {
  return postJson('/api/talk/wrap-up', params);
}

export async function fetchBriefFeed(params: {
  language: TargetLanguage;
  mediaType: BriefMediaType;
  level?: string;
  topic?: string;
  workFilter?: boolean;
  userDomain?: MilitaryDomain;
  searchQuery?: string;
}): Promise<{items: BriefItem[]; lastRefreshedAt: string}> {
  const query = new URLSearchParams();
  query.set('language', params.language);
  query.set('mediaType', params.mediaType);
  if (params.level && params.level !== 'all') query.set('level', params.level);
  if (params.topic && params.topic !== 'all') query.set('topic', params.topic);
  if (params.workFilter) query.set('workFilter', 'true');
  if (params.userDomain) query.set('userDomain', params.userDomain);
  if (params.searchQuery) query.set('q', params.searchQuery);

  const res = await fetch(`/api/brief/feed?${query.toString()}`);
  if (!res.ok) {
    throw new Error('Failed to load Brief feed.');
  }
  return res.json();
}

export async function fetchBriefDrill(briefId: string): Promise<BriefDrill> {
  return postJson('/api/brief/drill', {briefId});
}

export async function gradeBriefGist(params: {briefId: string; summary: string}): Promise<GistGradeResult> {
  return postJson('/api/brief/grade-gist', params);
}

export async function fetchBriefStudyExcerpt(briefId: string): Promise<{
  briefId: string;
  title: string;
  orientationLine: string;
  sourceUrl: string;
  excerpt: string;
  keyVocabulary: {term: string; english: string}[];
}> {
  const res = await fetch(`/api/brief/study-excerpt?briefId=${encodeURIComponent(briefId)}`);
  if (!res.ok) {
    throw new Error('Failed to load study excerpt.');
  }
  return res.json();
}

export async function triggerBriefRefresh(): Promise<{ok: boolean; lastRefreshedAt: string; newItemsCount?: number}> {
  return postJson('/api/brief/refresh', {});
}

export async function generateFixDrill(params: {
  language: TargetLanguage;
  dialect: string;
  errorKey: ErrorTaxonomyKey;
}): Promise<FixDrillPayload> {
  return postJson('/api/fix/generate', params);
}

export async function gradeFixTurn(params: {
  language: TargetLanguage;
  dialect: string;
  errorKey: ErrorTaxonomyKey;
  promptTarget: string;
  userAnswer: string;
}): Promise<FixGradeResult> {
  return postJson('/api/fix/grade', params, 20000);
}
