import type {
  InterpBriefing,
  PrepPromptItem,
  TargetLanguage,
  TotResult,
  VocabCategory,
  VocabItem,
  WordLookupResult,
} from '../types';
import {MILITARY_DICT_BY_LANGUAGE, type MilitaryDictEntry} from '../data/militaryDictionary';

export type LookupSource = 'vault' | 'military_dict' | 'dictionary' | 'cache' | 'ai';

export interface EnrichedWordLookup extends WordLookupResult {
  source: LookupSource;
  matchedTerm?: string;
}

export interface EnrichedTotResult extends TotResult {
  source: 'dictionary' | 'cache' | 'ai';
}

export interface CachedWordRecord {
  result: WordLookupResult;
  cachedAt: number;
  lastAccessedAt: number;
  hits: number;
}

export interface LocalCacheStats {
  militaryCount: number;
  coreCount: number;
  cachedWordCount: number;
  cachedTotCount: number;
  apiSavedCount: number;
}

interface DictEntry {
  meaning: string;
  register: string;
  note: string;
  category: VocabCategory;
}

const LEGACY_WORD_CACHE_KEY = 'linguaforge_word_cache_v1';
const WORD_CACHE_KEY = 'linguaforge_word_cache_v2';
const TOT_CACHE_KEY = 'linguaforge_tot_cache_v1';
const LAB_CACHE_KEY = 'linguaforge_lab_cache_v1';
const API_SAVED_COUNT_KEY = 'linguaforge_api_saved_count_v1';
const MAX_CACHED_WORDS = 500;
export const API_SAVED_EVENT = 'linguaforge-api-saved';
export const WORD_CACHE_EVENT = 'linguaforge-word-cache-updated';

export function normalizeLookupKey(text: string): string {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿¡.,!?;:"'()[\]]+/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Generates deterministic morphological lookup candidates (plural -> singular,
 * feminine -> masculine adjective, regular ES/PT endings) so inflected military
 * and core words resolve offline without redundant API calls.
 */
export function getCandidateLookupKeys(language: TargetLanguage, normalizedKey: string): string[] {
  const candidates: string[] = [];
  const pushUnique = (k: string) => {
    if (k && k.length >= 2 && !candidates.includes(k)) {
      candidates.push(k);
    }
  };

  pushUnique(normalizedKey);
  if (normalizedKey.length < 4 || normalizedKey.includes(' ')) {
    return candidates;
  }

  if (language === 'es') {
    if (normalizedKey.endsWith('ces') && normalizedKey.length > 4) {
      pushUnique(`${normalizedKey.slice(0, -3)}z`);
    }
    if (normalizedKey.endsWith('es') && normalizedKey.length > 4) {
      pushUnique(normalizedKey.slice(0, -2));
    }
    if (normalizedKey.endsWith('s') && normalizedKey.length > 3) {
      const singular = normalizedKey.slice(0, -1);
      pushUnique(singular);
      if (singular.endsWith('a')) {
        pushUnique(`${singular.slice(0, -1)}o`);
      }
    }
    if (normalizedKey.endsWith('a') && normalizedKey.length > 3) {
      pushUnique(`${normalizedKey.slice(0, -1)}o`);
    }
  } else {
    // Portuguese plurals: -ões / -ães / -ãos -> -ão
    if (
      (normalizedKey.endsWith('oes') || normalizedKey.endsWith('aes') || normalizedKey.endsWith('aos')) &&
      normalizedKey.length > 4
    ) {
      pushUnique(`${normalizedKey.slice(0, -3)}ao`);
    }
    // -ais / -eis / -ois / -uis -> -al / -el / -ol / -ul
    if (
      (normalizedKey.endsWith('ais') ||
        normalizedKey.endsWith('eis') ||
        normalizedKey.endsWith('ois') ||
        normalizedKey.endsWith('uis')) &&
      normalizedKey.length > 4
    ) {
      pushUnique(`${normalizedKey.slice(0, -2)}l`);
    }
    // -ns -> -m (ordens -> ordem)
    if (normalizedKey.endsWith('ns') && normalizedKey.length > 3) {
      pushUnique(`${normalizedKey.slice(0, -2)}m`);
    }
    // -es -> strip -es (sensores -> sensor, diretrizes -> diretriz)
    if (normalizedKey.endsWith('es') && normalizedKey.length > 4) {
      pushUnique(normalizedKey.slice(0, -2));
    }
    // -s -> strip -s (fragatas -> fragata, taticas -> tatico)
    if (normalizedKey.endsWith('s') && normalizedKey.length > 3) {
      const singular = normalizedKey.slice(0, -1);
      pushUnique(singular);
      if (singular.endsWith('a')) {
        pushUnique(`${singular.slice(0, -1)}o`);
      }
    }
    if (normalizedKey.endsWith('a') && normalizedKey.length > 3) {
      pushUnique(`${normalizedKey.slice(0, -1)}o`);
    }
  }

  return candidates;
}

