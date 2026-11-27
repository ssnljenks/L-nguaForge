/**
 * Deterministic dialect marker lists per Talk tutor.
 *
 * IMPORTANT: these lists are the suite author's working knowledge, not a linguistic authority. They are
 * deliberately conservative (high-precision tokens), and every dialect verdict is flagged in the report for
 * confirmation by a native speaker of that variety. Spoken features that do not survive in text (Rioplatense
 * sheísmo, Caribbean aspirated -s, Paisa cadence) cannot be checked here at all.
 */
export interface DialectSpec {
  tutorId: string;
  label: string;
  /** Needs >= `minRequired` hits across the tutor's replies in a conversation to pass. */
  required: {name: string; patterns: RegExp[]}[];
  minRequired: number;
  /** Any hit is a failure (wrong variety, or wrong register for this tutor). */
  forbidden: {name: string; patterns: RegExp[]}[];
  /** Lexicon used to measure slang density (slang level 0 vs 4). */
  lexicon: RegExp[];
  nativeReview: string[];
}

const w = (...alts: string[]) => new RegExp(`(?<![\\p{L}])(?:${alts.join('|')})(?![\\p{L}])`, 'iu');

const TUTEO = w(
  'tú',
  'tienes',
  'quieres',
  'puedes',
  'eres',
  'sabes',
  'haces',
  'dices',
  'vienes',
  'piensas',
  'prefieres',
  'cuéntame'
);
const VOSEO = w(
  'vos',
  'tenés',
  'querés',
  'podés',
  'sabés',
  'hacés',
  'decís',
  'venís',
  'sos',
  'andás',
  'vivís',
  'hablás',
  'pensás',
  'preferís',
  'contame',
  'decime',
  'mirá',
  'fijate',
  'vení',
  'acordate'
);
const VOSOTROS = w('vosotros', 'vosotras', 'os', 'habláis', 'tenéis', 'queréis', 'podéis', 'vais', 'sois', 'estáis');
const LUNFARDO = w('che', 'laburo', 'laburar', 'bondi', 'quilombo', 're copado', 'pibe', 'boludo', 'morfar', 'guita');
const PAISA_LEX = w(
  'parce',
  'parcero',
  'bacano',
  'camello',
  'tintico',
  'qué más pues',
  'charro',
  'amañado',
  'paisa',
  'berraco'
);
const MX_LEX = w(
  'chamba',
  'chido',
  'chida',
  'qué padre',
  'órale',
  'ahorita',
  'qué onda',
  'mande',
  'neta',
  'no manches',
  'güey',
  'platicar',
  'padrísimo',
  'ándale'
);
const CARIBE_LEX = w(
  'janguear',
  'jangueo',
  'corillo',
  'wepa',
  'chévere',
  'guagua',
  'tapón',
  'brutal',
  'nítido',
  'boricua',
  'mofongo',
  'acho',
  'bregar',
  'pichear',
  "pa'",
  'qué tú',
  'cómo tú',
  'dónde tú',
  'cuándo tú'
);
const ES_FOREIGN_FOR_ALL = [LUNFARDO, PAISA_LEX, MX_LEX, CARIBE_LEX];

