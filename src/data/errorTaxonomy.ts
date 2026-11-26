import {ALL_ILR_FUNCTIONS, type IlrBaseLevel, type IlrFunctionKey} from './ilrSpeakingLevels.ts';

export type ErrorTaxonomyCategory = 'grammar' | 'dlpt_trap' | 'gist' | 'register' | 'opi_function';

export type ErrorTaxonomyLanguage = 'es' | 'pt' | 'both';

export type ErrorSkillArea = 'speaking' | 'listening' | 'reading' | 'gist';

export type GrammarErrorKey =
  | 'si_clause_present_for_subjunctive'
  | 'por_para'
  | 'ser_estar'
  | 'preterite_imperfect'
  | 'gender_agreement'
  | 'subjunctive_triggers'
  | 'direct_indirect_pronouns'
  | 'futuro_do_subjuntivo'
  | 'preterito_perfeito_imperfeito'
  | 'personal_infinitive'
  | 'regencia_preposicoes'
  | 'colocacao_pronominal';

export type DlptTrapErrorKey =
  'mentioned_not_answer' | 'not_in_passage' | 'true_not_answer' | 'wrong_detail' | 'over_inference';

export type GistErrorKey = 'addition' | 'omission' | 'distortion';

export type RegisterErrorKey = 'tu_for_usted' | 'tu_for_vos' | 'voce_for_tu_eu';

export type OpiFunctionErrorKey =
  | 'simple_qa'
  | 'main_ideas'
  | 'courtesy'
  | 'creating_language'
  | 'daily_travel_questions'
  | 'short_conversations'
  | 'concrete_facts'
  | 'casual_conversation'
  | 'instructions_directions'
  | 'concrete_descriptions'
  | 'narrate_past'
  | 'resolve_complication'
  | 'infer'
  | 'detect_overtones'
  | 'describe_explain_detail'
  | 'hypothesize'
  | 'support_opinions'
  | 'unfamiliar_abstract';

export type ErrorTaxonomyKey =
  GrammarErrorKey | DlptTrapErrorKey | GistErrorKey | RegisterErrorKey | OpiFunctionErrorKey;

export interface ErrorTaxonomyEntry {
  key: ErrorTaxonomyKey;
  label: string;
  explanation: string;
  language: ErrorTaxonomyLanguage;
  ilrLevel: IlrBaseLevel;
  skill: ErrorSkillArea;
  category: ErrorTaxonomyCategory;
  ilrFunctionKey?: IlrFunctionKey;
  fixFocusHint: string;
}

export interface ReportedErrorItem {
  key: ErrorTaxonomyKey;
  wrong: string;
  fix: string;
  quote: string;
}