const ES_CORE_DICT: Record<string, DictEntry> = {
  // Greetings & conversational fillers
  hola: {
    meaning: 'hello / hi',
    register: 'Everyday / Standard',
    note: 'Standard greeting across all registers.',
    category: 'Regional Idioms',
  },
  buenos: {
    meaning: 'good (plural, as in buenos días)',
    register: 'Everyday / Standard',
    note: 'Used in standard time-of-day greetings.',
    category: 'Regional Idioms',
  },
  buenas: {
    meaning: 'good / hello (informal greeting)',
    register: 'Everyday / Standard',
    note: 'Common shorthand for buenas tardes/noches.',
    category: 'Regional Idioms',
  },
  gracias: {
    meaning: 'thank you',
    register: 'Everyday / Standard',
    note: 'Add muchas for emphasis.',
    category: 'Regional Idioms',
  },
  claro: {
    meaning: 'of course / clear / sure',
    register: 'Everyday / Conversational',
    note: 'Frequent affirmative filler ("¡Claro que sí!").',
    category: 'Regional Idioms',
  },
  vale: {
    meaning: 'okay / sounds good',
    register: 'Conversational (Spain / general)',
    note: 'Agreement marker; in LatAm "está bien" or "dale" is also common.',
    category: 'Regional Idioms',
  },
  dale: {
    meaning: 'sure / go ahead / sounds good',
    register: 'Regional Idiom (LatAm / Rioplatense)',
    note: 'Very natural affirmative conversational cue.',
    category: 'Regional Idioms',
  },
  bueno: {
    meaning: 'well / good / okay',
    register: 'Everyday / Standard',
    note: 'Often opens a conversational turn ("Bueno, pues…").',
    category: 'High-Register Connectors',
  },
  pues: {
    meaning: 'well / then / since',
    register: 'Everyday / Conversational',
    note: 'Discourse filler or causal connector depending on position.',
    category: 'High-Register Connectors',
  },

  // Core verbs & frequent conjugated forms
  empezar: {
    meaning: 'to start / to begin',
    register: 'Neutral / Standard',
    note: 'Stem-changing verb (e→ie); takes "a" before an infinitive ("empezar a hablar").',
    category: 'Operational/Military Terms',
  },
  empiece: {
    meaning: 'start / begin (subjunctive)',
    register: 'Neutral / Standard',
    note: 'Present subjunctive of empezar (z→c before e).',
    category: 'High-Register Connectors',
  },
  comenzar: {
    meaning: 'to commence / begin',
    register: 'Neutral / Formal',
    note: 'Slightly more formal synonym of empezar; takes "a" + infinitive.',
    category: 'Operational/Military Terms',
  },
  practicar: {
    meaning: 'to practice',
    register: 'Neutral / Standard',
    note: 'Omit the article before language names ("practicar español").',
    category: 'Operational/Military Terms',
  },
  practico: {
    meaning: 'I practice (or "practical")',
    register: 'Neutral / Standard',
    note: 'Present indicative 1st person of practicar; "práctico" with accent means practical.',
    category: 'Operational/Military Terms',
  },
  hablar: {
    meaning: 'to speak / to talk',
    register: 'Neutral / Standard',
    note: 'Pair with "sobre" or "de" to introduce a topic.',
    category: 'Operational/Military Terms',
  },
  hablo: {
    meaning: 'I speak / I talk',
    register: 'Neutral / Standard',
    note: '1st-person present indicative of hablar.',
    category: 'Operational/Military Terms',
  },
  charlar: {
    meaning: 'to chat / have a casual conversation',
    register: 'Everyday / Warm',
    note: 'Warmer and less formal than "conversar".',
    category: 'Regional Idioms',
  },
  conversar: {
    meaning: 'to converse / discuss',
    register: 'Neutral / Polite',
    note: 'Natural word for a sustained discussion.',
    category: 'High-Register Connectors',
  },
  ayudar: {
    meaning: 'to help / assist',
    register: 'Neutral / Standard',
    note: 'Takes "a" before a following infinitive ("ayudarte a practicar").',
    category: 'Operational/Military Terms',
  },
  ayudarte: {
    meaning: 'to help you',
    register: 'Neutral / Standard',
    note: 'Infinitive ayudar + enclitic pronoun te.',
    category: 'Operational/Military Terms',
  },
  gustar: {
    meaning: 'to please / to like',
    register: 'Neutral / Standard',
    note: 'Subject is the thing liked ("me gustaría hablar").',
    category: 'Regional Idioms',
  },
  gustaria: {
    meaning: 'would like (conditional of gustar)',
    register: 'Polite / Conversational',
    note: 'Standard polite way to ask or state preferences ("¿De qué te gustaría hablar?").',
    category: 'High-Register Connectors',
  },
  encantar: {
    meaning: 'to delight / love',
    register: 'Everyday / Warm',
    note: '"Me encantaría" means "I would love to".',
    category: 'Regional Idioms',
  },
  encantaria: {
    meaning: 'would love to (conditional)',
    register: 'Warm / Conversational',
    note: 'Polite enthusiastic response ("Me encantaría ayudarte").',
    category: 'Regional Idioms',
  },
  querer: {
    meaning: 'to want / wish',
    register: 'Neutral / Standard',
    note: 'Imperfect subjunctive "quisiera" softens requests.',
    category: 'High-Register Connectors',
  },
  quiero: {
    meaning: 'I want',
    register: 'Neutral / Standard',
    note: 'Present indicative 1st-person of querer.',
    category: 'Regional Idioms',
  },
  quiere: {
    meaning: 'wants / you (formal) want',
    register: 'Neutral / Standard',
    note: '3rd-person present indicative of querer.',
    category: 'Regional Idioms',
  },
  tener: {
    meaning: 'to have / hold',
    register: 'Neutral / Standard',
    note: 'Used in "tener que" (to have to) and "tener en mente" (to have in mind).',
    category: 'Operational/Military Terms',
  },
  tengo: {
    meaning: 'I have',
    register: 'Neutral / Standard',
    note: 'Irregular 1st-person present of tener.',
    category: 'Regional Idioms',
  },
  tienes: {
    meaning: 'you have (informal)',
    register: 'Everyday / Standard',
    note: '2nd-person singular present of tener.',
    category: 'Regional Idioms',
  },
  tiene: {
    meaning: 'has / you (formal) have',
    register: 'Neutral / Standard',
    note: '3rd-person singular present of tener.',
    category: 'Regional Idioms',
  },
  hacer: {
    meaning: 'to do / to make',
    register: 'Neutral / Standard',
    note: 'Core verb for actions and tasks ("hacer patrullaje").',
    category: 'Operational/Military Terms',
  },
  hago: {
    meaning: 'I do / I make',
    register: 'Neutral / Standard',
    note: 'Irregular 1st-person present of hacer.',
    category: 'Regional Idioms',
  },
  hace: {
    meaning: 'does / makes / ago (time)',
    register: 'Neutral / Standard',
    note: '"Hace dos días" = two days ago.',
    category: 'High-Register Connectors',
  },
  poder: {
    meaning: 'to be able to / can (noun: power)',
    register: 'Neutral / Standard',
    note: 'Use "podría" for polite hypotheticals or requests.',
    category: 'High-Register Connectors',
  },
  puedo: {
    meaning: 'I can / may I',
    register: 'Neutral / Standard',
    note: 'Present indicative 1st-person of poder.',
    category: 'Regional Idioms',
  },
  puede: {
    meaning: 'can / is able to',
    register: 'Neutral / Standard',
    note: '3rd-person singular present of poder.',
    category: 'Regional Idioms',
  },
  podria: {
    meaning: 'could / would be able to',
    register: 'Polite / Formal',
    note: 'Conditional form of poder for diplomatic framing.',
    category: 'High-Register Connectors',
  },
  ser: {
    meaning: 'to be (inherent / identity / role)',
    register: 'Neutral / Standard',
    note: 'Used for permanent traits, professions, time, and passive voice.',
    category: 'High-Register Connectors',
  },
  es: {
    meaning: 'is (from ser)',
    register: 'Neutral / Standard',
    note: '3rd-person singular present of ser.',
    category: 'High-Register Connectors',
  },
  son: {
    meaning: 'are (from ser)',
    register: 'Neutral / Standard',
    note: '3rd-person plural present of ser.',
    category: 'High-Register Connectors',
  },
  estar: {
    meaning: 'to be (state / location / ongoing)',
    register: 'Neutral / Standard',
    note: 'Used for locations, moods, and progressive tenses.',
    category: 'High-Register Connectors',
  },
  estoy: {
    meaning: 'I am (from estar)',
    register: 'Neutral / Standard',
    note: '1st-person present of estar.',
    category: 'Regional Idioms',
  },
  estas: {
    meaning: 'you are (from estar)',
    register: 'Everyday / Standard',
    note: '2nd-person singular present of estar.',
    category: 'Regional Idioms',
  },
  esta: {
    meaning: 'is / this (esta vs está)',
    register: 'Neutral / Standard',
    note: '"Está" with accent = verb; "esta" without = "this (fem.)".',
    category: 'High-Register Connectors',
  },
  ir: {
    meaning: 'to go',
    register: 'Neutral / Standard',
    note: '"Ir a + infinitive" expresses near future.',
    category: 'Regional Idioms',
  },
  voy: {
    meaning: 'I am going / I go',
    register: 'Neutral / Standard',
    note: 'Irregular 1st-person present of ir.',
    category: 'Regional Idioms',
  },
  saber: {
    meaning: 'to know (facts / how to)',
    register: 'Neutral / Standard',
    note: 'Preterite "supe" means "found out".',
    category: 'High-Register Connectors',
  },
  se: {
    meaning: 'I know / reflexive pronoun',
    register: 'Neutral / Standard',
    note: '"Sé" (accent) = I know; "se" (no accent) = reflexive/impersonal.',
    category: 'High-Register Connectors',
  },
  conocer: {
    meaning: 'to know / be familiar with / meet',
    register: 'Neutral / Standard',
    note: 'Used for people, places, and topics.',
    category: 'Operational/Military Terms',
  },
  decir: {
    meaning: 'to say / to tell',
    register: 'Neutral / Standard',
    note: '"Es decir" = that is to say (high-register clarifier).',
    category: 'High-Register Connectors',
  },
  digo: {
    meaning: 'I say / I mean',
    register: 'Neutral / Conversational',
    note: 'Irregular 1st-person present of decir.',
    category: 'Regional Idioms',
  },
  creo: {
    meaning: 'I think / I believe',
    register: 'Neutral / Standard',
    note: 'Takes indicative in affirmative, subjunctive in negative ("No creo que sea…").',
    category: 'High-Register Connectors',
  },
  pensar: {
    meaning: 'to think / plan',
    register: 'Neutral / Standard',
    note: '"Pensar en" = think about; "pensar + inf" = intend to.',
    category: 'High-Register Connectors',
  },
  entender: {
    meaning: 'to understand',
    register: 'Neutral / Standard',
    note: 'Stem-changing (e→ie); synonym of comprender.',
    category: 'High-Register Connectors',
  },
  comprender: {
    meaning: 'to comprehend / understand deeply',
    register: 'Formal / Standard',
    note: 'Slightly higher register than entender.',
    category: 'High-Register Connectors',
  },
  necesitar: {
    meaning: 'to need',
    register: 'Neutral / Standard',
    note: 'Direct transitive verb; do NOT add "de" before a noun or infinitive ("necesitar apoyo").',
    category: 'High-Register Connectors',
  },
  requerir: {
    meaning: 'to require',
    register: 'Formal / Operational',
    note: 'ILR 2+/3 upgrade for necesitar.',
    category: 'High-Register Connectors',
  },
  lograr: {
    meaning: 'to achieve / manage to',
    register: 'Formal / Operational',
    note: 'Strong ILR 2+ verb for operational outcomes.',
    category: 'Operational/Military Terms',
  },
  realizar: {
    meaning: 'to carry out / conduct (NOT "to realize")',
    register: 'Formal / False Friend',
    note: 'False friend: means "to conduct/execute", whereas "realize" = "darse cuenta de".',
    category: 'False Friends',
  },
  actualmente: {
    meaning: 'currently / at present (NOT "actually")',
    register: 'Formal / False Friend',
    note: 'False friend: means "currently"; "actually" = "en realidad / de hecho".',
    category: 'False Friends',
  },
  apoyar: {
    meaning: 'to support',
    register: 'Neutral / Operational',
    note: 'False friend trap: avoid translating "support" as soportar (to tolerate).',
    category: 'False Friends',
  },
  soportar: {
    meaning: 'to tolerate / withstand (NOT "support")',
    register: 'False Friend',
    note: 'Use "apoyar" or "respaldar" for institutional support.',
    category: 'False Friends',
  },
  exito: {
    meaning: 'success (NOT "exit")',
    register: 'Neutral / False Friend',
    note: 'Exit = "salida".',
    category: 'False Friends',
  },
  asistir: {
    meaning: 'to attend (a meeting/event) — NOT "assist"',
    register: 'Formal / False Friend',
    note: 'Takes preposition "a" ("asistir a la reunión"); assist = "ayudar / apoyar".',
    category: 'False Friends',
  },

  // Pronouns, prepositions & question words
  conmigo: {
    meaning: 'with me',
    register: 'Everyday / Standard',
    note: 'Invariable contracted form replacing "con mí".',
    category: 'Regional Idioms',
  },
  contigo: {
    meaning: 'with you (singular informal)',
    register: 'Everyday / Standard',
    note: 'Invariable contracted form replacing "con tú".',
    category: 'Regional Idioms',
  },
  para: {
    meaning: 'for / in order to / toward',
    register: 'Neutral / Standard',
    note: 'Expresses purpose, destination, recipient, or deadline.',
    category: 'High-Register Connectors',
  },
  por: {
    meaning: 'for / because of / through / by',
    register: 'Neutral / Standard',
    note: 'Expresses cause, exchange, duration, or means.',
    category: 'High-Register Connectors',
  },
  con: {
    meaning: 'with',
    register: 'Neutral / Standard',
    note: 'Common preposition ("con respecto a", "con anticipación").',
    category: 'High-Register Connectors',
  },
  sin: {
    meaning: 'without',
    register: 'Neutral / Standard',
    note: '"Sin embargo" = however.',
    category: 'High-Register Connectors',
  },
  sobre: {
    meaning: 'about / on / regarding',
    register: 'Neutral / Standard',
    note: 'Preferred over "acerca de" in concise speech.',
    category: 'High-Register Connectors',
  },
  entre: {
    meaning: 'between / among',
    register: 'Neutral / Standard',
    note: 'Used with subject pronouns ("entre tú y yo").',
    category: 'High-Register Connectors',
  },
  durante: {
    meaning: 'during / for (duration)',
    register: 'Neutral / Formal',
    note: 'Clean way to anchor past/future time frames.',
    category: 'High-Register Connectors',
  },
  segun: {
    meaning: 'according to / depending on',
    register: 'Neutral / Formal',
    note: 'Great ILR 2+ attribution marker ("Según los informes…").',
    category: 'High-Register Connectors',
  },
  mientras: {
    meaning: 'while / whereas',
    register: 'Neutral / Standard',
    note: '"Mientras tanto" = meanwhile.',
    category: 'High-Register Connectors',
  },
  como: {
    meaning: 'how / like / as / since',
    register: 'Neutral / Standard',
    note: '"Cómo" with accent asks how; without accent means as/like.',
    category: 'High-Register Connectors',
  },
  que: {
    meaning: 'what / that / which / than',
    register: 'Neutral / Standard',
    note: '"Qué" with accent = what; without accent = that/which.',
    category: 'High-Register Connectors',
  },
  cual: {
    meaning: 'which / which one',
    register: 'Neutral / Standard',
    note: '"Lo cual" refers back to an entire preceding clause.',
    category: 'High-Register Connectors',
  },
  cuando: {
    meaning: 'when',
    register: 'Neutral / Standard',
    note: 'Triggers subjunctive for future/hypothetical events ("cuando lleguemos").',
    category: 'High-Register Connectors',
  },
  donde: {
    meaning: 'where',
    register: 'Neutral / Standard',
    note: '"¿Dónde?" asks location; "adonde" indicates motion toward.',
    category: 'High-Register Connectors',
  },
  quien: {
    meaning: 'who / whom',
    register: 'Neutral / Standard',
    note: 'Plural form is "quienes".',
    category: 'High-Register Connectors',
  },
  porque: {
    meaning: 'because',
    register: 'Neutral / Standard',
    note: 'Note: "por qué" (two words, accent) = why; "el porqué" = the reason.',
    category: 'High-Register Connectors',
  },
  hoy: {
    meaning: 'today',
    register: 'Everyday / Standard',
    note: '"Hoy en día" = nowadays (ILR 2+ connector).',
    category: 'High-Register Connectors',
  },
  ayer: {
    meaning: 'yesterday',
    register: 'Everyday / Standard',
    note: 'Triggers preterite past tense.',
    category: 'High-Register Connectors',
  },
  manana: {
    meaning: 'tomorrow / morning',
    register: 'Everyday / Standard',
    note: '"Por la mañana" = in the morning.',
    category: 'Regional Idioms',
  },
  ahora: {
    meaning: 'now',
    register: 'Everyday / Standard',
    note: '"Ahora bien" = now then / however (formal pivot).',
    category: 'High-Register Connectors',
  },
  siempre: {
    meaning: 'always',
    register: 'Everyday / Standard',
    note: '"Siempre y cuando" = provided that (+ subjunctive).',
    category: 'High-Register Connectors',
  },
  nunca: {
    meaning: 'never',
    register: 'Everyday / Standard',
    note: 'Requires double negative if placed after the verb ("no voy nunca").',
    category: 'High-Register Connectors',
  },
  tambien: {
    meaning: 'also / too',
    register: 'Everyday / Standard',
    note: 'Negative counterpart is "tampoco" (neither).',
    category: 'High-Register Connectors',
  },
  todavia: {
    meaning: 'still / yet',
    register: 'Everyday / Standard',
    note: 'Temporal adverb meaning still/yet ("todavía falta confirmar").',
    category: 'High-Register Connectors',
  },
  algun: {
    meaning: 'some / any (shortened form of alguno)',
    register: 'Neutral / Standard',
    note: 'Used before masculine singular nouns ("algún tema").',
    category: 'High-Register Connectors',
  },
  alguno: {
    meaning: 'some / any',
    register: 'Neutral / Standard',
    note: 'Shortens to "algún" before masculine singular nouns.',
    category: 'High-Register Connectors',
  },
  algo: {
    meaning: 'something / somewhat',
    register: 'Everyday / Standard',
    note: 'Invariable indefinite pronoun.',
    category: 'Regional Idioms',
  },
  nada: {
    meaning: 'nothing / not at all',
    register: 'Everyday / Standard',
    note: '"De nada" = you’re welcome.',
    category: 'Regional Idioms',
  },

  // High-register connectors & common conversation nouns
  embargo: {
    meaning: 'seizure / embargo ("sin embargo" = however)',
    register: 'High-Register Connector',
    note: 'Almost always used in the fixed connector "sin embargo".',
    category: 'High-Register Connectors',
  },
  obstante: {
    meaning: 'used in "no obstante" (nevertheless / notwithstanding)',
    register: 'High-Register Connector',
    note: 'Formal ILR 2+/3 pivot equivalent to "sin embargo".',
    category: 'High-Register Connectors',
  },
  aunque: {
    meaning: 'although / even though / even if',
    register: 'High-Register Connector',
    note: 'Indicative for known facts; subjunctive for hypothetical/concessive nuance.',
    category: 'High-Register Connectors',
  },
  entonces: {
    meaning: 'then / so / therefore',
    register: 'Everyday / Standard',
    note: 'Conversational marker; in formal ILR 2+/3 turns upgrade to "por consiguiente" or "en consecuencia".',
    category: 'High-Register Connectors',
  },
  ademas: {
    meaning: 'furthermore / in addition / besides',
    register: 'High-Register Connector',
    note: 'Clean ILR 2+ additive transition.',
    category: 'High-Register Connectors',
  },
  consiguiente: {
    meaning: 'used in "por consiguiente" (consequently)',
    register: 'High-Register Connector',
    note: 'Formal causal conclusion marker.',
    category: 'High-Register Connectors',
  },
  tema: {
    meaning: 'topic / subject / issue (masculine: "el tema")',
    register: 'Neutral / Standard',
    note: 'Masculine noun despite ending in -a ("el tema", "algún tema").',
    category: 'Regional Idioms',
  },
  mente: {
    meaning: 'mind ("en mente" = in mind)',
    register: 'Neutral / Standard',
    note: 'Feminine noun ("la mente"); "tener en mente" = to have in mind.',
    category: 'Regional Idioms',
  },
  espanol: {
    meaning: 'Spanish',
    register: 'Neutral / Standard',
    note: 'Language names are not capitalized in Spanish.',
    category: 'Regional Idioms',
  },
  idioma: {
    meaning: 'language (masculine: "el idioma")',
    register: 'Neutral / Standard',
    note: 'Masculine noun despite ending in -a.',
    category: 'Regional Idioms',
  },
  tiempo: {
    meaning: 'time / weather',
    register: 'Neutral / Standard',
    note: '"A tiempo" = on time; "con el tiempo" = over time.',
    category: 'Regional Idioms',
  },
  semana: {
    meaning: 'week',
    register: 'Everyday / Standard',
    note: '"La semana pasada" / "la próxima semana".',
    category: 'Regional Idioms',
  },
  trabajo: {
    meaning: 'work / job',
    register: 'Everyday / Standard',
    note: 'Noun; "trabajar" is the verb.',
    category: 'Regional Idioms',
  },
  // Function words, articles, pronouns & common everyday modifiers
  el: {
    meaning: 'the (masculine singular)',
    register: 'Everyday / Standard',
    note: '"Él" with accent means "he"; "el" without accent is "the".',
    category: 'High-Register Connectors',
  },
  la: {
    meaning: 'the (feminine singular) / her / it',
    register: 'Everyday / Standard',
    note: 'Definite article or direct object pronoun.',
    category: 'High-Register Connectors',
  },
  los: {
    meaning: 'the (masculine plural) / them',
    register: 'Everyday / Standard',
    note: 'Definite article or direct object pronoun.',
    category: 'High-Register Connectors',
  },
  las: {
    meaning: 'the (feminine plural) / them',
    register: 'Everyday / Standard',
    note: 'Definite article or direct object pronoun.',
    category: 'High-Register Connectors',
  },
  un: {
    meaning: 'a / an (masculine singular)',
    register: 'Everyday / Standard',
    note: 'Shortened form of "uno" before masculine singular nouns.',
    category: 'High-Register Connectors',
  },
  una: {
    meaning: 'a / an / one (feminine)',
    register: 'Everyday / Standard',
    note: 'Indefinite feminine article.',
    category: 'High-Register Connectors',
  },
  de: {
    meaning: 'of / from / about',
    register: 'Everyday / Standard',
    note: 'Contracts with "el" to form "del".',
    category: 'High-Register Connectors',
  },
  del: {
    meaning: 'of the / from the (de + el)',
    register: 'Everyday / Standard',
    note: 'Mandatory contraction of "de" + "el".',
    category: 'High-Register Connectors',
  },
  al: {
    meaning: 'to the / at the (a + el)',
    register: 'Everyday / Standard',
    note: '"Al + infinitive" means "upon doing…" ("al llegar").',
    category: 'High-Register Connectors',
  },
  en: {
    meaning: 'in / on / at',
    register: 'Everyday / Standard',
    note: 'Core preposition for location, time, and states ("en marcha", "en zona").',
    category: 'High-Register Connectors',
  },
  me: {
    meaning: 'me / myself',
    register: 'Everyday / Standard',
    note: 'Object or reflexive pronoun ("me gustaría").',
    category: 'Regional Idioms',
  },
  te: {
    meaning: 'you / yourself (informal singular)',
    register: 'Everyday / Standard',
    note: 'Informal 2nd-person pronoun ("¿te gustaría?").',
    category: 'Regional Idioms',
  },
  tu: {
    meaning: 'your (no accent) / you (tú)',
    register: 'Everyday / Standard',
    note: '"Tu" = your; "tú" = you (subject pronoun).',
    category: 'Regional Idioms',
  },
  mi: {
    meaning: 'my (no accent) / me (mí after preposition)',
    register: 'Everyday / Standard',
    note: '"Mi" = my; "para mí" = for me.',
    category: 'Regional Idioms',
  },
  su: {
    meaning: 'his / her / their / your (formal)',
    register: 'Neutral / Standard',
    note: 'Possessive determiner.',
    category: 'High-Register Connectors',
  },
  pero: {
    meaning: 'but',
    register: 'Everyday / Standard',
    note: 'In formal OPI turns, vary with "sin embargo" or "no obstante".',
    category: 'High-Register Connectors',
  },
  mas: {
    meaning: 'more / most (más)',
    register: 'Neutral / Standard',
    note: 'With accent "más" = more/most; without accent "mas" is an archaic literary word for "but".',
    category: 'High-Register Connectors',
  },
  muy: {
    meaning: 'very',
    register: 'Everyday / Standard',
    note: 'Modifies adjectives and adverbs; never say "mucho" before adjectives.',
    category: 'High-Register Connectors',
  },
  mucho: {
    meaning: 'a lot / much / many',
    register: 'Everyday / Standard',
    note: 'Invariable as an adverb ("practicar mucho"); agrees as adjective ("muchos temas").',
    category: 'Regional Idioms',
  },
  bien: {
    meaning: 'well / fine / okay',
    register: 'Everyday / Standard',
    note: 'Adverb ("hablar bien"); contrast with adjective "bueno".',
    category: 'Regional Idioms',
  },
  mejor: {
    meaning: 'better / best',
    register: 'Neutral / Standard',
    note: '"A lo mejor" means "maybe / perhaps".',
    category: 'High-Register Connectors',
  },
  todo: {
    meaning: 'everything / all',
    register: 'Everyday / Standard',
    note: '"Sobre todo" = especially / above all.',
    category: 'High-Register Connectors',
  },
  todos: {
    meaning: 'all / everyone',
    register: 'Everyday / Standard',
    note: '"Todos los días" = every day.',
    category: 'Regional Idioms',
  },
  otro: {
    meaning: 'other / another',
    register: 'Everyday / Standard',
    note: '"Por otro lado" = on the other hand.',
    category: 'High-Register Connectors',
  },
  otra: {
    meaning: 'other / another (feminine)',
    register: 'Everyday / Standard',
    note: '"Otra vez" = again.',
    category: 'Regional Idioms',
  },
  dia: {
    meaning: 'day (masculine: "el día")',
    register: 'Everyday / Standard',
    note: 'Masculine noun despite ending in -a.',
    category: 'Regional Idioms',
  },
  vez: {
    meaning: 'time / occasion (plural: "veces")',
    register: 'Everyday / Standard',
    note: '"Tal vez" = perhaps (+ subjunctive).',
    category: 'High-Register Connectors',
  },
  si: {
    meaning: 'if (si) / yes (sí)',
    register: 'Neutral / Standard',
    note: '"Si" without accent triggers hypotheticals ("si fuera posible").',
    category: 'High-Register Connectors',
  },
  no: {
    meaning: 'no / not',
    register: 'Everyday / Standard',
    note: 'Placed before the conjugated verb.',
    category: 'High-Register Connectors',
  },
  deber: {
    meaning: 'should / ought to / must (noun: duty)',
    register: 'Neutral / Formal',
    note: 'Conditional "debería" gives diplomatic recommendations.',
    category: 'High-Register Connectors',
  },
  debe: {
    meaning: 'must / should (3rd person of deber)',
    register: 'Neutral / Formal',
    note: '"Debe de" expresses probability; "debe + inf" expresses obligation.',
    category: 'High-Register Connectors',
  },
  debemos: {
    meaning: 'we must / we should',
    register: 'Neutral / Operational',
    note: 'Common briefing framing verb.',
    category: 'Operational/Military Terms',
  },
  hay: {
    meaning: 'there is / there are',
    register: 'Neutral / Standard',
    note: '"Hay que + infinitive" = one must / it is necessary to.',
    category: 'High-Register Connectors',
  },
  estoy_seguro: {
    meaning: 'I am sure',
    register: 'Neutral / Standard',
    note: 'Pair with indicative ("estoy seguro de que es…").',
    category: 'High-Register Connectors',
  },
  seguridad: {
    meaning: 'security / safety',
    register: 'Operational / Diplomatic',
    note: 'Core operational/policy noun ("seguridad marítima").',
    category: 'Operational/Military Terms',
  },
  entrenamiento: {
    meaning: 'training / drill',
    register: 'Operational / Military',
    note: 'Pair with "ejercicio" or "adiestramiento" for military contexts.',
    category: 'Operational/Military Terms',
  },
  mision: {
    meaning: 'mission / assignment',
    register: 'Operational / Military',
    note: 'Accent drops in plural: "misiones".',
    category: 'Operational/Military Terms',
  },
  informe: {
    meaning: 'report / briefing / debrief',
    register: 'Formal / Operational',
    note: 'Standard term for operational or post-action reports.',
    category: 'Operational/Military Terms',
  },
  estrategia: {
    meaning: 'strategy',
    register: 'Formal / Policy',
    note: 'Adjective: "estratégico".',
    category: 'Operational/Military Terms',
  },
  cooperacion: {
    meaning: 'cooperation / partnership',
    register: 'Diplomatic / Policy',
    note: 'Common in bilateral/multilateral security contexts.',
    category: 'Operational/Military Terms',
  },
  despliegue: {
    meaning: 'deployment',
    register: 'Operational / Military',
    note: 'Verb: "desplegar".',
    category: 'Operational/Military Terms',
  },
  vigilancia: {
    meaning: 'surveillance / watch',
    register: 'Operational / Military',
    note: 'Pair with "reconocimiento" or "marítima".',
    category: 'Operational/Military Terms',
  },
};

