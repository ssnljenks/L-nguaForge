export type IlrBaseLevel = 1 | 2 | 3;

export type IlrLevel1FunctionKey =
  | 'l1_simple_qa'
  | 'l1_main_ideas'
  | 'l1_courtesy'
  | 'l1_creating_language'
  | 'l1_daily_travel_questions'
  | 'l1_short_conversations';

export type IlrLevel2FunctionKey =
  | 'l2_facts'
  | 'l2_casual_conversation'
  | 'l2_instructions_directions'
  | 'l2_concrete_descriptions'
  | 'l2_narration_timeframes'
  | 'l2_resolve_complication';

export type IlrLevel3FunctionKey =
  | 'l3_infer'
  | 'l3_detect_overtones'
  | 'l3_describe_explain_detail'
  | 'l3_hypothesize'
  | 'l3_support_opinions'
  | 'l3_unfamiliar_abstract';

export type IlrFunctionKey = IlrLevel1FunctionKey | IlrLevel2FunctionKey | IlrLevel3FunctionKey;

export interface IlrLevelFunctionSpec {
  functionKey: IlrFunctionKey;
  label: string;
  description: string;
  probePromptHint: string;
}

export interface IlrSpeakingLevelDescriptor {
  level: IlrBaseLevel;
  name: string;
  topics: readonly string[];
  functions: readonly IlrLevelFunctionSpec[];
  accuracy: readonly string[];
}

export const ILR_SPEAKING_LEVELS: readonly IlrSpeakingLevelDescriptor[] = [
  {
    level: 1,
    name: 'Elementary',
    topics: [
      'personal welfare and survival day to day',
      'basic needs (meals, lodging, transportation, simple directions)',
      'simple daily life and routine travel arrangements',
      'requests for services (ordering a simple meal, renting a hotel room)',
    ],
    functions: [
      {
        functionKey: 'l1_simple_qa',
        label: 'Simple Q&A',
        description: 'simple questions and answers face to face',
        probePromptHint: 'Ask a direct, simple question about daily routines or basic personal needs.',
      },
      {
        functionKey: 'l1_main_ideas',
        label: 'Main ideas',
        description: 'main ideas',
        probePromptHint: 'Ask the candidate to convey the core point of a simple everyday situation.',
      },
      {
        functionKey: 'l1_courtesy',
        label: 'Ordinary courtesy',
        description: 'ordinary courtesy requirements',
        probePromptHint: 'Engage polite greetings, thanks, or basic service requests.',
      },
      {
        functionKey: 'l1_creating_language',
        label: 'Creating with language',
        description: 'creating with the language',
        probePromptHint:
          'Prompt the candidate to combine known words into original simple sentences rather than memorized phrases.',
      },
      {
        functionKey: 'l1_daily_travel_questions',
        label: 'Daily life & travel Qs',
        description: 'questions about daily life and routine travel',
        probePromptHint:
          'Invite the candidate to ask or answer simple questions about schedules, transit, meals, or lodging.',
      },
      {
        functionKey: 'l1_short_conversations',
        label: 'Short conversations',
        description: 'short conversations',
        probePromptHint: 'Keep a brief back-and-forth exchange going on familiar everyday errands.',
      },
    ],
    accuracy: [
      'needs repetition, rewording, slower speech',
      'strong native-language interference',
      'errors in simple structures',
      'limited vocabulary',
      'poor pronunciation but some stress/intonation distinction',
      'intelligible to natives USED TO non-native speakers',
      'interlanguage may dominate',
      'little precision',
    ],
  },
  {
    level: 2,
    name: 'Limited Working Proficiency',
    topics: [
      'personal background and interests',
      'current events',
      'concrete topics',
      'family',
      'work (in everyday terms: what your day looks like, not technical)',
      'travel',
    ],
    functions: [
      {
        functionKey: 'l2_facts',
        label: 'Concrete facts',
        description: 'facts (not between or beyond the lines)',
        probePromptHint: 'Ask for straightforward factual details about an event, routine, or news item.',
      },
      {
        functionKey: 'l2_casual_conversation',
        label: 'Casual conversation',
        description: 'casual conversation',
        probePromptHint: 'Hold an informal, natural exchange about interests, family, or everyday life.',
      },
      {
        functionKey: 'l2_instructions_directions',
        label: 'Instructions & directions',
        description: 'instructions and directions',
        probePromptHint: 'Ask the candidate to give clear step-by-step instructions or directions.',
      },
      {
        functionKey: 'l2_concrete_descriptions',
        label: 'Concrete descriptions',
        description: 'concrete descriptions of people, places and things',
        probePromptHint: 'Ask for a vivid concrete description of a place, person, or everyday workplace.',
      },
      {
        functionKey: 'l2_narration_timeframes',
        label: 'Past, present & future narration',
        description: 'narration in past, present and future',
        probePromptHint: 'Ask for a connected story across past experience, current routine, or upcoming plans.',
      },
      {
        functionKey: 'l2_resolve_complication',
        label: 'Resolve a complication',
        description: 'resolving a familiar situation with a complication',
        probePromptHint:
          'Introduce a practical hiccup (missed connection, billing mix-up, schedule change) and ask how to solve it.',
      },
    ],
    accuracy: [
      'understands and is understood by natives NOT used to non-native speakers',
      'still some repetition and rewording',
      'sometimes miscommunicates',
    ],
  },
  {
    level: 3,
    name: 'General Professional Proficiency',
    topics: [
      'social, economic, cultural, scientific and global issues',
      'professional reports and meetings',
      'particular interests',
      'special fields of competence (candidate-led only)',
    ],
    functions: [
      {
        functionKey: 'l3_infer',
        label: 'Infer',
        description: 'infer',
        probePromptHint:
          'Ask the candidate to read between the lines of a public trend, policy shift, or social behavior.',
      },
      {
        functionKey: 'l3_detect_overtones',
        label: 'Detect overtones',
        description: 'detect emotional overtones',
        probePromptHint: 'Ask about implicit motives, tone, public sentiment, or unspoken tensions in a dilemma.',
      },
      {
        functionKey: 'l3_describe_explain_detail',
        label: 'Describe & explain in detail',
        description: 'describe and explain in detail',
        probePromptHint:
          'Request an extended, structured explanation with precise cause-and-effect and formal connectors.',
      },
      {
        functionKey: 'l3_hypothesize',
        label: 'Hypothesize',
        description: 'hypothesize',
        probePromptHint:
          'Pose a counterfactual or future what-if scenario eliciting subjunctive and conditional clauses.',
      },
      {
        functionKey: 'l3_support_opinions',
        label: 'Give & support opinions',
        description: 'give and support opinions',
        probePromptHint:
          'Ask for a clear stance on an issue, backed by structured arguments and response to a counterpoint.',
      },
      {
        functionKey: 'l3_unfamiliar_abstract',
        label: 'Unfamiliar & abstract topics',
        description: 'handle unfamiliar and abstract topics',
        probePromptHint:
          'Introduce an abstract economic, cultural, scientific, or ethical topic outside everyday personal routine.',
      },
    ],
    accuracy: [
      'rarely needs paraphrase',
      'some low-frequency structures',
      'control of complex structure',
      'natives rarely need repetition',
      'appears to be "thinking" in the language',
    ],
  },
] as const;

