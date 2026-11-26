import type {
  BriefDrillQuestion,
  BriefIlrLevel,
  BriefItem,
  BriefMediaType,
  BriefTopic,
  MilitaryDomain,
  TargetLanguage,
} from '../types.ts';

export const BRIEF_TOPICS: readonly {id: BriefTopic; label: string}[] = [
  {id: 'society', label: 'Society'},
  {id: 'politics', label: 'Politics'},
  {id: 'economy', label: 'Economy'},
  {id: 'culture', label: 'Culture'},
  {id: 'scitech', label: 'Sci/Tech'},
  {id: 'security', label: 'Security'},
];

export const BRIEF_ILR_LEVELS: readonly BriefIlrLevel[] = ['2', '2+', '3', '3+'];

export function isBriefTopic(val: unknown): val is BriefTopic {
  return (
    val === 'society' ||
    val === 'politics' ||
    val === 'economy' ||
    val === 'culture' ||
    val === 'scitech' ||
    val === 'security'
  );
}

export function isBriefIlrLevel(val: unknown): val is BriefIlrLevel {
  return val === '2' || val === '2+' || val === '3' || val === '3+';
}

export function getTopicLabel(topic: BriefTopic): string {
  const match = BRIEF_TOPICS.find((t) => t.id === topic);
  return match?.label ?? topic;
}

export interface BriefFilterOptions {
  mediaType: BriefMediaType;
  language: TargetLanguage;
  level?: 'all' | BriefIlrLevel;
  topic?: 'all' | BriefTopic;
  workFilter?: boolean;
  userDomain?: MilitaryDomain;
  searchQuery?: string;
}

export function filterBriefItems(items: readonly BriefItem[], options: BriefFilterOptions): BriefItem[] {
  const search = options.searchQuery?.trim().toLowerCase();
  return items.filter((item) => {
    if (item.language !== options.language) return false;
    if (item.mediaType !== options.mediaType) return false;
    if (options.level && options.level !== 'all' && item.ilrLevel !== options.level) return false;
    if (options.topic && options.topic !== 'all' && item.topic !== options.topic) return false;
    if (options.workFilter) {
      if (!item.matchingDomains || item.matchingDomains.length === 0) return false;
      if (options.userDomain && !item.matchingDomains.includes(options.userDomain)) return false;
    }
    if (search) {
      const match =
        item.title.toLowerCase().includes(search) ||
        item.summary.toLowerCase().includes(search) ||
        item.orientationLine.toLowerCase().includes(search) ||
        item.sourceName.toLowerCase().includes(search);
      if (!match) return false;
    }
    return true;
  });
}

export function formatBriefLength(mediaType: BriefMediaType, estimatedMinutes: number): string {
  const mins = Math.max(1, Math.round(estimatedMinutes));
  if (mediaType === 'audio') {
    return `~${mins} min broadcast`;
  }
  return `~${mins * 200} words`;
}

export interface BriefDrillScore {
  correctCount: number;
  totalQuestions: number;
  percentage: number;
  ratingLabel: string;
}

export function scoreBriefDrill(
  selectedAnswers: Record<string, number>,
  questions: readonly BriefDrillQuestion[],
  targetIlrLevel: BriefIlrLevel
): BriefDrillScore {
  const total = questions.length;
  if (total === 0) {
    return {correctCount: 0, totalQuestions: 0, percentage: 0, ratingLabel: 'Practice Complete'};
  }
  let correct = 0;
  for (const q of questions) {
    if (selectedAnswers[q.id] === q.correctIndex) {
      correct += 1;
    }
  }
  const pct = Math.round((correct / total) * 100);
  let ratingLabel = `Level ${targetIlrLevel} practice`;
  if (pct === 100) {
    ratingLabel = `Full Comprehension · Level ${targetIlrLevel} practice`;
  } else if (pct >= 66) {
    ratingLabel = `Solid Comprehension · Level ${targetIlrLevel} practice`;
  } else {
    ratingLabel = `Review Needed · Level ${targetIlrLevel} practice`;
  }
  return {
    correctCount: correct,
    totalQuestions: total,
    percentage: pct,
    ratingLabel,
  };
}