const PT_CORE_DICT: Record<string, DictEntry> = {
  ola: {
    meaning: 'hello / hi',
    register: 'Everyday / Standard',
    note: 'Standard warm greeting in Portuguese.',
    category: 'Regional Idioms',
  },
  oi: {
    meaning: 'hi / hey',
    register: 'Informal (Brazil)',
    note: 'Very common casual Brazilian Portuguese greeting.',
    category: 'Regional Idioms',
  },
  tudo: {
    meaning: 'everything / all ("Tudo bem?" = How’s it going?)',
    register: 'Everyday / Standard',
    note: '"Tudo" is invariable; "todo/toda" modifies nouns.',
    category: 'Regional Idioms',
  },
  obrigado: {
    meaning: 'thank you (said by male speaker)',
    register: 'Everyday / Standard',
    note: 'Matches the speaker’s gender (obrigado / obrigada).',
    category: 'Regional Idioms',
  },
  obrigada: {
    meaning: 'thank you (said by female speaker)',
    register: 'Everyday / Standard',
    note: 'Matches the speaker’s gender.',
    category: 'Regional Idioms',
  },
  claro: {
    meaning: 'of course / clear / sure',
    register: 'Everyday / Standard',
    note: '"Claro que sim!" = Of course!',
    category: 'Regional Idioms',
  },
  comecar: {
    meaning: 'to start / to begin',
    register: 'Neutral / Standard',
    note: 'Takes preposition "a" before infinitives ("começar a falar").',
    category: 'Operational/Military Terms',
  },
  comeco: {
    meaning: 'I start / beginning',
    register: 'Neutral / Standard',
    note: 'With cedilla "começo" = beginning or I start.',
    category: 'Regional Idioms',
  },
  falar: {
    meaning: 'to speak / to talk',
    register: 'Neutral / Standard',
    note: '"Falar sobre" or "falar de" = talk about.',
    category: 'Operational/Military Terms',
  },
  praticar: {
    meaning: 'to practice',
    register: 'Neutral / Standard',
    note: 'Core verb for language/skill training.',
    category: 'Operational/Military Terms',
  },
  ajudar: {
    meaning: 'to help / assist',
    register: 'Neutral / Standard',
    note: 'Takes "a" before a following verb ("ajudar você a praticar").',
    category: 'Operational/Military Terms',
  },
  gostaria: {
    meaning: 'would like (conditional of gostar)',
    register: 'Polite / Conversational',
    note: 'Takes "de" before nouns ("gostaria de um café"), direct before infinitives.',
    category: 'High-Register Connectors',
  },
  quero: {
    meaning: 'I want',
    register: 'Neutral / Standard',
    note: '1st-person present indicative of querer.',
    category: 'Regional Idioms',
  },
  querer: {
    meaning: 'to want',
    register: 'Neutral / Standard',
    note: 'Use "gostaria" or "queria" to sound softer in conversation.',
    category: 'Regional Idioms',
  },
  ter: {
    meaning: 'to have',
    register: 'Neutral / Standard',
    note: 'Also used impersonally in spoken Brazilian Portuguese meaning "there is/are".',
    category: 'Operational/Military Terms',
  },
  tenho: {
    meaning: 'I have',
    register: 'Neutral / Standard',
    note: 'Irregular 1st-person present of ter.',
    category: 'Regional Idioms',
  },
  tem: {
    meaning: 'has / there is (spoken BR)',
    register: 'Everyday / Standard',
    note: 'Plural is "têm" with circumflex.',
    category: 'Regional Idioms',
  },
  fazer: {
    meaning: 'to do / to make',
    register: 'Neutral / Standard',
    note: 'Core irregular verb (eu faço); used in operational collocations ("fazer levantamento").',
    category: 'Operational/Military Terms',
  },
  faco: {
    meaning: 'I do / I make',
    register: 'Neutral / Standard',
    note: '1st-person present indicative of fazer.',
    category: 'Regional Idioms',
  },
  poder: {
    meaning: 'to be able to / can (noun: power)',
    register: 'Neutral / Standard',
    note: '"Poderia" = could (polite).',
    category: 'High-Register Connectors',
  },
  posso: {
    meaning: 'I can',
    register: 'Neutral / Standard',
    note: 'Irregular 1st-person present of poder.',
    category: 'Regional Idioms',
  },
  pode: {
    meaning: 'can / may',
    register: 'Neutral / Standard',
    note: '3rd-person singular present of poder.',
    category: 'Regional Idioms',
  },
  ser: {
    meaning: 'to be (permanent / identity)',
    register: 'Neutral / Standard',
    note: 'Future subjunctive is "for" ("se for possível").',
    category: 'High-Register Connectors',
  },
  estar: {
    meaning: 'to be (state / location)',
    register: 'Neutral / Standard',
    note: 'In casual speech often shortened to "tá / tô".',
    category: 'High-Register Connectors',
  },
  estou: {
    meaning: 'I am (from estar)',
    register: 'Neutral / Standard',
    note: '1st-person present indicative of estar.',
    category: 'Regional Idioms',
  },
  comigo: {
    meaning: 'with me',
    register: 'Everyday / Standard',
    note: 'Contracted prepositional pronoun.',
    category: 'Regional Idioms',
  },
  entao: {
    meaning: 'so / then / therefore',
    register: 'Everyday / Conversational',
    note: 'Common spoken filler; upgrade to "portanto" or "por conseguinte" in formal briefs.',
    category: 'High-Register Connectors',
  },
  mas: {
    meaning: 'but (adversative)',
    register: 'Neutral / Standard',
    note: 'Adversative conjunction; do not confuse spelling with "mais" (more).',
    category: 'High-Register Connectors',
  },
  mais: {
    meaning: 'more / plus',
    register: 'Neutral / Standard',
    note: 'Contrast with "mas" (but).',
    category: 'High-Register Connectors',
  },
  porem: {
    meaning: 'however / nevertheless',
    register: 'High-Register Connector',
    note: 'Strong formal upgrade for "mas".',
    category: 'High-Register Connectors',
  },
  embora: {
    meaning: 'although / even though (+ subjunctive)',
    register: 'High-Register Connector',
    note: 'Always triggers subjunctive ("embora seja complexo…").',
    category: 'High-Register Connectors',
  },
  todavia: {
    meaning: 'however / nevertheless',
    register: 'Formal / High-Register',
    note: 'Formal adversative connector meaning "however / nevertheless" ("ainda" means "still").',
    category: 'High-Register Connectors',
  },
  ainda: {
    meaning: 'still / yet / even',
    register: 'Neutral / Standard',
    note: '"Ainda que" = even though (+ subjunctive).',
    category: 'High-Register Connectors',
  },
  apesar: {
    meaning: 'used in "apesar de" (despite / in spite of)',
    register: 'High-Register Connector',
    note: 'Followed by noun or personal infinitive ("apesar de termos…").',
    category: 'High-Register Connectors',
  },
  portanto: {
    meaning: 'therefore / consequently',
    register: 'High-Register Connector',
    note: 'Clean ILR 2+/3 causal pivot.',
    category: 'High-Register Connectors',
  },
  enquanto: {
    meaning: 'while / whereas',
    register: 'Neutral / Standard',
    note: 'Used for simultaneous actions or contrasts.',
    category: 'High-Register Connectors',
  },
  conforme: {
    meaning: 'according to / as',
    register: 'Formal / Operational',
    note: 'Crisp diplomatic/briefing attribution word.',
    category: 'High-Register Connectors',
  },
  precisar: {
    meaning: 'to need (takes "de" before nouns)',
    register: 'Neutral / Standard',
    note: '"Precisar de apoio" = to need support.',
    category: 'Operational/Military Terms',
  },
  ficar: {
    meaning: 'to stay / remain / become',
    register: 'Neutral / Standard',
    note: 'Very versatile verb indicating state, location, or outcome ("ficar definido").',
    category: 'Regional Idioms',
  },
  hoje: {
    meaning: 'today',
    register: 'Everyday / Standard',
    note: '"Hoje em dia" = nowadays.',
    category: 'High-Register Connectors',
  },
  ontem: {
    meaning: 'yesterday',
    register: 'Everyday / Standard',
    note: 'Pairs with preterite past.',
    category: 'High-Register Connectors',
  },
  amanha: {
    meaning: 'tomorrow',
    register: 'Everyday / Standard',
    note: 'Note final nasal sound.',
    category: 'Regional Idioms',
  },
  agora: {meaning: 'now', register: 'Everyday / Standard', note: '"Por agora" = for now.', category: 'Regional Idioms'},
  sempre: {
    meaning: 'always',
    register: 'Everyday / Standard',
    note: 'Adverb placed before or after the main verb ("sempre mantemos prontidão").',
    category: 'High-Register Connectors',
  },
  nunca: {
    meaning: 'never',
    register: 'Everyday / Standard',
    note: 'Can stand before the verb without "não".',
    category: 'High-Register Connectors',
  },
  tambem: {
    meaning: 'also / too',
    register: 'Everyday / Standard',
    note: 'Negative counterpart is "também não".',
    category: 'High-Register Connectors',
  },
  para: {
    meaning: 'for / to / in order to',
    register: 'Neutral / Standard',
    note: 'In informal speech often heard as "pra".',
    category: 'High-Register Connectors',
  },
  por: {
    meaning: 'by / through / for / because of',
    register: 'Neutral / Standard',
    note: 'Contracts with articles: pelo, pela, pelos, pelas.',
    category: 'High-Register Connectors',
  },
  porque: {
    meaning: 'because',
    register: 'Neutral / Standard',
    note: '"Por que" (separated) introduces questions.',
    category: 'High-Register Connectors',
  },
  assunto: {
    meaning: 'subject / topic / matter',
    register: 'Neutral / Standard',
    note: 'Standard word for topic, subject, or briefing item.',
    category: 'Regional Idioms',
  },
  // Function words & frequent Brazilian/Standard PT connectors
  de: {
    meaning: 'of / from',
    register: 'Everyday / Standard',
    note: 'Contracts with articles: do, da, dos, das.',
    category: 'High-Register Connectors',
  },
  do: {
    meaning: 'of the / from the (de + o)',
    register: 'Everyday / Standard',
    note: 'Mandatory contraction.',
    category: 'High-Register Connectors',
  },
  da: {
    meaning: 'of the / from the (de + a)',
    register: 'Everyday / Standard',
    note: 'Mandatory contraction.',
    category: 'High-Register Connectors',
  },
  em: {
    meaning: 'in / on / at',
    register: 'Everyday / Standard',
    note: 'Contracts with articles: no, na, nos, nas.',
    category: 'High-Register Connectors',
  },
  no: {
    meaning: 'in the / on the (em + o)',
    register: 'Everyday / Standard',
    note: 'Mandatory contraction of "em + o" ("no centro de operações").',
    category: 'High-Register Connectors',
  },
  na: {
    meaning: 'in the / on the (em + a)',
    register: 'Everyday / Standard',
    note: 'Mandatory contraction of em + a.',
    category: 'High-Register Connectors',
  },
  com: {
    meaning: 'with',
    register: 'Everyday / Standard',
    note: 'Core preposition.',
    category: 'High-Register Connectors',
  },
  sem: {
    meaning: 'without',
    register: 'Everyday / Standard',
    note: '"Sem dúvida" = without a doubt.',
    category: 'High-Register Connectors',
  },
  voce: {
    meaning: 'you (singular standard BR)',
    register: 'Everyday / Standard',
    note: 'Takes 3rd-person singular verb forms.',
    category: 'Regional Idioms',
  },
  como: {
    meaning: 'how / as / like',
    register: 'Neutral / Standard',
    note: '"Bem como" = as well as (formal).',
    category: 'High-Register Connectors',
  },
  quando: {
    meaning: 'when',
    register: 'Neutral / Standard',
    note: 'Triggers future subjunctive for future contingencies ("quando chegarmos").',
    category: 'High-Register Connectors',
  },
  onde: {
    meaning: 'where',
    register: 'Neutral / Standard',
    note: 'Static location ("onde"); motion toward ("aonde").',
    category: 'High-Register Connectors',
  },
  quem: {
    meaning: 'who / whom',
    register: 'Neutral / Standard',
    note: 'Invariable pronoun.',
    category: 'High-Register Connectors',
  },
  muito: {
    meaning: 'very / much / a lot',
    register: 'Everyday / Standard',
    note: 'Functions as both adverb (invariable: "muito importante") and adjective ("muitos recursos").',
    category: 'High-Register Connectors',
  },
  bem: {
    meaning: 'well / fine / quite',
    register: 'Everyday / Standard',
    note: '"Tudo bem" = everything’s good.',
    category: 'Regional Idioms',
  },
  melhor: {
    meaning: 'better / best',
    register: 'Neutral / Standard',
    note: 'Same form for masculine and feminine.',
    category: 'High-Register Connectors',
  },
  sobre: {
    meaning: 'about / on / regarding',
    register: 'Neutral / Standard',
    note: 'Standard formal preposition.',
    category: 'High-Register Connectors',
  },
  dever: {
    meaning: 'should / must / duty',
    register: 'Neutral / Formal',
    note: '"Devemos" = we must/should.',
    category: 'High-Register Connectors',
  },
  seguranca: {
    meaning: 'security / safety',
    register: 'Operational / Diplomatic',
    note: 'Core policy/military term.',
    category: 'Operational/Military Terms',
  },
  missao: {
    meaning: 'mission',
    register: 'Operational / Military',
    note: 'Plural: "missões".',
    category: 'Operational/Military Terms',
  },
  treinamento: {
    meaning: 'training / drill',
    register: 'Operational / Military',
    note: 'Common military/operational noun.',
    category: 'Operational/Military Terms',
  },
  relatorio: {
    meaning: 'report / briefing / debrief',
    register: 'Formal / Operational',
    note: 'Standard term for operational or after-action reports.',
    category: 'Operational/Military Terms',
  },
  operacao: {
    meaning: 'operation',
    register: 'Operational / Military',
    note: 'Plural: "operações".',
    category: 'Operational/Military Terms',
  },
  estrategia: {
    meaning: 'strategy',
    register: 'Formal / Policy',
    note: 'Adjective: "estratégico".',
    category: 'Operational/Military Terms',
  },
  cooperacao: {
    meaning: 'cooperation',
    register: 'Diplomatic / Policy',
    note: 'Key bilateral defense term.',
    category: 'Operational/Military Terms',
  },
};

