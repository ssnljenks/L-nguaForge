import type {ErrorTaxonomyKey, ReportedErrorItem} from './data/errorTaxonomy.ts';
import type {IlrBaseLevel, IlrFunctionKey} from './data/ilrSpeakingLevels.ts';

export type {ErrorTaxonomyKey, ReportedErrorItem};

export type TargetLanguage = 'es' | 'pt';

export type MilitaryDomain =
  'general_policy' | 'maritime_surveillance' | 'aviation_logistics' | 'c2_comms' | 'delegation_hosting';

export type OpiWorkingLevel = IlrBaseLevel; // 1 | 2 | 3
export type OpiProbeLevel = 2 | 3;
export type OpiFocusLevel = 'adaptive' | 1 | 2 | 3;

export type OpiCallMode = 'exam' | 'practice';

export type OpiTopicSource = 'examiner_choice' | 'brief';

export type OpiPhase = 'warmup' | 'level_check' | 'probe' | 'roleplay' | 'wind_down';

export type TurnOutcome = 'sustained' | 'partial' | 'breakdown';

export type IlrFunctionRating = 'met' | 'partly' | 'not_met';

export type IlrDisplayRating = '0+' | '1' | '1+' | '2' | '2+' | '3';

export interface TurnAssessment {
  functionKey: IlrFunctionKey;
  outcome: TurnOutcome;
  evidence: string;
  phase?: OpiPhase;
  targetLevel?: IlrBaseLevel;
}

export interface IlrFunctionCheck {
  functionKey: IlrFunctionKey;
  label: string;
  status: IlrFunctionRating;
  note: string;
  evidence?: string[];
}

export interface CeilingMoment {
  timestampSeconds: number;
  examinerPrompt: string;
  candidateUtterance: string;
  problemSpan: string;
  fix: string;
  failedFunction: IlrFunctionKey;
  failedFunctionLabel: string;
  explanation: string;
}

export interface DebriefAutoVocab {
  term: string;
  englishConcept: string;
  contextSentence: string;
  registerTag: string;
  category: VocabCategory;
}

export interface RedoTurnEvaluation {
  improved: boolean;
  verdictLabel: string;
  comparisonSummary: string;
  strengths: string[];
  remainingGap: string;
  upgradedModelAnswer: string;
  errors?: ReportedErrorItem[];
}

export interface OpiRedoRecord {
  examinerPrompt: string;
  redoAnswer: string;
  evaluation: RedoTurnEvaluation;
  completedAt: string;
}

export interface OpiAccuracyNote {
  descriptor: string;
  observation: string;
  status: 'strength' | 'watch' | 'gap';
}

export type VocabCategory =
  'High-Register Connectors' | 'Operational/Military Terms' | 'Regional Idioms' | 'False Friends';

export type VocabSource = 'talk' | 'opi' | 'brief' | 'manual';

export type TalkVocabKind = 'word' | 'phrase' | 'pattern';

export type TalkCorrectionMode = 'recast' | 'end_only' | 'off';

export type ModuleTab = 'today' | 'talk' | 'test_prep' | 'brief' | 'vocab';

export type GeminiLiveVoice = 'Zephyr' | 'Puck' | 'Kore' | 'Fenrir' | 'Charon';

export type IlrGoalLevel = '1' | '1+' | '2' | '2+' | '3' | '3+';

export interface IlrGoals {
  listening: IlrGoalLevel;
  reading: IlrGoalLevel;
  speaking: IlrGoalLevel;
}

export interface MissionConfig {
  language: TargetLanguage;
  dialect: string;
  domain: MilitaryDomain;
  workFocusEnabled: boolean;
  workFocus?: boolean;
  speechRate: number;
  autoSpeakExaminer: boolean;
  handsFreeMode: boolean;
  voiceURI: string;
  liveVoice: GeminiLiveVoice;
  ilrGoals?: IlrGoals;
  /** Optional YYYY-MM-DD DLPT/OPI test date. */
  testDate?: string;
}

export type TodayPlanStepId = 'vocab' | 'brief' | 'speaking';

export type TodayPlanDayCompletion = Partial<Record<TodayPlanStepId, boolean>>;

export type TodayPlanCompletionStore = Record<string, TodayPlanDayCompletion>;

export type RoleplayRegister = 'usted' | 'tú' | 'vos' | 'você' | 'tu';

export interface RoleplayScenarioPublic {
  scenarioId: string;
  level: IlrBaseLevel;
  language: TargetLanguage;
  dialect: string;
  situationEnglish: string;
  learnerGoal: string;
  register: RoleplayRegister;
  characterRole: string;
}