/**
 * Built-in practice stories so the feed is never empty (e.g. offline or before the first ingest).
 * They were written for LinguaForge: they are NOT real news reports, so they carry no outlet name,
 * no publisher link and no audio, and their orientation lines say so (REVIEW.md C-1).
 */
/** Minimum length of real source text for a DLPT drill to be meaningful. */
export const MIN_DRILL_PASSAGE_WORDS = 40;

/** Whether DLPT drills / Gist can be offered for this item (REVIEW C-2). */
export function isBriefItemDrillable(item: Pick<BriefItem, 'drillable'>): boolean {
  return item.drillable !== false;
}

export const PRACTICE_STORY_SOURCE_NAME = 'LinguaForge practice story';

export const SEED_BRIEF_ITEMS: readonly BriefItem[] = [
  {
    id: 'es-seed-maritime-01',
    title: 'Operativo conjunto intercepta embarcación semisumergible en aguas del Pacífico',
    sourceName: PRACTICE_STORY_SOURCE_NAME,
    sourceUrl: '',
    mediaType: 'text',
    language: 'es',
    dialectId: 'colombian_andean',
    publishedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    ilrLevel: '2+',
    topic: 'security',
    orientationLine:
      'Practice passage written for LinguaForge (not a real news report), modeled on a Colombian broadcast reporting on a naval interdiction operation in the Pacific.',
    summary:
      'Naval coast guard units coordinated with international partner aircraft to track and intercept an unflagged semi-submersible craft carrying illicit cargo 80 nautical miles offshore.',
    matchingDomains: ['maritime_surveillance', 'general_policy'],
    estimatedMinutes: 2,
    lengthLabel: 'Practice passage',
  },
  {
    id: 'es-seed-tech-02',
    title: 'Energía solar y baterías a gran escala transforman la matriz energética del norte argentino',
    sourceName: PRACTICE_STORY_SOURCE_NAME,
    sourceUrl: '',
    mediaType: 'text',
    language: 'es',
    dialectId: 'rioplatense',
    publishedAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    ilrLevel: '3',
    topic: 'scitech',
    orientationLine:
      'Practice passage written for LinguaForge (not a real news report), modeled on an analytical article in an Argentine newspaper examining regional energy transition policies.',
    summary:
      'The article evaluates public-private investments in solar parks in Jujuy and lithium storage technology, analyzing how grid interconnection delays pose financial hurdles for developers.',
    matchingDomains: ['general_policy'],
    estimatedMinutes: 3,
    lengthLabel: 'Practice passage',
  },
  {
    id: 'es-seed-society-03',
    title: 'Aumentan las tarifas del transporte metropolitano tras debate legislativo en San Juan',
    sourceName: PRACTICE_STORY_SOURCE_NAME,
    sourceUrl: '',
    mediaType: 'text',
    language: 'es',
    dialectId: 'caribbean',
    publishedAt: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
    ilrLevel: '2',
    topic: 'society',
    orientationLine:
      'Practice passage written for LinguaForge (not a real news report), modeled on a Puerto Rican news report on commuter transit fare changes in the metropolitan area.',
    summary:
      'Commuters and transit authorities reacted to approved bus and train fare adjustments intended to offset rising fuel and vehicle maintenance costs.',
    matchingDomains: [],
    estimatedMinutes: 2,
    lengthLabel: 'Practice passage',
  },
  {
    id: 'es-seed-culture-04',
    title: 'Restauración del patrimonio colonial en el Centro Histórico de la Ciudad de México',
    sourceName: PRACTICE_STORY_SOURCE_NAME,
    sourceUrl: '',
    mediaType: 'text',
    language: 'es',
    dialectId: 'neutral_latam',
    publishedAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
    ilrLevel: '3',
    topic: 'culture',
    orientationLine:
      'Practice passage written for LinguaForge (not a real news report), modeled on a Mexican cultural broadcast interviewing architectural conservators in the capital.',
    summary:
      'Historians discuss hydraulic stabilization and volcanic stone conservation techniques used to preserve centuries-old buildings sinking into former lakebeds.',
    matchingDomains: [],
    estimatedMinutes: 2,
    lengthLabel: 'Practice passage',
  },
  {
    id: 'pt-seed-maritime-01',
    title: 'Marinha do Brasil intensifica patrulhamento contra pesca ilegal na Amazônia Azul',
    sourceName: PRACTICE_STORY_SOURCE_NAME,
    sourceUrl: '',
    mediaType: 'text',
    language: 'pt',
    dialectId: 'br_standard',
    publishedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    ilrLevel: '2+',
    topic: 'security',
    orientationLine:
      'Practice passage written for LinguaForge (not a real news report), modeled on a Brazilian radio report on maritime patrol operations in the South Atlantic EEZ.',
    summary:
      'Naval frigates and environmental agencies executed joint inspections of international fishing vessels operating near the limits of Brazil’s Exclusive Economic Zone.',
    matchingDomains: ['maritime_surveillance', 'general_policy'],
    estimatedMinutes: 2,
    lengthLabel: 'Practice passage',
  },
  {
    id: 'pt-seed-economy-02',
    title: 'Transição energética e exportação de hidrogênio verde atraem investimento na costa baiana',
    sourceName: PRACTICE_STORY_SOURCE_NAME,
    sourceUrl: '',
    mediaType: 'text',
    language: 'pt',
    dialectId: 'br_bahian',
    publishedAt: new Date(Date.now() - 7 * 3600 * 1000).toISOString(),
    ilrLevel: '3',
    topic: 'economy',
    orientationLine:
      'Practice passage written for LinguaForge (not a real news report), modeled on a Bahian business column discussing port infrastructure and green hydrogen development.',
    summary:
      'The article details industrial projects in Camaçari and Aratu aiming to export renewable ammonia to European markets, weighing grid stability risks against tax incentives.',
    matchingDomains: ['aviation_logistics', 'general_policy'],
    estimatedMinutes: 3,
    lengthLabel: 'Practice passage',
  },
  {
    id: 'pt-seed-scitech-03',
    title: 'Investigadores em Lisboa desenvolvem novo sensor por satélite para monitorização costeira',
    sourceName: PRACTICE_STORY_SOURCE_NAME,
    sourceUrl: '',
    mediaType: 'text',
    language: 'pt',
    dialectId: 'eu_portuguese',
    publishedAt: new Date(Date.now() - 10 * 3600 * 1000).toISOString(),
    ilrLevel: '3+',
    topic: 'scitech',
    orientationLine:
      'Practice passage written for LinguaForge (not a real news report), modeled on a Portuguese science editorial detailing oceanographic remote sensing advances.',
    summary:
      'Researchers at the University of Lisbon unveiled multispectral algorithms capable of detecting oil spills and microplastics from small satellite constellations.',
    matchingDomains: ['maritime_surveillance', 'c2_comms'],
    estimatedMinutes: 3,
    lengthLabel: 'Practice passage',
  },
  {
    id: 'pt-seed-society-04',
    title: 'Comunidades do litoral gaúcho adaptam infraestrutura contra tempestades extratropicais',
    sourceName: PRACTICE_STORY_SOURCE_NAME,
    sourceUrl: '',
    mediaType: 'text',
    language: 'pt',
    dialectId: 'br_southern',
    publishedAt: new Date(Date.now() - 14 * 3600 * 1000).toISOString(),
    ilrLevel: '2',
    topic: 'society',
    orientationLine:
      'Practice passage written for LinguaForge (not a real news report), modeled on a southern Brazilian news segment on municipal civil defense preparations.',
    summary:
      'Coastal cities in Rio Grande do Sul have reinforced drainage and installed solar sirens ahead of seasonal storm swells.',
    matchingDomains: [],
    estimatedMinutes: 2,
    lengthLabel: 'Practice passage',
  },
  {
    id: 'es-seed-economy-05',
    title: 'Cooperativas cafetaleras de Antioquia amplían exportaciones directas a mercados europeos',
    sourceName: PRACTICE_STORY_SOURCE_NAME,
    sourceUrl: '',
    mediaType: 'text',
    language: 'es',
    dialectId: 'colombian_andean',
    publishedAt: new Date(Date.now() - 16 * 3600 * 1000).toISOString(),
    ilrLevel: '2',
    topic: 'economy',
    orientationLine:
      'Practice passage written for LinguaForge (not a real news report), modeled on a Colombian radio business segment covering small-scale coffee growers in Antioquia.',
    summary:
      'Regional coffee cooperatives have begun shipping certified specialty beans directly to European roasters to retain a larger share of export revenue.',
    matchingDomains: [],
    estimatedMinutes: 2,
    lengthLabel: 'Practice passage',
  },
  {
    id: 'es-seed-politics-06',
    title: 'Debate sobre reforma hídrica y concesiones mineras en el congreso chileno',
    sourceName: PRACTICE_STORY_SOURCE_NAME,
    sourceUrl: '',
    mediaType: 'text',
    language: 'es',
    dialectId: 'neutral_latam',
    publishedAt: new Date(Date.now() - 18 * 3600 * 1000).toISOString(),
    ilrLevel: '3+',
    topic: 'politics',
    orientationLine:
      'Practice passage written for LinguaForge (not a real news report), modeled on a Chilean radio commentary analyzing legislative disagreements over water rights and mining concessions.',
    summary:
      'A policy analyst critiques the stalled water code reform, arguing that competing regional alliances have turned environmental permitting into a proxy battle over fiscal decentralization.',
    matchingDomains: ['general_policy'],
    estimatedMinutes: 2,
    lengthLabel: 'Practice passage',
  },
  {
    id: 'es-seed-economy-07',
    title: 'Puerto de Veracruz incorpora escáneres no intrusivos para agilizar el despacho aduanero',
    sourceName: PRACTICE_STORY_SOURCE_NAME,
    sourceUrl: '',
    mediaType: 'text',
    language: 'es',
    dialectId: 'neutral_latam',
    publishedAt: new Date(Date.now() - 20 * 3600 * 1000).toISOString(),
    ilrLevel: '2+',
    topic: 'economy',
    orientationLine:
      'Practice passage written for LinguaForge (not a real news report), modeled on a Mexican business newspaper article reporting on customs modernization at a major seaport.',
    summary:
      'Port administrators installed high-throughput inspection lanes designed to cut container wait times by a third while tightening documentation audits.',
    matchingDomains: ['aviation_logistics', 'maritime_surveillance'],
    estimatedMinutes: 2,
    lengthLabel: 'Practice passage',
  },
  {
    id: 'pt-seed-politics-05',
    title: 'Especialistas avaliam impacto da reforma tributária sobre serviços municipais no Brasil',
    sourceName: PRACTICE_STORY_SOURCE_NAME,
    sourceUrl: '',
    mediaType: 'text',
    language: 'pt',
    dialectId: 'br_standard',
    publishedAt: new Date(Date.now() - 22 * 3600 * 1000).toISOString(),
    ilrLevel: '3',
    topic: 'politics',
    orientationLine:
      'Practice passage written for LinguaForge (not a real news report), modeled on a Brazilian radio panel discussing how national tax reform may reshape municipal budgets.',
    summary:
      'Economists debate whether the gradual shift from origin-based to destination-based taxation will narrow regional inequalities or strain medium-sized service hubs during the transition.',
    matchingDomains: ['general_policy'],
    estimatedMinutes: 2,
    lengthLabel: 'Practice passage',
  },
  {
    id: 'pt-seed-culture-06',
    title: 'Bibliotecas comunitárias do Recife ampliam horário noturno para estudantes e trabalhadores',
    sourceName: PRACTICE_STORY_SOURCE_NAME,
    sourceUrl: '',
    mediaType: 'text',
    language: 'pt',
    dialectId: 'br_bahian',
    publishedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    ilrLevel: '2',
    topic: 'culture',
    orientationLine:
      'Practice passage written for LinguaForge (not a real news report), modeled on a northeastern Brazilian newspaper feature on expanded hours at neighborhood public libraries.',
    summary:
      'Four community libraries in Recife extended weekday evening hours and added free internet workstations to serve adults taking night classes.',
    matchingDomains: [],
    estimatedMinutes: 2,
    lengthLabel: 'Practice passage',
  },
];