const LOCAL_TOT_MAP: Record<TargetLanguage, Record<string, Omit<TotResult, never>>> = {
  es: {
    schedule: {
      targetPhrase: 'el cronograma / el horario',
      alternativeFormal: 'la programación operativa',
      registerNote: 'Use "el cronograma" for project/training timelines and "el horario" for daily times.',
      exampleSentence: 'Debemos ajustar el cronograma antes del despliegue conjunto.',
      category: 'Operational/Military Terms',
    },
    debrief: {
      targetPhrase: 'el informe posterior a la acción',
      alternativeFormal: 'la reunión de análisis posterior',
      registerNote: 'Avoid English borrowing; "informe posterior" is crisp and natural in military Spanish.',
      exampleSentence: 'Al concluir la maniobra realizaremos el informe posterior a la acción.',
      category: 'Operational/Military Terms',
    },
    'follow up': {
      targetPhrase: 'dar seguimiento a',
      alternativeFormal: 'hacer el seguimiento pertinente de',
      registerNote: 'High-frequency ILR 2+/3 operational collocation.',
      exampleSentence: 'Es fundamental dar seguimiento a los acuerdos alcanzados con la delegación.',
      category: 'Operational/Military Terms',
    },
    however: {
      targetPhrase: 'sin embargo / no obstante',
      alternativeFormal: 'con todo / aun así',
      registerNote: 'Upgrade from "pero" to anchor balanced ILR 2+/3 discourse pivots.',
      exampleSentence: 'Los resultados iniciales son alentadores; no obstante, persisten brechas logísticas.',
      category: 'High-Register Connectors',
    },
    nevertheless: {
      targetPhrase: 'no obstante',
      alternativeFormal: 'pese a ello',
      registerNote: 'Formal ILR 3 adversative pivot.',
      exampleSentence: 'El presupuesto es limitado; no obstante, mantendremos la vigilancia costera.',
      category: 'High-Register Connectors',
    },
    'even though': {
      targetPhrase: 'aunque / si bien',
      alternativeFormal: 'aun cuando (+ subjuntivo)',
      registerNote: 'Use "si bien" for factual concessions and "aun cuando" + subjunctive for hypotheticals.',
      exampleSentence: 'Si bien la coordinación mejoró, todavía enfrentamos retos de interoperabilidad.',
      category: 'High-Register Connectors',
    },
    therefore: {
      targetPhrase: 'por consiguiente',
      alternativeFormal: 'en consecuencia / por ende',
      registerNote: 'Formal upgrade from casual "entonces" for balanced ILR 2+/3 reasoning.',
      exampleSentence: 'Faltan embarcaciones rápidas; por consiguiente, priorizaremos la vigilancia aérea.',
      category: 'High-Register Connectors',
    },
    despite: {
      targetPhrase: 'a pesar de / pese a',
      alternativeFormal: 'a despecho de',
      registerNote: 'Followed by a noun, infinitive, or "que + clause".',
      exampleSentence: 'Pese a las condiciones adversas, la tripulación completó el patrullaje.',
      category: 'High-Register Connectors',
    },
    regarding: {
      targetPhrase: 'con respecto a / en cuanto a',
      alternativeFormal: 'en lo que atañe a',
      registerNote: 'Crisp topic-framing connector for OPI transitions.',
      exampleSentence: 'Con respecto a la logística regional, conviene diversificar los puertos de escala.',
      category: 'High-Register Connectors',
    },
    deadline: {
      targetPhrase: 'el plazo límite / la fecha límite',
      alternativeFormal: 'el término perentorio',
      registerNote: 'Use "plazo" for operational/policy windows.',
      exampleSentence: 'Debemos entregar la evaluación antes de que venza el plazo límite.',
      category: 'Operational/Military Terms',
    },
  },
  pt: {
    schedule: {
      targetPhrase: 'o cronograma / a agenda',
      alternativeFormal: 'a programação operacional',
      registerNote: 'Use "o cronograma" for milestones/training plans and "a agenda" for meetings.',
      exampleSentence: 'Precisamos ajustar o cronograma antes do exercício conjunto.',
      category: 'Operational/Military Terms',
    },
    debrief: {
      targetPhrase: 'o relatório pós-ação / o briefing de encerramento',
      alternativeFormal: 'a análise pós-missão',
      registerNote: 'Clean Portuguese equivalent for operational debriefings.',
      exampleSentence: 'Logo após a operação, faremos o relatório pós-ação com a equipe.',
      category: 'Operational/Military Terms',
    },
    'follow up': {
      targetPhrase: 'dar seguimento a / acompanhar',
      alternativeFormal: 'dar continuidade a',
      registerNote: 'Natural professional collocation.',
      exampleSentence: 'Vamos dar seguimento às medidas acordadas com a delegação parceira.',
      category: 'Operational/Military Terms',
    },
    however: {
      targetPhrase: 'no entanto / contudo',
      alternativeFormal: 'todavia / entretanto',
      registerNote: 'Formal ILR 2+/3 pivots for nuanced caveats ("todavia" = however, "ainda" = still).',
      exampleSentence: 'A iniciativa trouxe avanços; contudo, ainda há gargalos logísticos.',
      category: 'High-Register Connectors',
    },
    nevertheless: {
      targetPhrase: 'não obstante / todavia',
      alternativeFormal: 'apesar disso',
      registerNote: 'Strong formal transition for policy/defense discussion.',
      exampleSentence: 'Os recursos são restritos; todavia, manteremos a patrulha costeira.',
      category: 'High-Register Connectors',
    },
    'even though': {
      targetPhrase: 'embora (+ subjuntivo) / muito embora',
      alternativeFormal: 'ainda que (+ subjuntivo)',
      registerNote: 'Always requires the subjunctive mood in Portuguese.',
      exampleSentence: 'Embora a coordenação tenha melhorado, ainda enfrentamos desafios técnicos.',
      category: 'High-Register Connectors',
    },
    therefore: {
      targetPhrase: 'portanto / por conseguinte',
      alternativeFormal: 'consequentemente',
      registerNote: 'Formal upgrade from spoken "então".',
      exampleSentence: 'Faltam embarcações rápidas; portanto, priorizaremos o monitoramento aéreo.',
      category: 'High-Register Connectors',
    },
    despite: {
      targetPhrase: 'apesar de / a despeito de',
      alternativeFormal: 'não obstante',
      registerNote: 'Pairs cleanly with nouns or personal infinitives.',
      exampleSentence: 'Apesar das condições climáticas adversas, a equipe cumpriu a missão.',
      category: 'High-Register Connectors',
    },
    regarding: {
      targetPhrase: 'no que diz respeito a / quanto a',
      alternativeFormal: 'com relação a',
      registerNote: 'High-register topic switcher for OPI turns.',
      exampleSentence: 'No que diz respeito à logística, devemos ampliar os pontos de reabastecimento.',
      category: 'High-Register Connectors',
    },
    deadline: {
      targetPhrase: 'o prazo final / a data-limite',
      alternativeFormal: 'o termo final',
      registerNote: '"Prazo" is the standard administrative/military term for deadlines.',
      exampleSentence: 'Temos que enviar a avaliação antes do prazo final.',
      category: 'Operational/Military Terms',
    },
  },
};

function getStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function dispatchBrowserEvent(eventName: string, detail?: unknown): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(eventName, {detail}));
  }
}

function readStorageJson<T>(key: string, fallback: T): T {
  const storage = getStorage();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorageJson<T>(key: string, val: T): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(val));
    return true;
  } catch {
    return false;
  }
}

// Fast in-memory LRU mirror hydrated lazily once from localStorage so repeated word taps are O(1)
let wordCacheMemory: Map<string, CachedWordRecord> | null = null;

function hydrateWordCache(): Map<string, CachedWordRecord> {
  if (wordCacheMemory) return wordCacheMemory;
  const map = new Map<string, CachedWordRecord>();
  const now = Date.now();

  // Read v2 records first
  const storedV2 = readStorageJson<Record<string, CachedWordRecord>>(WORD_CACHE_KEY, {});
  for (const [k, rec] of Object.entries(storedV2)) {
    if (rec && rec.result && typeof rec.result.contextualMeaning === 'string' && rec.result.contextualMeaning.trim()) {
      map.set(k, {
        result: rec.result,
        cachedAt: typeof rec.cachedAt === 'number' ? rec.cachedAt : now,
        lastAccessedAt: typeof rec.lastAccessedAt === 'number' ? rec.lastAccessedAt : now,
        hits: typeof rec.hits === 'number' ? rec.hits : 0,
      });
    }
  }

  // Seamlessly migrate legacy v1 cache entries if present
  const storage = getStorage();
  if (storage) {
    const legacyV1 = readStorageJson<Record<string, WordLookupResult>>(LEGACY_WORD_CACHE_KEY, {});
    let migrated = false;
    for (const [k, res] of Object.entries(legacyV1)) {
      if (!map.has(k) && res && typeof res.contextualMeaning === 'string' && res.contextualMeaning.trim()) {
        map.set(k, {
          result: res,
          cachedAt: now,
          lastAccessedAt: now,
          hits: 0,
        });
        migrated = true;
      }
    }
    if (migrated) {
      persistWordCache(map);
      try {
        storage.removeItem(LEGACY_WORD_CACHE_KEY);
      } catch {
        // Ignore storage errors
      }
    }
  }

  wordCacheMemory = map;
  return map;
}