export interface RoleplayChecklistItem {
  itemKey: string;
  label: string;
  functionKey: IlrFunctionKey;
  status: IlrFunctionRating;
  evidence: string;
}

export interface RoleplayDebriefResult {
  scenarioId: string;
  level: IlrBaseLevel;
  situationEnglish: string;
  learnerGoal: string;
  characterRole: string;
  register: RoleplayRegister;
  hiddenGoal: string;
  complication: string;
  checklist: RoleplayChecklistItem[];
  summary: string;
  resolvedOutcome: 'resolved' | 'partial' | 'unresolved';
  generatedAt: string;
  errors?: ReportedErrorItem[];
}

export interface OpiMessage {
  id: string;
  role: 'examiner' | 'candidate';
  text: string;
  timestamp: string;
  elapsedSeconds?: number;
  workingLevel: OpiWorkingLevel;
  probeLevel: OpiProbeLevel;
  phase: OpiPhase;
  targetFunctionKey?: IlrFunctionKey;
  assessment?: TurnAssessment;
  probeReason?: string;
}

export interface OpiSession {
  id: string;
  type: 'opi' | 'prep_monologue' | 'roleplay';
  language: TargetLanguage;
  dialect: string;
  /** Optional for general OPI / role-play sessions; used by domain-focused modules like PREP/Interp. */
  domain?: MilitaryDomain;
  mode?: OpiCallMode;
  focusLevel?: OpiFocusLevel;
  includeRoleplay?: boolean;
  topicSource?: OpiTopicSource;
  targetFunctionKey?: IlrFunctionKey;
  durationTargetSeconds?: number;
  hasLocalAudio?: boolean;
  startedAt: string;
  durationSeconds: number;
  messages: OpiMessage[];
  assessments?: TurnAssessment[];
  debrief?: DebriefReport;
  redoRecord?: OpiRedoRecord;
  prepPrompt?: string;
  roleplayScenario?: RoleplayScenarioPublic;
  roleplayDebrief?: RoleplayDebriefResult;
  briefStory?: {
    id: string;
    title: string;
    summary: string;
    orientationLine?: string;
    topic?: string;
  };
}

export interface WordLookupResult {
  word: string;
  contextualMeaning: string;
  registerTag: string;
  grammarNote: string;
  suggestedCategory: VocabCategory;
}

export interface TotResult {
  targetPhrase: string;
  registerNote: string;
  exampleSentence: string;
  category: VocabCategory;
  alternativeFormal?: string;
}

export interface UpgradeRewrite {
  originalLevel2: string;
  upgradedLevel2Plus: string;
  connectorsUsed: string[];
  whyItUpgrades: string;
}

export interface DebriefReport {
  generatedAt: string;
  estimatedIlr: string;
  floorLevel?: 0 | 1 | 2 | 3;
  ceilingLevel?: 1 | 2 | 3 | null;
  gridLevel?: IlrBaseLevel;
  ratingNote?: string;
  oneLineRationale?: string;
  summaryAssessment: string;
  ceilingMoment?: CeilingMoment;
  levelFunctions?: IlrFunctionCheck[];
  accuracyNotes?: OpiAccuracyNote[];
  autoAddedVocab?: DebriefAutoVocab[];
  discourseAudit: {
    pointScore: number;
    reasonScore: number;
    exampleScore: number;
    pivotScore: number;
    cohesionNotes: string;
    subjunctiveControl: string;
    timeFrameStability: string;
  };
  naturalUpgrades: UpgradeRewrite[];
  nextDrillRecommendation: string;
  errors?: ReportedErrorItem[];
}

export type VocabFsrsRating = 'again' | 'hard' | 'good' | 'easy';

export interface VocabFsrsState {
  dueAt: string;
  lastReviewAt: string | null;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  learningStep: number;
  reps: number;
  lapses: number;
  state: 'new' | 'learning' | 'review' | 'relearning';
}

export interface VocabItem {
  id: string;
  term: string;
  englishConcept: string;
  contextSentence: string;
  registerTag: string;
  category: VocabCategory;
  language: TargetLanguage;
  dialect: string;
  domain?: MilitaryDomain;
  source?: VocabSource;
  regionTag?: string;
  kind?: TalkVocabKind;
  createdAt: string;
  mastery: 'new' | 'practicing' | 'mastered';
  reviewCount: number;
  fsrs?: VocabFsrsState;
}