const GRAMMAR_ENTRIES: readonly ErrorTaxonomyEntry[] = [
  {
    key: 'si_clause_present_for_subjunctive',
    label: 'Si-clause subjunctive & conditional',
    explanation:
      'Used present indicative instead of imperfect subjunctive + conditional in counterfactual "si" clauses.',
    language: 'es',
    ilrLevel: 3,
    skill: 'speaking',
    category: 'grammar',
    fixFocusHint:
      'Use "si + imperfect subjunctive (-ra/-se), conditional (-ría)" for contrary-to-fact or hypothetical outcomes.',
  },
  {
    key: 'por_para',
    label: 'Por vs. Para',
    explanation: 'Confused cause, duration, or exchange (por) with destination, deadline, or purpose (para).',
    language: 'both',
    ilrLevel: 2,
    skill: 'speaking',
    category: 'grammar',
    fixFocusHint: 'Use "por" for cause, duration, route, or exchange; use "para" for recipient, goal, or deadline.',
  },
  {
    key: 'ser_estar',
    label: 'Ser vs. Estar',
    explanation:
      'Mixed inherent traits, identity, or event locations (ser) with temporary states or physical positions (estar).',
    language: 'both',
    ilrLevel: 1,
    skill: 'speaking',
    category: 'grammar',
    fixFocusHint:
      'Choose "ser" for identity, origin, time, and event venues; "estar" for location and changeable states.',
  },
  {
    key: 'preterite_imperfect',
    label: 'Preterite vs. Imperfect',
    explanation:
      'Blurred completed past actions (preterite) with background description or ongoing past habits (imperfect).',
    language: 'es',
    ilrLevel: 2,
    skill: 'speaking',
    category: 'grammar',
    fixFocusHint: 'Pair background context in imperfect (-aba/-ía) with interrupting or completed events in preterite.',
  },
  {
    key: 'gender_agreement',
    label: 'Gender & number agreement',
    explanation: 'Article, noun, or adjective did not match in grammatical gender or plural number.',
    language: 'both',
    ilrLevel: 1,
    skill: 'speaking',
    category: 'grammar',
    fixFocusHint: 'Keep articles, adjectives, and past participles aligned with the noun gender and number.',
  },
  {
    key: 'subjunctive_triggers',
    label: 'Subjunctive after triggers',
    explanation:
      'Dropped the subjunctive after doubt, recommendation, emotion, or conjunctions like "para que" / "antes de que".',
    language: 'es',
    ilrLevel: 3,
    skill: 'speaking',
    category: 'grammar',
    fixFocusHint:
      'Trigger present or imperfect subjunctive after verbs of influence, doubt, emotion, and purpose clauses.',
  },
  {
    key: 'direct_indirect_pronouns',
    label: 'Object pronouns (lo/la/le/se)',
    explanation:
      'Misplaced or mismatched direct and indirect object pronouns (e.g. le lo instead of se lo, or dropped clitic).',
    language: 'es',
    ilrLevel: 2,
    skill: 'speaking',
    category: 'grammar',
    fixFocusHint: 'Place indirect before direct object pronouns, changing le/les to se before lo/la/los/las.',
  },
  {
    key: 'futuro_do_subjuntivo',
    label: 'Futuro do subjuntivo',
    explanation:
      'Used present indicative instead of futuro do subjuntivo after "quando", "se", or "assim que" for future conditions.',
    language: 'pt',
    ilrLevel: 3,
    skill: 'speaking',
    category: 'grammar',
    fixFocusHint: 'Use futuro do subjuntivo (quando puder, se quiser, assim que chegar) for contingent future events.',
  },
  {
    key: 'preterito_perfeito_imperfeito',
    label: 'Pretérito perfeito vs. imperfeito',
    explanation:
      'Mixed completed past events (pretérito perfeito) with ongoing past habits or background (imperfeito).',
    language: 'pt',
    ilrLevel: 2,
    skill: 'speaking',
    category: 'grammar',
    fixFocusHint:
      'Use imperfeito for background/routine and perfeito for bounded past actions that move the story forward.',
  },
  {
    key: 'personal_infinitive',
    label: 'Infinitivo pessoal',
    explanation:
      'Missed the conjugated personal infinitive when the clause subject shifted after prepositions like "para" or "antes de".',
    language: 'pt',
    ilrLevel: 3,
    skill: 'speaking',
    category: 'grammar',
    fixFocusHint:
      'Conjugate the personal infinitive (para fazermos, antes de eles chegarem) when the subject is distinct.',
  },
  {
    key: 'regencia_preposicoes',
    label: 'Regência verbal & preposições',
    explanation:
      'Paired a verb with the wrong required preposition (e.g., gostar de, precisar de, assistir a, chegar a/em).',
    language: 'pt',
    ilrLevel: 2,
    skill: 'speaking',
    category: 'grammar',
    fixFocusHint:
      'Match each verb to its standard Portuguese preposition (gostar de, lembrar-se de, depender de, ir a).',
  },
  {
    key: 'colocacao_pronominal',
    label: 'Colocação pronominal',
    explanation:
      'Placed unstressed object pronouns (me/te/se/lhe/o) unnaturally for the target Brazilian or European register.',
    language: 'pt',
    ilrLevel: 3,
    skill: 'speaking',
    category: 'grammar',
    fixFocusHint:
      'Respect proclisis triggers (não, que, sempre, nunca) and avoid starting formal clauses with an unstressed clitic.',
  },
];

const DLPT_TRAP_ENTRIES: readonly ErrorTaxonomyEntry[] = [
  {
    key: 'mentioned_not_answer',
    label: 'Mentioned, not the answer',
    explanation: 'Picked a word or phrase heard/seen in the passage that did not actually answer the question stem.',
    language: 'both',
    ilrLevel: 2,
    skill: 'listening',
    category: 'dlpt_trap',
    fixFocusHint:
      'Verify that the recalled phrase answers the exact question stem, not just a detail mentioned nearby.',
  },
  {
    key: 'not_in_passage',
    label: 'Not in passage',
    explanation: 'Selected a plausible detail that never appeared in the audio or text.',
    language: 'both',
    ilrLevel: 2,
    skill: 'listening',
    category: 'dlpt_trap',
    fixFocusHint: 'Anchor every answer choice to explicit evidence heard or read in the passage.',
  },
  {
    key: 'true_not_answer',
    label: 'True, but off-target',
    explanation:
      'Chose a factually accurate statement from the passage that answered a different point than the question asked.',
    language: 'both',
    ilrLevel: 3,
    skill: 'reading',
    category: 'dlpt_trap',
    fixFocusHint: 'Re-read the stem focus (main cause, primary goal, speaker tone) before accepting a true statement.',
  },
  {
    key: 'wrong_detail',
    label: 'Wrong detail',
    explanation: 'Missed a flipped number, actor, polarity, or timeline inside an otherwise familiar choice.',
    language: 'both',
    ilrLevel: 2,
    skill: 'listening',
    category: 'dlpt_trap',
    fixFocusHint: 'Double-check who did what, quantities, negations, and dates before locking in an answer.',
  },
  {
    key: 'over_inference',
    label: 'Over-inference',
    explanation:
      'Stretched beyond what the speaker or author actually implied, adding an unsupported extreme conclusion.',
    language: 'both',
    ilrLevel: 3,
    skill: 'reading',
    category: 'dlpt_trap',
    fixFocusHint: 'Stay disciplined with hedging words and avoid choices that generalize beyond the speaker’s claim.',
  },
];