function persistWordCache(map: Map<string, CachedWordRecord>): void {
  // Enforce LRU cap
  if (map.size > MAX_CACHED_WORDS) {
    const sorted = Array.from(map.entries()).sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
    const excess = map.size - MAX_CACHED_WORDS;
    for (let i = 0; i < excess; i += 1) {
      map.delete(sorted[i][0]);
    }
  }

  const serialized = Object.fromEntries(map.entries());
  const ok = writeStorageJson(WORD_CACHE_KEY, serialized);
  if (!ok && map.size > 100) {
    // Quota fallback: prune oldest half and retry once
    const sorted = Array.from(map.entries()).sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
    const pruneCount = Math.floor(map.size / 2);
    for (let i = 0; i < pruneCount; i += 1) {
      map.delete(sorted[i][0]);
    }
    writeStorageJson(WORD_CACHE_KEY, Object.fromEntries(map.entries()));
  }
}

export function resetInMemoryCacheForTests(): void {
  wordCacheMemory = null;
}

export function getApiSavedCount(): number {
  const n = readStorageJson<number>(API_SAVED_COUNT_KEY, 0);
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

export function incrementApiSavedCount(by = 1): number {
  const next = getApiSavedCount() + by;
  writeStorageJson(API_SAVED_COUNT_KEY, next);
  dispatchBrowserEvent(API_SAVED_EVENT, next);
  return next;
}

export function lookupLocalWord(
  language: TargetLanguage,
  word: string,
  vocabItems: VocabItem[] = []
): EnrichedWordLookup | null {
  const key = normalizeLookupKey(word);
  if (!key) return null;

  const candidates = getCandidateLookupKeys(language, key);
  const candidateSet = new Set(candidates);
  const displayWord = word.trim();

  // 1. Check user's Vocab Vault first (0 API cost, exact or singular/gender match)
  const vaultMatch = vocabItems.find((item) => {
    if (item.language !== language) return false;
    const itemKey = normalizeLookupKey(item.term);
    return itemKey === key || candidateSet.has(itemKey);
  });
  if (vaultMatch) {
    return {
      word: displayWord,
      contextualMeaning: vaultMatch.englishConcept,
      registerTag: vaultMatch.registerTag || 'Saved in Vault',
      grammarNote: vaultMatch.contextSentence
        ? `From your Vocab Vault: "${vaultMatch.contextSentence}"`
        : 'Already saved in your Vocab Vault.',
      suggestedCategory: vaultMatch.category,
      source: 'vault',
      matchedTerm: vaultMatch.term,
    };
  }

  // 2. Check dedicated offline Military & Operational dictionary (exact + morphological variants)
  const militaryDict = MILITARY_DICT_BY_LANGUAGE[language];
  for (const cand of candidates) {
    const milEntry = militaryDict[cand];
    if (milEntry) {
      return {
        word: displayWord,
        contextualMeaning: milEntry.meaning,
        registerTag: milEntry.register,
        grammarNote: milEntry.note,
        suggestedCategory: milEntry.category,
        source: 'military_dict',
        matchedTerm: milEntry.term,
      };
    }
  }

  // 3. Check built-in Spanish / Portuguese core dictionary (exact + morphological variants)
  const coreDict = language === 'es' ? ES_CORE_DICT : PT_CORE_DICT;
  for (const cand of candidates) {
    const entry = coreDict[cand];
    if (entry) {
      return {
        word: displayWord,
        contextualMeaning: entry.meaning,
        registerTag: entry.register,
        grammarNote: entry.note,
        suggestedCategory: entry.category,
        source: 'dictionary',
        matchedTerm: cand,
      };
    }
  }

  // 4. Check fast in-memory + persistent localStorage LRU cache (previously fetched AI definitions)
  const cacheMap = hydrateWordCache();
  for (const cand of candidates) {
    const cacheKey = `${language}:${cand}`;
    const record = cacheMap.get(cacheKey);
    if (record && record.result.contextualMeaning?.trim()) {
      record.lastAccessedAt = Date.now();
      record.hits += 1;
      return {
        ...record.result,
        word: displayWord,
        source: 'cache',
        matchedTerm: record.result.word || cand,
      };
    }
  }

  return null;
}

export function saveWordToLocalCache(language: TargetLanguage, result: WordLookupResult, rawTappedWord?: string): void {
  if (!result || !result.contextualMeaning?.trim()) return;
  const resultKey = normalizeLookupKey(result.word);
  const rawKey = rawTappedWord ? normalizeLookupKey(rawTappedWord) : '';
  if (!resultKey && !rawKey) return;

  const cacheMap = hydrateWordCache();
  const now = Date.now();

  const keysToStore = Array.from(new Set([resultKey, rawKey].filter(Boolean)));
  for (const k of keysToStore) {
    const cacheKey = `${language}:${k}`;
    const prev = cacheMap.get(cacheKey);
    cacheMap.set(cacheKey, {
      result: {
        ...result,
        word: result.word?.trim() || rawTappedWord?.trim() || k,
      },
      cachedAt: prev?.cachedAt ?? now,
      lastAccessedAt: now,
      hits: prev?.hits ?? 0,
    });
  }

  persistWordCache(cacheMap);
  dispatchBrowserEvent(WORD_CACHE_EVENT);
}

export function getOfflineMilitaryEntries(language: TargetLanguage): MilitaryDictEntry[] {
  return Object.values(MILITARY_DICT_BY_LANGUAGE[language]).sort((a, b) => a.term.localeCompare(b.term, language));
}

export function getLocalCacheStats(language?: TargetLanguage): LocalCacheStats {
  const cacheMap = hydrateWordCache();
  let cachedWordCount = 0;
  if (language) {
    const prefix = `${language}:`;
    for (const k of cacheMap.keys()) {
      if (k.startsWith(prefix)) cachedWordCount += 1;
    }
  } else {
    cachedWordCount = cacheMap.size;
  }

  const totCache = readStorageJson<Record<string, TotResult>>(TOT_CACHE_KEY, {});
  const cachedTotCount = language
    ? Object.keys(totCache).filter((k) => k.startsWith(`${language}:`)).length
    : Object.keys(totCache).length;

  const militaryCount = language
    ? Object.keys(MILITARY_DICT_BY_LANGUAGE[language]).length
    : Object.keys(MILITARY_DICT_BY_LANGUAGE.es).length + Object.keys(MILITARY_DICT_BY_LANGUAGE.pt).length;

  const coreCount = language
    ? Object.keys(language === 'es' ? ES_CORE_DICT : PT_CORE_DICT).length
    : Object.keys(ES_CORE_DICT).length + Object.keys(PT_CORE_DICT).length;

  return {
    militaryCount,
    coreCount,
    cachedWordCount,
    cachedTotCount,
    apiSavedCount: getApiSavedCount(),
  };
}

export function clearWordCacheOnly(): void {
  wordCacheMemory = new Map();
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(WORD_CACHE_KEY);
      storage.removeItem(LEGACY_WORD_CACHE_KEY);
      storage.removeItem(TOT_CACHE_KEY);
    } catch {
      // Ignore storage errors
    }
  }
  dispatchBrowserEvent(WORD_CACHE_EVENT);
}