export interface PrepPhase {
  id: 'point' | 'reason' | 'example' | 'pivot';
  label: string;
  startSec: number;
  endSec: number;
  guidance: string;
}

export interface PrepPromptItem {
  id: string;
  language: TargetLanguage;
  domain: MilitaryDomain;
  promptTarget: string;
  promptEnglish: string;
  recommendedConnectors: string[];
}

export interface PrepEvaluation {
  estimatedIlr: string;
  structureScore: number;
  phaseFeedback: {
    point: string;
    reason: string;
    example: string;
    pivot: string;
  };
  subjunctiveNote: string;
  upgradedConclusion: string;
}

export interface InterpBriefing {
  id: string;
  language: TargetLanguage;
  dialect: string;
  domain: MilitaryDomain;
  speakerRole: string;
  scenarioTitle: string;
  briefingText: string;
  estimatedSeconds: number;
  keyFacts: string[];
}

export interface InterpEvaluation {
  fidelityScore: number;
  registerScore: number;
  capturedPoints: string[];
  missedOrDistorted: string[];
  terminologyFeedback: string;
  modelRendition: string;
  errors?: ReportedErrorItem[];
}

export interface DrillHistoryEntry {
  id: string;
  module: 'chat' | 'opi' | 'prep' | 'interp' | 'vocab_recall' | 'roleplay' | 'brief_drill' | 'brief_gist' | 'fix_drill';
  language: TargetLanguage;
  dialect: string;
  domain: MilitaryDomain;
  completedAt: string;
  summary: string;
  scoreLabel: string;
}

export type BriefMediaType = 'text' | 'audio';

export type BriefTopic = 'society' | 'politics' | 'economy' | 'culture' | 'scitech' | 'security';

export type BriefIlrLevel = '2' | '2+' | '3' | '3+';

export interface BriefItem {
  id: string;
  title: string;
  sourceName: string;
  sourceUrl: string;
  audioUrl?: string;
  mediaType: BriefMediaType;
  language: TargetLanguage;
  dialectId: string;
  publishedAt: string;
  ilrLevel: BriefIlrLevel;
  topic: BriefTopic;
  orientationLine: string;
  summary: string;
  matchingDomains: MilitaryDomain[];
  estimatedMinutes: number;
  lengthLabel: string;
  /**
   * False when the item has no real source text to drill or grade against (e.g. a feed audio item
   * with no transcript). DLPT drills and Gist are only offered for drillable items. Absent = drillable.
   */
  drillable?: boolean;
}

export type DlptQuestionType = 'main_idea' | 'detail' | 'inference' | 'vocabulary_in_context' | 'speaker_attitude';

export type DlptTrapType =
  'mentioned_not_answer' | 'not_in_passage' | 'true_not_answer' | 'wrong_detail' | 'over_inference';

export type DlptRuleProfileId = 'dlpt5_ca' | 'dlpt5_lower_range';

export type DlptDrillMode = 'practice' | 'test';

export type DlptSkill = 'listening' | 'reading';

export type DlptEstimatedIlr = '1+' | '2' | '2+' | '3' | '3+';

export interface DlptChoiceDetail {
  label: 'A' | 'B' | 'C' | 'D';
  text: string;
  isCorrect: boolean;
  justification: string;
  trapType: DlptTrapType | null;
}

export interface BriefDrillQuestion {
  id: string;
  question: string;
  questionEnglish?: string;
  questionType?: DlptQuestionType;
  options: string[];
  correctIndex: number;
  choices?: DlptChoiceDetail[];
  sourceQuote?: string;
  explanation: string;
  rationaleEnglish?: string;
  targetVocabulary?: Array<{term: string; english: string}>;
}

export interface BriefDrill {
  briefId: string;
  title: string;
  orientationLine: string;
  language?: TargetLanguage;
  dialectId?: string;
  targetIlrLevel?: BriefIlrLevel;
  ilrLevel?: BriefIlrLevel;
  mediaType?: BriefMediaType;
  sourceName?: string;
  sourceUrl?: string;
  audioUrl?: string;
  questions: BriefDrillQuestion[];
  keyVocabulary?: Array<{term: string; meaning: string}>;
  studyExcerpt?: string;
}

export interface DlptQuestionOutcome {
  questionId: string;
  briefId: string;
  ilrLevel: BriefIlrLevel;
  questionType: DlptQuestionType;
  correct: boolean;
  answered: boolean;
  trapType?: DlptTrapType;
}