const BR_LEX = w(
  'cê',
  'cara',
  'beleza',
  'maneiro',
  'rolê',
  'pô',
  'tá',
  'tô',
  'né',
  'pra',
  'valeu',
  'bora',
  'massa',
  'legal',
  'ônibus',
  'trem',
  'celular',
  'você',
  'a gente',
  'tranquilo',
  'demais',
  'show de bola'
);
const EP_MARKERS = [
  /\b(estou|estás|está|estamos|estão|estava|estavas)\s+a\s+\p{L}+r\b/iu,
  /\p{L}+-(?:me|te|lhe|nos|se|o|a|os|as|lo|la)(?![\p{L}])/iu,
  w(
    'autocarro',
    'comboio',
    'fixe',
    'giro',
    'pá',
    'bica',
    'miúdos?',
    'telemóvel',
    'pequeno-almoço',
    'bué',
    'pois',
    'tens',
    'queres',
    'podes',
    'sabes',
    'estás',
    'és',
    'vês'
  ),
];
const BR_ONLY_FORBIDDEN_IN_EP = [
  /\b(estou|estás|está|estamos|estão|estava)\s+\p{L}+(?:ndo)\b/iu,
  w(
    'ônibus',
    'celular',
    'trem',
    'café da manhã',
    'cê',
    'tô',
    'cara',
    'legal',
    'bacana',
    'geladeira',
    'banheiro',
    'moleque'
  ),
];
const EP_ONLY_FORBIDDEN_IN_BR = [
  /\b(estou|estás|está|estamos|estão|estava)\s+a\s+\p{L}+r\b/iu,
  /\p{L}+-(?:me|te|lhe|nos)(?![\p{L}])/iu,
  w(
    'autocarro',
    'comboio',
    'fixe',
    'giro',
    'pá',
    'telemóvel',
    'pequeno-almoço',
    'miúdos?',
    'bué',
    'tens',
    'queres',
    'podes',
    'sabes'
  ),
];