export function lookupLocalTotPhrase(language: TargetLanguage, englishQuery: string): EnrichedTotResult | null {
  const key = normalizeLookupKey(englishQuery).replace(/^to /, '');
  if (!key) return null;

  const builtIn = LOCAL_TOT_MAP[language][key];
  if (builtIn) {
    return {
      ...builtIn,
      source: 'dictionary',
    };
  }

  const cache = readStorageJson<Record<string, TotResult>>(TOT_CACHE_KEY, {});
  const cached = cache[`${language}:${key}`];
  if (cached && cached.targetPhrase?.trim()) {
    return {
      ...cached,
      source: 'cache',
    };
  }

  return null;
}

export function saveTotToLocalCache(language: TargetLanguage, englishQuery: string, result: TotResult): void {
  const key = normalizeLookupKey(englishQuery).replace(/^to /, '');
  if (!key || !result.targetPhrase?.trim()) return;
  const cache = readStorageJson<Record<string, TotResult>>(TOT_CACHE_KEY, {});
  cache[`${language}:${key}`] = result;
  writeStorageJson(TOT_CACHE_KEY, cache);
  dispatchBrowserEvent(WORD_CACHE_EVENT);
}

interface LabCacheStore {
  prep?: Record<string, PrepPromptItem>;
  interp?: Record<string, InterpBriefing>;
}