export interface DlptDrillResult {
  id: string;
  completedAt: string;
  language: TargetLanguage;
  dialect: string;
  skill: DlptSkill;
  mode: DlptDrillMode;
  profileId: DlptRuleProfileId;
  passageIds: string[];
  passageLevels: BriefIlrLevel[];
  totalQuestions: number;
  correctCount: number;
  outcomes: DlptQuestionOutcome[];
  trapsMissed: Partial<Record<DlptTrapType, number>>;
}

export type GistMainPointRating = 'captured' | 'partial' | 'missed';

export interface GistFinding {
  description: string;
  sourceQuote: string;
  /** Exact span from the learner's summary (used to highlight additions/distortions). */
  learnerSpan?: string;
}

export interface GistGradeResult {
  briefId: string;
  mainPoint: GistMainPointRating;
  keyDetails: {
    found: number;
    total: number;
    missing: string[];
  };
  additions: GistFinding[];
  omissions: GistFinding[];
  distortions: GistFinding[];
  modelGist: string;
  studyExcerpt?: string;
  errors?: ReportedErrorItem[];
}

export type ErrorEventSource = 'opi' | 'redo' | 'roleplay' | 'talk' | 'interp' | 'dlpt' | 'gist';

export interface ErrorEvent {
  id: string;
  key: ErrorTaxonomyKey;
  source: ErrorEventSource;
  sessionId: string;
  wrong: string;
  fix: string;
  quote?: string;
  language: TargetLanguage;
  at: string;
}

export type AppendErrorEventsFn = (events: Array<Omit<ErrorEvent, 'id' | 'at'> & {at?: string}>) => void;

export interface FixPromptItem {
  id: string;
  promptTarget: string;
  promptEnglishHint: string;
  targetStructureHint: string;
}

export interface FixDrillPayload {
  errorKey: ErrorTaxonomyKey;
  label: string;
  explanation: string;
  language: TargetLanguage;
  dialect: string;
  prompts: FixPromptItem[];
}

export interface FixGradeResult {
  passed: boolean;
  matchedSpan: string;
  feedback: string;
  correction?: string;
}

export type ErrorLogSource = 'gist' | 'dlpt' | 'opi' | 'roleplay' | 'talk';

export type ErrorLogCategory = 'addition' | 'omission' | 'distortion' | 'dlpt_trap' | 'speaking_gap';

export type ErrorLogSeverity = 'high' | 'medium' | 'low';

export interface ErrorLogEntry {
  id: string;
  createdAt: string;
  source: ErrorLogSource;
  category: ErrorLogCategory;
  severity: ErrorLogSeverity;
  language: TargetLanguage;
  dialect: string;
  briefId?: string;
  summary: string;
  learnerSpan?: string;
  sourceQuote?: string;
}

export type RecordErrorLogFn = (entries: Array<Omit<ErrorLogEntry, 'id' | 'createdAt'>>) => void;

export type ChatRegisterMode = 'everyday' | 'professional' | 'debate';

export interface ChatStruggleSuggestion {
  targetPhrase: string;
  englishConcept: string;
  contextSentence: string;
  reasonTag: string;
  note: string;
  suggestedCategory: VocabCategory;
}

export interface TalkPickedUpItem {
  term: string;
  meaning: string;
  regionTag: string;
  example?: string;
  kind?: TalkVocabKind;
}

export interface TalkHowDoLocalsSayOption {
  expression: string;
  literalOrContext: string;
  nuance: string;
  example: string;
  kind: TalkVocabKind;
}

export interface TalkWrapUpItem {
  term: string;
  meaning: string;
  exampleFromConversation: string;
  regionTag: string;
  kind: TalkVocabKind;
}

export interface TalkWrapUpResponse {
  summary: string;
  endNotes: string[];
  items: TalkWrapUpItem[];
  errors?: ReportedErrorItem[];
}

export interface FreeChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  struggleSuggestions?: ChatStruggleSuggestion[];
  recastNote?: string;
  pickedUp?: TalkPickedUpItem[];
}

export interface FreeChatThread {
  id: string;
  title: string;
  language: TargetLanguage;
  dialect: string;
  registerMode: ChatRegisterMode;
  updatedAt: string;
  messages: FreeChatMessage[];
  savedTerms: string[];
  tutorId?: string;
  sceneId?: string;
  workTalk?: boolean;
  domain?: MilitaryDomain;
  slangLevel?: number;
  correctionMode?: TalkCorrectionMode;
  pickedUp?: TalkPickedUpItem[];
  recastNotes?: string[];
}
