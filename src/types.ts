export type TargetLanguage = 'es' | 'pt';

export type MilitaryDomain =
  | 'general_policy'
  | 'maritime_surveillance'
  | 'aviation_logistics'
  | 'c2_comms'
  | 'delegation_hosting';

export type ProbeLevel = 'level_2_baseline' | 'level_3_probe';

export type VocabCategory =
  | 'High-Register Connectors'
  | 'Operational/Military Terms'
  | 'Regional Idioms'
  | 'False Friends';

export type ModuleTab = 'chat' | 'opi' | 'debrief' | 'vault' | 'lab';

export interface MissionConfig {
  language: TargetLanguage;
  dialect: string;
  domain: MilitaryDomain;
  speechRate: number;
  autoSpeakExaminer: boolean;
  handsFreeMode: boolean;
  voiceURI: string;
}

export interface OpiMessage {
  id: string;
  role: 'examiner' | 'candidate';
  text: string;
  timestamp: string;
  probeLevel: ProbeLevel;
  probeReason?: string;
}

export interface OpiSession {
  id: string;
  type: 'opi' | 'prep_monologue';
  language: TargetLanguage;
  dialect: string;
  domain: MilitaryDomain;
  startedAt: string;
  durationSeconds: number;
  messages: OpiMessage[];
  debrief?: DebriefReport;
  prepPrompt?: string;
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
  summaryAssessment: string;
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
  domain: MilitaryDomain;
  createdAt: string;
  mastery: 'new' | 'practicing' | 'mastered';
  reviewCount: number;
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
}

export type ChatRegisterMode = 'everyday' | 'professional' | 'debate';

export interface ChatStruggleSuggestion {
  targetPhrase: string;
  englishConcept: string;
  contextSentence: string;
  reasonTag: string;
  note: string;
  suggestedCategory: VocabCategory;
}

export interface FreeChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  struggleSuggestions?: ChatStruggleSuggestion[];
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
}

export interface DrillHistoryEntry {
  id: string;
  module: 'chat' | 'opi' | 'prep' | 'interp' | 'vocab_recall';
  language: TargetLanguage;
  dialect: string;
  domain: MilitaryDomain;
  completedAt: string;
  summary: string;
  scoreLabel: string;
}
