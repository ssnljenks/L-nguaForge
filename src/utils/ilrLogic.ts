import type {
  ChatRegisterMode,
  FreeChatThread,
  MilitaryDomain,
  OpiSession,
  PrepPhase,
  TargetLanguage,
  VocabCategory,
  VocabItem,
} from '../types';

export const LANGUAGE_LABELS: Record<TargetLanguage, string> = {
  es: 'Spanish',
  pt: 'Portuguese',
};

export const DIALECTS_BY_LANGUAGE: Record<TargetLanguage, {id: string; label: string; bcp47: string; short: string}[]> =
  {
    es: [
      {id: 'neutral_latam', label: 'Neutral Latin American', bcp47: 'es-MX', short: 'Neutral LatAm'},
      {id: 'rioplatense', label: 'Rioplatense (Argentine)', bcp47: 'es-AR', short: 'Rioplatense'},
      {id: 'caribbean', label: 'Caribbean (PR / DR / CU)', bcp47: 'es-PR', short: 'Caribbean'},
      {id: 'colombian_andean', label: 'Colombian / Andean', bcp47: 'es-CO', short: 'Colombian'},
    ],
    pt: [
      {id: 'br_standard', label: 'Brazilian Standard (Sudeste)', bcp47: 'pt-BR', short: 'BR Standard'},
      {id: 'br_bahian', label: 'Brazilian Bahian (Nordeste)', bcp47: 'pt-BR', short: 'BR Bahian'},
      {id: 'br_southern', label: 'Brazilian Southern (Sul)', bcp47: 'pt-BR', short: 'BR Sul'},
      {id: 'eu_portuguese', label: 'European Portuguese', bcp47: 'pt-PT', short: 'EU Portuguese'},
    ],
  };

export const MILITARY_DOMAINS: {id: MilitaryDomain; label: string; shortLabel: string; description: string}[] = [
  {
    id: 'general_policy',
    label: 'General Policy & Strategy',
    shortLabel: 'General Policy',
    description: 'Defense policy, regional security cooperation, civil-military relations, and treaty frameworks.',
  },
  {
    id: 'maritime_surveillance',
    label: 'Maritime Surveillance & Interdiction',
    shortLabel: 'Maritime & Interdiction',
    description: 'EEZ patrols, counter-narcotics boarding, maritime domain awareness, and joint naval task forces.',
  },
  {
    id: 'aviation_logistics',
    label: 'Aviation & Logistics',
    shortLabel: 'Aviation & Logistics',
    description: 'Airlift corridors, humanitarian air bridges, maintenance supply chains, and airspace deconfliction.',
  },
  {
    id: 'c2_comms',
    label: 'C2 / Comms & Cyber',
    shortLabel: 'C2 & Comms',
    description: 'Joint command-and-control architecture, interoperable comms, spectrum resilience, and cyber defense.',
  },
  {
    id: 'delegation_hosting',
    label: 'Partner-Nation Delegation Hosting',
    shortLabel: 'Delegation Hosting',
    description: 'Senior leader engagements, protocol briefings, bilateral staff talks, and diplomatic hospitality.',
  },
];

export const PREP_PHASES: PrepPhase[] = [
  {
    id: 'point',
    label: 'Point',
    startSec: 0,
    endSec: 15,
    guidance: 'State a clear, direct thesis or operational assessment immediately.',
  },
  {
    id: 'reason',
    label: 'Reason',
    startSec: 15,
    endSec: 40,
    guidance: 'Explain the systemic, strategic, or institutional cause behind your position.',
  },
  {
    id: 'example',
    label: 'Example',
    startSec: 40,
    endSec: 70,
    guidance: 'Anchor with a concrete regional precedent, joint exercise, or operational scenario.',
  },
  {
    id: 'pivot',
    label: 'Pivot / Conclusion',
    startSec: 70,
    endSec: 90,
    guidance: 'Acknowledge a counter-consideration using the subjunctive and close decisively.',
  },
];

export function getDefaultDialect(language: TargetLanguage): string {
  return DIALECTS_BY_LANGUAGE[language][0].id;
}

export function getDialectInfo(language: TargetLanguage, dialectId: string) {
  const list = DIALECTS_BY_LANGUAGE[language];
  return list.find((d) => d.id === dialectId) ?? list[0];
}

export function getDomainInfo(domainId: MilitaryDomain) {
  return MILITARY_DOMAINS.find((d) => d.id === domainId) ?? MILITARY_DOMAINS[0];
}

export function isMilitaryDomain(val: unknown): val is MilitaryDomain {
  return typeof val === 'string' && MILITARY_DOMAINS.some((d) => d.id === val);
}

/**
 * Deterministic PREP 90-second pacing state machine.
 * Boundaries:
 *   0..14s  -> point
 *   15..39s -> reason
 *   40..69s -> example
 *   70..90s -> pivot
 */
export function getPrepPhase(elapsedSeconds: number): PrepPhase {
  const clamped = Math.max(0, Math.min(90, Math.floor(elapsedSeconds)));
  if (clamped < 15) return PREP_PHASES[0];
  if (clamped < 40) return PREP_PHASES[1];
  if (clamped < 70) return PREP_PHASES[2];
  return PREP_PHASES[3];
}

/**
 * Normalizes Spanish/Portuguese text for deterministic phrase-recall match scoring.
 */