const GIST_ENTRIES: readonly ErrorTaxonomyEntry[] = [
  {
    key: 'addition',
    label: 'Gist addition (unsupported claim)',
    explanation: 'Included a fact, motive, or conclusion in your summary that was never stated in the source audio.',
    language: 'both',
    ilrLevel: 2,
    skill: 'gist',
    category: 'gist',
    fixFocusHint: 'Report strictly what the source states; strip out background assumptions or extra commentary.',
  },
  {
    key: 'omission',
    label: 'Gist omission (missed key fact)',
    explanation: 'Left out a central actor, outcome, number, or condition from the source clip.',
    language: 'both',
    ilrLevel: 2,
    skill: 'gist',
    category: 'gist',
    fixFocusHint: 'Capture who, what happened, key numbers/constraints, and outcome before writing the 3 sentences.',
  },
  {
    key: 'distortion',
    label: 'Gist distortion (altered fact)',
    explanation: 'Flipped or altered a concrete detail (number, actor, location, or cause) from the source audio.',
    language: 'both',
    ilrLevel: 2,
    skill: 'gist',
    category: 'gist',
    fixFocusHint: 'Verify names, numbers, and cause-effect direction against the clip before finalizing your summary.',
  },
];

const REGISTER_ENTRIES: readonly ErrorTaxonomyEntry[] = [
  {
    key: 'tu_for_usted',
    label: 'Tú instead of Usted',
    explanation: 'Used informal "tú" verbs/pronouns in a formal or polite service situation calling for "usted".',
    language: 'es',
    ilrLevel: 2,
    skill: 'speaking',
    category: 'register',
    fixFocusHint:
      'Maintain consistent "usted" verb endings, possessives (su/sus), and polite commands throughout the exchange.',
  },
  {
    key: 'tu_for_vos',
    label: 'Tú instead of Vos',
    explanation: 'Reverted to "tú" forms in a Rioplatense/voseo conversation where locals use "vos".',
    language: 'es',
    ilrLevel: 2,
    skill: 'speaking',
    category: 'register',
    fixFocusHint:
      'Use voseo stressed endings (tenés, podés, sabés, vení, decime) consistently with Rioplatense speakers.',
  },
  {
    key: 'voce_for_tu_eu',
    label: 'Register mismatch (você / o senhor / tu)',
    explanation:
      'Mixed formal and informal Portuguese address forms mid-conversation (e.g. mixing tu/você verb endings).',
    language: 'pt',
    ilrLevel: 2,
    skill: 'speaking',
    category: 'register',
    fixFocusHint:
      'Pick one address register (o senhor/a senhora, você, or European tu) and align pronouns and verb endings.',
  },
];

const OPI_KEY_BY_ILR_FUNCTION: Record<IlrFunctionKey, OpiFunctionErrorKey> = {
  l1_simple_qa: 'simple_qa',
  l1_main_ideas: 'main_ideas',
  l1_courtesy: 'courtesy',
  l1_creating_language: 'creating_language',
  l1_daily_travel_questions: 'daily_travel_questions',
  l1_short_conversations: 'short_conversations',
  l2_facts: 'concrete_facts',
  l2_casual_conversation: 'casual_conversation',
  l2_instructions_directions: 'instructions_directions',
  l2_concrete_descriptions: 'concrete_descriptions',
  l2_narration_timeframes: 'narrate_past',
  l2_resolve_complication: 'resolve_complication',
  l3_infer: 'infer',
  l3_detect_overtones: 'detect_overtones',
  l3_describe_explain_detail: 'describe_explain_detail',
  l3_hypothesize: 'hypothesize',
  l3_support_opinions: 'support_opinions',
  l3_unfamiliar_abstract: 'unfamiliar_abstract',
};

