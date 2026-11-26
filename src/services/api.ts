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
  TurnAssessment,
} from '../types';
import type {IlrBaseLevel} from '../data/ilrSpeakingLevels';
import {getJson, postJson} from './http';

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

  return getJson(`/api/brief/feed?${query.toString()}`, 20_000);
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
  return getJson(`/api/brief/study-excerpt?briefId=${encodeURIComponent(briefId)}`, 20_000);
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
