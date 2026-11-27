/** Small deterministic text scorers shared by the eval features. */

export function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function words(text: string): string[] {
  return norm(text).split(' ').filter(Boolean);
}

/** Share of `a`'s tokens (length >= minLen) that also occur in `b`. */
export function tokenOverlap(a: string, b: string, minLen = 3): number {
  const ta = words(a).filter((w) => w.length >= minLen);
  if (ta.length === 0) return 0;
  const tb = new Set(words(b));
  return ta.filter((w) => tb.has(w)).length / ta.length;
}

/** Case/diacritic/whitespace-insensitive substring test. */
export function containsNorm(haystack: string, needle: string): boolean {
  const n = norm(needle);
  return n.length > 0 && norm(haystack).includes(n);
}

const STOP = {
  en: 'the a an and or but is are was were be been to of in on at for with that this it as by from not you your i we they he she have has had do does will would can could should what when where which who how my our their there then than so if about into just also very because please sorry'.split(
    ' '
  ),
  es: 'el la los las un una unos unas y o pero es son era fue ser de del en con que se no su sus por para como más muy me te lo le les mi tu si ya qué cómo cuándo dónde hay está están estoy tengo tiene porque también entre sobre hasta desde pues yo usted vos'.split(
    ' '
  ),
  pt: 'o a os as um uma uns umas e ou mas é são era foi ser de do da dos das em no na nos nas com que se não seu sua seus suas por para como mais muito me te lhe meu minha se já você tem está estão estou tenho porque também entre sobre até desde pois eu tu'.split(
    ' '
  ),
};

export type Lang = 'en' | 'es' | 'pt';

export function stopwordHits(text: string): Record<Lang, number> {
  const toks = words(text);
  const count = (list: string[]) => {
    const set = new Set(list.map(norm));
    return toks.filter((t) => set.has(t)).length;
  };
  return {en: count(STOP.en), es: count(STOP.es), pt: count(STOP.pt)};
}

/** True when the text reads as English rather than the target language (needs >= 3 English function words). */
export function looksEnglish(text: string, target: 'es' | 'pt'): boolean {
  const h = stopwordHits(text);
  const total = words(text).length;
  return h.en >= 3 && h.en > h[target] && h.en / Math.max(1, total) >= 0.2;
}

/** Share of tokens that are English function words (0..1), for reporting partial code-switching. */
export function englishShare(text: string): number {
  return stopwordHits(text).en / Math.max(1, words(text).length);
}

export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?¿?])\s+/)
    .map((s) => s.trim())
    .filter((s) => words(s).length > 0);
}

export function avgSentenceWords(text: string): number {
  const ss = sentences(text);
  if (ss.length === 0) return 0;
  return ss.reduce((n, s) => n + words(s).length, 0) / ss.length;
}

function termRegex(terms: readonly string[]): RegExp {
  const body = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '\\p{L}*')).join('|');
  return new RegExp(`(?<![\\p{L}])(?:${body})(?![\\p{L}])`, 'giu');
}

const MILITARY_TERMS = [
  'military',
  'militar',
  'militares',
  'militarmente',
  'army',
  'navy',
  'soldier',
  'soldiers',
  'soldado',
  'soldados',
  'ejército',
  'exército',
  'armada',
  'marinha de guerra',
  'marina de guerra',
  'fuerza aérea',
  'força aérea',
  'air force',
  'combat',
  'combate',
  'combatiente',
  'tactical',
  'táctico',
  'táctica',
  'tático',
  'tática',
  'troops',
  'tropas',
  'battalion',
  'batallón',
  'batalhão',
  'warfare',
  'weapon',
  'weapons',
  'armamento',
  'misil',
  'misiles',
  'míssil',
  'missile',
  'defense ministry',
  'ministry of defense',
  'ministerio de defensa',
  'ministério da defesa',
  'defensa nacional',
  'defesa nacional',
  'pentágono',
  'otan',
  'nato',
  'guerra',
  'war',
  'interdicción',
  'interdição',
  'interdiction',
  'maritime surveillance',
  'vigilancia marítima',
  'vigilância marítima',
  'command and control',
  'chain of command',
  'cadena de mando',
  'cadeia de comando',
  'special fields',
  'operational',
  'operacional',
  'operacionales',
  'inteligencia militar',
  'inteligência militar',
  'counter-narcotics',
  'antinarcóticos',
];
const MILITARY_RE = termRegex(MILITARY_TERMS);

/** Distinct military/domain terms found in `text`. */
export function militaryTerms(text: string): string[] {
  return [...new Set((text.match(MILITARY_RE) ?? []).map((t) => t.toLowerCase()))];
}

const WORK_RE = termRegex([
  'trabajo',
  'trabajas',
  'trabajar',
  'trabajás',
  'trabaja',
  'empleo',
  'profesión',
  'te dedicas',
  'te dedicás',
  'oficio',
  'jefe',
  'jefa',
  'oficina',
  'colegas',
  'compañeros de trabajo',
  'laburo',
  'chamba',
  'camello',
  'trabalho',
  'trabalha',
  'trabalhar',
  'emprego',
  'profissão',
  'chefe',
  'escritório',
  'colegas de trabalho',
  'work',
  'job',
  'employer',
  'career',
  'carrera',
  'carreira',
  'empresa',
]);

export function workTerms(text: string): string[] {
  return [...new Set((text.match(WORK_RE) ?? []).map((t) => t.toLowerCase()))];
}

export function matchAny(text: string, patterns: readonly RegExp[]): string[] {
  return patterns.flatMap((re) => {
    const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
    return [...text.matchAll(new RegExp(re.source, flags))].map((m) => m[0]);
  });
}

/** Markers that a model leaked its own instructions (distinctive fragments of the server prompts). */
export const PROMPT_FRAGMENTS = [
  'CRITICAL SCOPE',
  'NEUTRALITY RULES',
  'ACTIVE INTERVIEW STATE',
  'BREAKDOWN DETECTION',
  'STRICT IN-ROLE RULES',
  'NO-EXAM / NO-SCORE',
  'Signature features of your speech',
  'Slang level',
  'Correction style',
  'OUTPUT FIELDS',
  'FUNCTIONS FOR ASSESSMENT',
  'lastTurnAssessment',
  'recommendedStep',
  'Next phase:',
  'certified senior ILR',
];