export function getCachedPrepPrompt(language: TargetLanguage, domain: string): PrepPromptItem | null {
  const store = readStorageJson<LabCacheStore>(LAB_CACHE_KEY, {});
  return store.prep?.[`${language}:${domain}`] ?? null;
}

export function savePrepPromptCache(language: TargetLanguage, domain: string, item: PrepPromptItem): void {
  const store = readStorageJson<LabCacheStore>(LAB_CACHE_KEY, {});
  store.prep = {...(store.prep ?? {}), [`${language}:${domain}`]: item};
  writeStorageJson(LAB_CACHE_KEY, store);
}

export function getCachedInterpBriefing(
  language: TargetLanguage,
  dialect: string,
  domain: string
): InterpBriefing | null {
  const store = readStorageJson<LabCacheStore>(LAB_CACHE_KEY, {});
  return store.interp?.[`${language}:${dialect}:${domain}`] ?? null;
}

export function saveInterpBriefingCache(
  language: TargetLanguage,
  dialect: string,
  domain: string,
  briefing: InterpBriefing
): void {
  const store = readStorageJson<LabCacheStore>(LAB_CACHE_KEY, {});
  store.interp = {...(store.interp ?? {}), [`${language}:${dialect}:${domain}`]: briefing};
  writeStorageJson(LAB_CACHE_KEY, store);
}

export function clearLocalLookupCaches(): void {
  wordCacheMemory = new Map();
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(WORD_CACHE_KEY);
      storage.removeItem(LEGACY_WORD_CACHE_KEY);
      storage.removeItem(TOT_CACHE_KEY);
      storage.removeItem(LAB_CACHE_KEY);
      storage.removeItem(API_SAVED_COUNT_KEY);
    } catch {
      // Ignore storage errors
    }
  }
  dispatchBrowserEvent(API_SAVED_EVENT, 0);
  dispatchBrowserEvent(WORD_CACHE_EVENT);
}