export function normalizeForComparison(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Computes word-overlap accuracy (0..100) between target expression and recalled transcript.
 */
export function scorePhraseRecallMatch(targetText: string, spokenText: string): number {
  const targetTokens = normalizeForComparison(targetText);
  const spokenTokens = normalizeForComparison(spokenText);
  if (targetTokens.length === 0 || spokenTokens.length === 0) return 0;

  const spokenCounts = new Map<string, number>();
  for (const token of spokenTokens) {
    spokenCounts.set(token, (spokenCounts.get(token) ?? 0) + 1);
  }

  let matched = 0;
  for (const token of targetTokens) {
    const count = spokenCounts.get(token) ?? 0;
    if (count > 0) {
      matched += 1;
      spokenCounts.set(token, count - 1);
    }
  }

  return Math.round((matched / targetTokens.length) * 100);
}

/**
 * Tokenizes an examiner message into clickable word tokens and non-word punctuation/whitespace
 * while preserving exact original spacing and punctuation.
 */
export function tokenizeTranscript(text: string): {text: string; isWord: boolean; cleanWord: string}[] {
  if (typeof text !== 'string' || !text) return [];
  const regex = /([A-Za-zÀ-ÖØ-öø-ÿÑñÇç'-]+)|([^A-Za-zÀ-ÖØ-öø-ÿÑñÇç'-]+)/g;
  const tokens: {text: string; isWord: boolean; cleanWord: string}[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      tokens.push({
        text: match[1],
        isWord: true,
        cleanWord: match[1].replace(/^['-]+|['-]+$/g, ''),
      });
    } else if (match[2]) {
      tokens.push({
        text: match[2],
        isWord: false,
        cleanWord: '',
      });
    }
  }
  return tokens;
}

/**
 * Formats saved vocabulary items into an Anki-ready UTF-8 CSV string.
 * Columns: Front (English Concept), Back (Target Term), Context Sentence, Register, Category, Language, Dialect, Tags
 */
function csvEscape(val: string): string {
  const str = String(val ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatVocabToAnkiCsv(items: VocabItem[]): string {
  const header = [
    'Front_English_Concept',
    'Back_Target_Term',
    'Context_Sentence',
    'Register_Tag',
    'Category',
    'Language',
    'Dialect',
    'Tags',
  ];

  const rows = items.map((item) => {
    const tags = [
      `lang::${item.language}`,
      item.domain ? `domain::${item.domain}` : null,
      item.source ? `src::${item.source}` : null,
      `cat::${item.category.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    ]
      .filter(Boolean)
      .join(' ');

    return [
      item.englishConcept,
      item.term,
      item.contextSentence,
      item.registerTag,
      item.category,
      LANGUAGE_LABELS[item.language],
      getDialectInfo(item.language, item.dialect).label,
      tags,
    ]
      .map(csvEscape)
      .join(',');
  });

  return [header.join(','), ...rows].join('\n');
}

export function formatSecondsClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function buildChatThreadTitle(firstMessage: string, maxLen = 44): string {
  const cleaned = String(firstMessage ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'New Conversation';
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1).trimEnd()}…`;
}

export const VALID_VOCAB_CATEGORIES = [
  'High-Register Connectors',
  'Operational/Military Terms',
  'Regional Idioms',
  'False Friends',
] as const satisfies readonly VocabCategory[];

export const CHAT_REGISTER_MODES = [
  'everyday',
  'professional',
  'debate',
] as const satisfies readonly ChatRegisterMode[];

export function isVocabCategory(value: unknown): value is VocabCategory {
  return typeof value === 'string' && (VALID_VOCAB_CATEGORIES as readonly string[]).includes(value);
}

export function normalizeVocabCategory(raw: string): (typeof VALID_VOCAB_CATEGORIES)[number] {
  const matched = VALID_VOCAB_CATEGORIES.find(
    (c) =>
      c.toLowerCase() ===
      String(raw ?? '')
        .trim()
        .toLowerCase()
  );
  return matched ?? 'Regional Idioms';
}

/**
 * Strictly partitions persisted items (chat threads, sessions, vocab, history)
 * to the currently selected target language so Spanish and Portuguese states never bleed.
 */
export function filterItemsByLanguage<T extends {language: TargetLanguage}>(items: T[], language: TargetLanguage): T[] {
  return items.filter((item) => item.language === language);
}

/**
 * Resolves the active Free Chat thread strictly within the active target language.
 * Returns null if no thread belongs to the target language (even if activeThreadId points elsewhere).
 */
export function resolveActiveThreadForLanguage(
  threads: FreeChatThread[],
  activeThreadId: string,
  language: TargetLanguage
): FreeChatThread | null {
  const scoped = filterItemsByLanguage(threads, language);
  if (scoped.length === 0) return null;
  if (!activeThreadId) return null;
  return scoped.find((t) => t.id === activeThreadId) ?? null;
}

/**
 * Resolves the active OPI/PREP debrief session strictly within the active target language.
 * Falls back only to the newest session of the same language, never another language.
 */
export function resolveActiveSessionForLanguage(
  sessions: OpiSession[],
  selectedSessionId: string,
  language: TargetLanguage
): OpiSession | null {
  const scoped = filterItemsByLanguage(sessions, language);
  if (scoped.length === 0) return null;
  return scoped.find((s) => s.id === selectedSessionId) ?? scoped[0] ?? null;
}