export const DIALECTS: Record<string, DialectSpec> = {
  'es-ba-mateo': {
    tutorId: 'es-ba-mateo',
    label: 'Rioplatense (voseo)',
    required: [{name: 'voseo', patterns: [VOSEO]}],
    minRequired: 2,
    forbidden: [
      {name: 'tuteo', patterns: [TUTEO]},
      {name: 'vosotros', patterns: [VOSOTROS]},
      {name: 'other-variety lexicon', patterns: [PAISA_LEX, MX_LEX, CARIBE_LEX]},
    ],
    lexicon: [LUNFARDO, w('dale', 'bárbaro', 're', 'posta', 'copado', 'mate', 'asado')],
    nativeReview: [
      'Sheísmo (/ʃ/ for ll/y) and Porteño intonation cannot be assessed from text.',
      'Whether lunfardo density at slang 4 is natural for a Villa Crespo sound engineer.',
    ],
  },
  'es-med-valeria': {
    tutorId: 'es-med-valeria',
    label: 'Paisa (usted among friends)',
    required: [
      {
        name: 'usted-address',
        patterns: [
          w('usted', 'ustedes', 'sumercé'),
          /\b(le|la)\s+(va|parece|queda|gusta|cuento|recomiendo|ayudo|invito)\b/iu,
          /¿(cómo|qué)\s+(le|la)\s/iu,
          /\b(de dónde es|qué hace|qué más hace|cómo está|cómo le va)\b/iu,
        ],
      },
    ],
    minRequired: 1,
    forbidden: [
      {name: 'tuteo', patterns: [TUTEO]},
      {name: 'vosotros', patterns: [VOSOTROS]},
      {name: 'other-variety lexicon', patterns: [LUNFARDO, MX_LEX, CARIBE_LEX]},
    ],
    lexicon: [PAISA_LEX, w('pues', 'qué más', 'sisas', 'mijo', 'mija')],
    nativeReview: [
      'The tutor config (tutors.ts) sets defaultRegister "vos" and a "voseo & usted blend", while the expected Paisa norm among friends is usted (vos is also real but more intimate): confirm which the persona should model.',
      'Paisa cadence and "pues" placement cannot be assessed from text.',
    ],
  },
  'es-sj-carlos': {
    tutorId: 'es-sj-carlos',
    label: 'Caribbean / Puerto Rican',
    required: [{name: 'Caribbean features', patterns: [CARIBE_LEX, /(?<![\p{L}])(pa'|to'|na'|e')(?![\p{L}])/iu]}],
    minRequired: 1,
    forbidden: [
      {name: 'voseo', patterns: [VOSEO]},
      {name: 'vosotros', patterns: [VOSOTROS]},
      {name: 'other-variety lexicon', patterns: [LUNFARDO, PAISA_LEX, MX_LEX]},
    ],
    lexicon: [CARIBE_LEX, w('nene', 'nena', 'dímelo', 'ay bendito', 'gufeao', 'chilling')],
    nativeReview: [
      'Aspirated or dropped final -s ("pa\'", "to\'") and its orthographic rendering cannot be checked reliably from text.',
      'Pre-verbal subject pronouns in questions (¿qué tú dices?) are checked by pattern only; confirm they are used naturally, not overused.',
    ],
  },
  'es-cdmx-sofia': {
    tutorId: 'es-cdmx-sofia',
    label: 'Mexican (CDMX)',
    required: [{name: 'CDMX features', patterns: [MX_LEX, w('padre', 'cafecito', 'ratito', 'tacos?', 'platicar')]}],
    minRequired: 1,
    forbidden: [
      {name: 'voseo', patterns: [VOSEO]},
      {name: 'vosotros', patterns: [VOSOTROS]},
      {name: 'other-variety lexicon', patterns: [LUNFARDO, PAISA_LEX, CARIBE_LEX]},
    ],
    lexicon: [MX_LEX, w('cafecito', 'ratito', 'ándale', 'sale', 'chavo', 'chava', 'padrísimo')],
    nativeReview: [
      'Check that "güey", "no manches" and similar items are appropriate for a friendly tutor persona at slang 4.',
    ],
  },
  'pt-rio-lucas': {
    tutorId: 'pt-rio-lucas',
    label: 'Carioca (Brazilian)',
    required: [{name: 'Brazilian colloquial features', patterns: [BR_LEX]}],
    minRequired: 2,
    forbidden: [{name: 'European Portuguese forms', patterns: EP_ONLY_FORBIDDEN_IN_BR}],
    lexicon: [
      w('maneiro', 'cara', 'perrengue', 'rolê', 'beleza', 'pô', 'fala aí', 'tranquilo', 'mano', 'irado', 'sinistro'),
    ],
    nativeReview: [
      'Carioca coda-s palatalization ("sh") is a spoken feature and cannot be checked from text.',
      '"mano", "irado", "sinistro" are included in the slang lexicon on judgment only.',
    ],
  },
  'pt-ssa-camila': {
    tutorId: 'pt-ssa-camila',
    label: 'Bahian (Brazilian)',
    required: [
      {
        name: 'Bahian/Brazilian features',
        patterns: [
          w(
            'oxe',
            'oxente',
            'massa',
            'barril',
            'de boa',
            'arretado',
            'bora',
            'visse',
            'meu rei',
            'minha rainha',
            'vixe',
            'painho',
            'mainha'
          ),
          BR_LEX,
        ],
      },
    ],
    minRequired: 2,
    forbidden: [{name: 'European Portuguese forms', patterns: EP_ONLY_FORBIDDEN_IN_BR}],
    lexicon: [
      w(
        'oxe',
        'oxente',
        'massa',
        'barril',
        'de boa',
        'arretado',
        'bora',
        'visse',
        'meu rei',
        'vixe',
        'mainha',
        'painho'
      ),
    ],
    nativeReview: [
      '"arretado", "vixe", "meu rei" are general Northeastern features; confirm which are specifically Soteropolitano.',
      'Melodic Bahian intonation cannot be assessed from text.',
    ],
  },
  'pt-lis-tiago': {
    tutorId: 'pt-lis-tiago',
    label: 'European Portuguese (Lisbon)',
    required: [{name: 'European Portuguese features', patterns: EP_MARKERS}],
    minRequired: 2,
    forbidden: [{name: 'Brazilian forms', patterns: BR_ONLY_FORBIDDEN_IN_EP}],
    lexicon: [w('fixe', 'giro', 'pá', 'bica', 'bué', 'desenrascar', 'pois', 'topo', 'tasca', 'miúdo')],
    nativeReview: [
      '"pois" and "tens/queres/podes" are treated as European markers on judgment; confirm none is natural in the Brazilian register being contrasted.',
      'Vowel reduction and Lisbon intonation cannot be assessed from text.',
    ],
  },
};

export function matches(text: string, patterns: readonly RegExp[]): string[] {
  const out: string[] = [];
  for (const re of patterns) {
    const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
    for (const m of text.matchAll(new RegExp(re.source, flags))) out.push(m[0]);
  }
  return out;
}

export function slangDensity(text: string, spec: DialectSpec): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  return matches(text, spec.lexicon).length / words;
}

export {ES_FOREIGN_FOR_ALL};