export const ALL_ILR_FUNCTIONS: readonly (IlrLevelFunctionSpec & {level: IlrBaseLevel})[] = ILR_SPEAKING_LEVELS.flatMap(
  (desc) => desc.functions.map((fn) => ({...fn, level: desc.level}))
);

export const ALL_ILR_FUNCTION_KEYS: readonly IlrFunctionKey[] = ALL_ILR_FUNCTIONS.map((f) => f.functionKey);

export function getIlrLevelDescriptor(level: IlrBaseLevel): IlrSpeakingLevelDescriptor {
  return ILR_SPEAKING_LEVELS.find((d) => d.level === level) ?? ILR_SPEAKING_LEVELS[1];
}

export function getFunctionsForLevel(level: IlrBaseLevel): readonly IlrLevelFunctionSpec[] {
  return getIlrLevelDescriptor(level).functions;
}

export function isIlrFunctionKey(value: unknown): value is IlrFunctionKey {
  return typeof value === 'string' && (ALL_ILR_FUNCTION_KEYS as readonly string[]).includes(value);
}

export function getFunctionSpec(key: unknown): (IlrLevelFunctionSpec & {level: IlrBaseLevel}) | undefined {
  return ALL_ILR_FUNCTIONS.find((f) => f.functionKey === key);
}

export function getFunctionLevel(key: IlrFunctionKey): IlrBaseLevel {
  if (key.startsWith('l1_')) return 1;
  if (key.startsWith('l2_')) return 2;
  return 3;
}

export function getAccuracyDescriptors(level: IlrBaseLevel): readonly string[] {
  return getIlrLevelDescriptor(level).accuracy;
}