const OPI_FUNCTION_ENTRIES: readonly ErrorTaxonomyEntry[] = ALL_ILR_FUNCTIONS.map((fn) => ({
  key: OPI_KEY_BY_ILR_FUNCTION[fn.functionKey],
  label: `OPI: ${fn.label}`,
  explanation: `Broke down or retreated on ILR Level ${fn.level} function: ${fn.description}.`,
  language: 'both' as const,
  ilrLevel: fn.level,
  skill: 'speaking' as const,
  category: 'opi_function' as const,
  ilrFunctionKey: fn.functionKey,
  fixFocusHint: fn.probePromptHint,
}));

export const ERROR_TAXONOMY: readonly ErrorTaxonomyEntry[] = [
  ...GRAMMAR_ENTRIES,
  ...DLPT_TRAP_ENTRIES,
  ...GIST_ENTRIES,
  ...REGISTER_ENTRIES,
  ...OPI_FUNCTION_ENTRIES,
];

export const ERROR_TAXONOMY_MAP: Readonly<Record<ErrorTaxonomyKey, ErrorTaxonomyEntry>> = Object.fromEntries(
  ERROR_TAXONOMY.map((entry) => [entry.key, entry])
) as Readonly<Record<ErrorTaxonomyKey, ErrorTaxonomyEntry>>;

const KEY_SET = new Set<string>(ERROR_TAXONOMY.map((e) => e.key));

const KEY_ALIASES: Record<string, ErrorTaxonomyKey> = {
  // Direct aliases from ilrSpeakingLevels functionKey IDs
  ...(Object.fromEntries(Object.entries(OPI_KEY_BY_ILR_FUNCTION)) as Record<string, ErrorTaxonomyKey>),
  // Common legacy/short variants
  narration_timeframes: 'narrate_past',
  support_opinion: 'support_opinions',
  abstract_topics: 'unfamiliar_abstract',
  extended_discourse: 'describe_explain_detail',
};

/**
 * Resolves a raw key (or ILR function alias) to a canonical ErrorTaxonomyKey.
 * Returns null for any unknown key — callers MUST drop unknown keys rather than inventing one.
 */
export function normalizeErrorTaxonomyKey(rawKey: unknown, language?: 'es' | 'pt'): ErrorTaxonomyKey | null {
  if (typeof rawKey !== 'string') return null;
  const cleaned = rawKey.trim().toLowerCase();
  if (!cleaned) return null;

  let resolved: ErrorTaxonomyKey | null = null;
  if (KEY_SET.has(cleaned)) {
    resolved = cleaned as ErrorTaxonomyKey;
  } else if (cleaned in KEY_ALIASES) {
    resolved = KEY_ALIASES[cleaned];
  }

  if (!resolved) return null;

  if (language) {
    const entry = ERROR_TAXONOMY_MAP[resolved];
    if (entry.language !== 'both' && entry.language !== language) {
      return null;
    }
  }

  return resolved;
}

export function getTaxonomyEntry(key: ErrorTaxonomyKey): ErrorTaxonomyEntry {
  return ERROR_TAXONOMY_MAP[key];
}

export function getTaxonomyEntriesForLanguage(
  language: 'es' | 'pt',
  categories?: readonly ErrorTaxonomyCategory[]
): ErrorTaxonomyEntry[] {
  return ERROR_TAXONOMY.filter((entry) => {
    if (entry.language !== 'both' && entry.language !== language) return false;
    if (categories && categories.length > 0 && !categories.includes(entry.category)) return false;
    return true;
  });
}

export function formatTaxonomyKeysForPrompt(
  language: 'es' | 'pt',
  categories?: readonly ErrorTaxonomyCategory[]
): string {
  const entries = getTaxonomyEntriesForLanguage(language, categories);
  return entries.map((e) => `- "${e.key}" (L${e.ilrLevel} ${e.category}): ${e.label}`).join('\n');
}

/**
 * Strictly validates an array of model-returned errors against the fixed taxonomy.
 * Drops any unknown keys, language-mismatched keys, or empty entries.
 */
export function sanitizeReportedErrors(raw: unknown, language?: 'es' | 'pt', maxItems = 8): ReportedErrorItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ReportedErrorItem[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (out.length >= maxItems) break;
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const key = normalizeErrorTaxonomyKey(rec.key, language);
    if (!key) continue;

    const wrong = typeof rec.wrong === 'string' ? rec.wrong.trim().slice(0, 320) : '';
    const fix = typeof rec.fix === 'string' ? rec.fix.trim().slice(0, 320) : '';
    const quote = typeof rec.quote === 'string' ? rec.quote.trim().slice(0, 360) : '';
    if (!wrong && !quote) continue;

    const dedupe = `${key}|${wrong.toLowerCase()}|${fix.toLowerCase()}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    out.push({
      key,
      wrong: wrong || quote,
      fix: fix || ERROR_TAXONOMY_MAP[key].fixFocusHint,
      quote: quote || wrong,
    });
  }

  return out;
}
