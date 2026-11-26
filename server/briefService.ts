import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {Type} from '@google/genai';
import {
  BRIEF_ILR_LEVELS,
  BRIEF_TOPICS,
  filterBriefItems,
  formatBriefLength,
  isBriefIlrLevel,
  isBriefTopic,
  SEED_BRIEF_ITEMS,
} from '../src/utils/briefLogic.ts';
import {getMaxQuestionsForPassage, CHOICE_LETTERS, isDlptQuestionType, isDlptTrapType} from '../src/utils/dlptRules.ts';
import {isGistMainPointRating} from '../src/utils/gistLogic.ts';
import type {
  BriefDrill,
  BriefDrillQuestion,
  BriefIlrLevel,
  BriefItem,
  BriefMediaType,
  BriefTopic,
  DlptChoiceDetail,
  DlptQuestionType,
  DlptTrapType,
  GistFinding,
  GistGradeResult,
  GistMainPointRating,
  MilitaryDomain,
  TargetLanguage,
} from '../src/types.ts';
import {MODELS} from './config.ts';
import {extractReportedErrors} from './errorReporting.ts';
import {UserFacingError} from './errors.ts';
import {BUDGETS, type GenerateStructured, ThinkingLevel} from './gemini.ts';

export interface SourceFeedConfig {
  id: string;
  name: string;
  url: string;
  language: TargetLanguage;
  dialectId: string;
  mediaType: BriefMediaType;
}

export interface StoredBriefItem extends BriefItem {
  rawContent?: string;
  transcript?: string;
  studyExcerpt?: string;
  keyVocabulary?: {term: string; english: string}[];
}

const MAX_CACHE_SIZE = 150;
const MAX_FEED_FETCH_TIMEOUT_MS = 5000;

// Study excerpts for the built-in practice stories (written for LinguaForge, not real news reports).
const SEED_EXTENDED_DATA: Record<string, {studyExcerpt: string; keyVocabulary: {term: string; english: string}[]}> = {
  'es-seed-maritime-01': {
    studyExcerpt:
      'Unidades de Guardacostas de la Armada Nacional, en coordinación con aeronaves de patrullaje marítimo internacional, lograron la interdicción de un artefacto naval tipo semisumergible en aguas del Pacífico colombiano. La embarcación, tripulada por tres personas y sin bandera visible, transportaba un cargamento ilícito a unas ochenta millas náuticas de la costa. Durante la inspección inicial se constató la presencia de compartimentos estancos sellados y sistemas rudimentarios de navegación satelital. La nave fue remolcada al puerto de Buenaventura para el procedimiento judicial correspondiente y la verificación técnica del cargamento incautado.',
    keyVocabulary: [
      {term: 'semisumergible', english: 'semi-submersible craft'},
      {term: 'interdicción', english: 'interdiction'},
      {term: 'compartimentos estancos', english: 'watertight compartments'},
      {term: 'millas náuticas', english: 'nautical miles'},
    ],
  },
  'es-seed-tech-02': {
    studyExcerpt:
      'La provincia de Jujuy consolida la expansión de parques solares fotovoltaicos integrados a sistemas de almacenamiento con baterías de iones de litio en la Puna argentina. El proyecto Cauchari, situado a más de cuatro mil metros sobre el nivel del mar, genera energía limpia para el Sistema Interconectado Nacional. No obstante, analistas del sector energético señalan que la saturación de líneas de transporte de alta tensión representa un cuello de botella crítico para la viabilidad económica de nuevos desarrollos privados en el norte del país, exigiendo mayor coordinación regulatoria entre las provincias y la administración federal.',
    keyVocabulary: [
      {term: 'matriz energética', english: 'energy matrix / mix'},
      {term: 'líneas de transporte', english: 'transmission lines'},
      {term: 'cuello de botella', english: 'bottleneck'},
      {term: 'almacenamiento', english: 'storage'},
    ],
  },
  'es-seed-society-03': {
    studyExcerpt:
      'El Departamento de Transportación y Obras Públicas de Puerto Rico anunció el ajuste escalonado en las tarifas del Tren Urbano y autobuses metropolitanos. Los usuarios manifestaron preocupación por el impacto presupuestario en las familias de ingresos fijos, mientras que la autoridad administradora justificó el incremento citando la necesidad urgente de modernizar el sistema de cobro electrónico y absorber el costo creciente del combustible y repuestos.',
    keyVocabulary: [
      {term: 'tarifas', english: 'fares / rates'},
      {term: 'escalonado', english: 'tiered / phased'},
      {term: 'ingresos fijos', english: 'fixed income'},
      {term: 'repuestos', english: 'spare parts'},
    ],
  },
  'es-seed-culture-04': {
    studyExcerpt:
      'Especialistas del Instituto Nacional de Antropología e Historia presentaron los avances en las obras de recimentación del patrimonio novohispano en el Centro Histórico capitalino. Las técnicas combinan pilotes de control con inyecciones de bentonita para contrarrestar el hundimiento diferencial provocado por la extracción de mantos freáticos en la cuenca del Valle de México.',
    keyVocabulary: [
      {term: 'recimentación', english: 'underpinning / foundation repair'},
      {term: 'hundimiento diferencial', english: 'differential settling / subsidence'},
      {term: 'mantos freáticos', english: 'groundwater tables / aquifers'},
    ],
  },
  'pt-seed-maritime-01': {
    studyExcerpt:
      'A Marinha do Brasil deflagrou uma nova fase da Operação Amazônia Azul no Atlântico Sul, visando coibir a pesca predatória não autorizada dentro da Zona Econômica Exclusiva. Fragatas e aeronaves de patrulha realizaram abordagens e inspeções documentais em pesqueiros estrangeiros que navegavam em área de preservação. Segundo o comando de operações navais, a ação coordenada com o Ibama visa garantir a soberania marítima e salvaguardar a biomassa pesqueira nacional.',
    keyVocabulary: [
      {term: 'pesca predatória', english: 'predatory / illegal fishing'},
      {term: 'Zona Econômica Exclusiva', english: 'Exclusive Economic Zone (EEZ)'},
      {term: 'abordagens', english: 'boardings / vessel inspections'},
      {term: 'soberania marítima', english: 'maritime sovereignty'},
    ],
  },
  'pt-seed-economy-02': {
    studyExcerpt:
      'O polo industrial de Camaçari na Bahia assinou memorandos de entendimento para a implantação de usinas de hidrogênio verde voltadas à exportação de amônia para a Europa. Representantes do setor ressaltam que o acesso portuário no terminal de Aratu e os recursos eólicos do semiárido conferem vantagem competitiva ao estado, embora a definição de marcos regulatórios tributários ainda gere cautela entre investidores internacionais.',
    keyVocabulary: [
      {term: 'hidrogênio verde', english: 'green hydrogen'},
      {term: 'memorando de entendimento', english: 'memorandum of understanding'},
      {term: 'marcos regulatórios', english: 'regulatory frameworks'},
      {term: 'vantagem competitiva', english: 'competitive advantage'},
    ],
  },
  'pt-seed-scitech-03': {
    studyExcerpt:
      'Investigadores do Instituto Superior Técnico de Lisboa desenvolveram novos algoritmos de inteligência artificial aplicados a imagens multiespectrais de satélite para deteção precoce de descargas poluentes e derrames de hidrocarbonetos na costa atlântica. O sistema permite alertar a capitania dos portos em menos de vinte minutos após a passagem orbital do satélite.',
    keyVocabulary: [
      {term: 'imagens multiespectrais', english: 'multispectral imagery'},
      {term: 'derrames de hidrocarbonetos', english: 'hydrocarbon / oil spills'},
      {term: 'deteção precoce', english: 'early detection'},
      {term: 'passagem orbital', english: 'orbital pass'},
    ],
  },
  'pt-seed-society-04': {
    studyExcerpt:
      'A Defesa Civil do Rio Grande do Sul mobilizou equipes de prontidão no litoral sul após alertas meteorológicos indicando a formação de um ciclone extratropical com rajadas de vento superiores a oitenta quilômetros por hora. Municípios costeiros reforçaram a contenção de dunas e prepararam abrigos provisórios para atender famílias ribeirinhas vulneráveis a inundações.',
    keyVocabulary: [
      {term: 'ciclone extratropical', english: 'extratropical cyclone'},
      {term: 'rajadas de vento', english: 'wind gusts'},
      {term: 'prontidão', english: 'readiness / standby'},
      {term: 'famílias ribeirinhas', english: 'riverside / coastal families'},
    ],
  },
  'es-seed-economy-05': {
    studyExcerpt:
      'Tres cooperativas cafetaleras del suroeste de Antioquia anunciaron un acuerdo comercial para exportar directamente cuarenta toneladas de café de origen hacia tostadores independientes en Alemania y Países Bajos. Los productores explicaron que eliminar a los intermediarios tradicionales les permitirá cubrir el alza en los fertilizantes y financiar mejoras en las plantas de secado solar. Sin embargo, el gremio advirtió que el cumplimiento de las nuevas normas europeas de trazabilidad ambiental requerirá asesoría técnica permanente para las fincas más pequeñas.',
    keyVocabulary: [
      {term: 'intermediarios', english: 'middlemen / brokers'},
      {term: 'secado solar', english: 'solar drying'},
      {term: 'trazabilidad ambiental', english: 'environmental traceability'},
      {term: 'gremio', english: 'guild / producers association'},
    ],
  },
  'es-seed-politics-06': {
    studyExcerpt:
      'El estancamiento de la reforma al código de aguas en el Senado chileno revela menos un desacuerdo técnico sobre caudales ecológicos que una disputa de fondo sobre descentralización fiscal. Aunque el Ejecutivo insiste en que los permisos temporales darán certidumbre tanto a las comunidades agrícolas como a las faenas mineras del norte, varios gobernadores regionales temen que la centralización de los criterios hídricos reste margen de negociación a las provincias productoras. Si el proyecto no logra consensos antes del receso legislativo, es probable que la inversión minera se postergue hasta el próximo ciclo electoral.',
    keyVocabulary: [
      {term: 'estancamiento', english: 'stalemate / gridlock'},
      {term: 'caudales ecológicos', english: 'ecological water flows'},
      {term: 'faenas mineras', english: 'mining operations'},
      {term: 'margen de negociación', english: 'room to negotiate'},
    ],
  },
  'es-seed-economy-07': {
    studyExcerpt:
      'La administración del puerto de Veracruz puso en operación cuatro carriles equipados con escáneres de rayos X de alto rendimiento para inspeccionar contenedores sin abrir los sellos aduaneros. De acuerdo con la autoridad portuaria, la medida busca reducir en un treinta por ciento los tiempos de espera del autotransporte de carga que conecta el Golfo con el corredor industrial del Bajío. Al mismo tiempo, las agencias aduanales deberán remitir los manifiestos digitales con seis horas de anticipación para evitar cuellos de botella en las garitas de salida.',
    keyVocabulary: [
      {term: 'sellos aduaneros', english: 'customs seals'},
      {term: 'autotransporte de carga', english: 'freight trucking'},
      {term: 'manifiestos digitales', english: 'digital cargo manifests'},
      {term: 'garitas de salida', english: 'exit checkpoints'},
    ],
  },
  'pt-seed-politics-05': {
    studyExcerpt:
      'Durante debate em São Paulo, tributaristas e prefeitos divergiram sobre os efeitos da transição para a cobrança do imposto no destino prevista na reforma tributária. Os defensores da mudança sustentam que o novo modelo elimina a guerra fiscal entre municípios e favorece cidades mais populosas com menor base industrial. Por outro lado, gestores de polos de serviços argumentam que o período de compensação pode se mostrar insuficiente caso a arrecadação caia mais rápido do que o previsto nos primeiros cinco anos.',
    keyVocabulary: [
      {term: 'imposto no destino', english: 'destination-based tax'},
      {term: 'guerra fiscal', english: 'tax competition / fiscal war'},
      {term: 'polos de serviços', english: 'service-sector hubs'},
      {term: 'arrecadação', english: 'tax revenue collection'},
    ],
  },
  'pt-seed-culture-06': {
    studyExcerpt:
      'Quatro bibliotecas comunitárias da Região Metropolitana do Recife passaram a funcionar até as vinte e uma horas de segunda a sexta-feira para atender moradores que estudam ou trabalham durante o dia. Além do empréstimo gratuito de livros didáticos e literatura regional, os espaços receberam novos computadores com acesso à internet e salas silenciosas para preparação de concursos públicos. A iniciativa conta com voluntários de universidades locais que oferecem oficinas de redação duas vezes por semana.',
    keyVocabulary: [
      {term: 'empréstimo gratuito', english: 'free lending'},
      {term: 'livros didáticos', english: 'textbooks'},
      {term: 'concursos públicos', english: 'civil service exams'},
      {term: 'oficinas de redação', english: 'writing workshops'},
    ],
  },
};

function normalizeForSourceMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Verifies that a verbatim or near-verbatim sourceQuote is genuinely grounded in sourceText.
 * Rejects hallucinated or unsupported quotes.
 */
export function isQuoteSupportedBySource(sourceQuote: string, sourceText: string): boolean {
  const normQuote = normalizeForSourceMatch(sourceQuote);
  const normSource = normalizeForSourceMatch(sourceText);
  if (normQuote.length < 6 || normSource.length < 10) return false;
  if (normSource.includes(normQuote)) return true;

  // Token-overlap check for minor punctuation/inflection differences:
  // require at least 2 meaningful tokens (>= 4 chars) and >= 65% token presence in source.
  const quoteTokens = normQuote.split(' ').filter((w) => w.length >= 4);
  if (quoteTokens.length < 2) return false;
  const sourceWordSet = new Set(normSource.split(' ').filter((w) => w.length >= 3));
  let hits = 0;
  for (const token of quoteTokens) {
    if (sourceWordSet.has(token) || normSource.includes(token)) {
      hits += 1;
    }
  }
  return hits >= 2 && hits / quoteTokens.length >= 0.65;
}

export interface DlptValidationOutcome {
  validQuestions: BriefDrillQuestion[];
  rejectedCount: number;
  rejectionReasons: string[];
}

/**
 * Strictly validates generated DLPT items against the Phase 6 schema and source grounding rules.
 * Any malformed item, missing trap tag, or item whose correct answer is unsupported by sourceText is rejected.
 */
export function validateDlptQuestions(
  rawQuestions: unknown,
  sourceText: string,
  maxCount: number,
  briefId: string
): DlptValidationOutcome {
  if (!Array.isArray(rawQuestions)) {
    return {validQuestions: [], rejectedCount: 1, rejectionReasons: ['questions is not an array']};
  }

  const validQuestions: BriefDrillQuestion[] = [];
  const rejectionReasons: string[] = [];

  for (let idx = 0; idx < rawQuestions.length; idx++) {
    const raw = rawQuestions[idx] as Record<string, unknown> | null | undefined;
    if (!raw || typeof raw !== 'object') {
      rejectionReasons.push(`item ${idx}: not an object`);
      continue;
    }

    const stem = String(raw.questionEnglish ?? raw.question ?? '').trim();
    if (stem.length < 8) {
      rejectionReasons.push(`item ${idx}: stem too short`);
      continue;
    }

    const qType = raw.questionType;
    if (!isDlptQuestionType(qType)) {
      rejectionReasons.push(`item ${idx}: invalid questionType "${String(qType)}"`);
      continue;
    }

    const rawChoices = Array.isArray(raw.choices) ? raw.choices : null;
    if (!rawChoices || rawChoices.length !== 4) {
      rejectionReasons.push(`item ${idx}: must have exactly 4 choices`);
      continue;
    }

    const correctIndex = typeof raw.correctIndex === 'number' ? raw.correctIndex : -1;
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
      rejectionReasons.push(`item ${idx}: invalid correctIndex "${String(raw.correctIndex)}"`);
      continue;
    }

    const sourceQuote = String(raw.sourceQuote ?? '').trim();
    if (!isQuoteSupportedBySource(sourceQuote, sourceText)) {
      rejectionReasons.push(`item ${idx}: sourceQuote not supported by passage`);
      continue;
    }

    const parsedChoices: DlptChoiceDetail[] = [];
    const seenChoiceTexts = new Set<string>();
    let choiceError: string | null = null;

    for (let cIdx = 0; cIdx < 4; cIdx++) {
      const c = rawChoices[cIdx] as Record<string, unknown> | null | undefined;
      if (!c || typeof c !== 'object') {
        choiceError = `choice ${cIdx} is not an object`;
        break;
      }
      const text = String(c.text ?? '').trim();
      const justification = String(c.justification ?? '').trim();
      if (text.length < 2) {
        choiceError = `choice ${cIdx} text is empty`;
        break;
      }
      const normText = text.toLowerCase();
      if (seenChoiceTexts.has(normText)) {
        choiceError = `duplicate choice text at ${cIdx}`;
        break;
      }
      seenChoiceTexts.add(normText);

      if (justification.length < 10) {
        choiceError = `choice ${cIdx} justification too short`;
        break;
      }

      const isCorrect = cIdx === correctIndex;
      if (isCorrect) {
        parsedChoices.push({
          label: CHOICE_LETTERS[cIdx],
          text,
          isCorrect: true,
          justification,
          trapType: null,
        });
      } else {
        const rawTrap = c.trapType;
        if (!isDlptTrapType(rawTrap)) {
          choiceError = `wrong choice ${cIdx} missing valid trapType ("${String(rawTrap)}")`;
          break;
        }
        parsedChoices.push({
          label: CHOICE_LETTERS[cIdx],
          text,
          isCorrect: false,
          justification,
          trapType: rawTrap as DlptTrapType,
        });
      }
    }

    if (choiceError) {
      rejectionReasons.push(`item ${idx}: ${choiceError}`);
      continue;
    }

    const correctJustification = parsedChoices[correctIndex].justification;
    const targetVocabulary = Array.isArray(raw.targetVocabulary)
      ? raw.targetVocabulary
          .filter((v): v is {term: unknown; english: unknown} => Boolean(v) && typeof v === 'object')
          .map((v) => ({
            term: String(v.term ?? '').trim(),
            english: String(v.english ?? '').trim(),
          }))
          .filter((v) => v.term.length > 0 && v.english.length > 0)
          .slice(0, 4)
      : [];

    validQuestions.push({
      id: `q-${briefId}-${validQuestions.length + 1}`,
      question: stem,
      questionEnglish: stem,
      questionType: qType as DlptQuestionType,
      options: parsedChoices.map((c) => c.text),
      correctIndex,
      choices: parsedChoices,
      sourceQuote,
      explanation: correctJustification,
      rationaleEnglish: correctJustification,
      targetVocabulary,
    });

    if (validQuestions.length >= maxCount) break;
  }

  return {
    validQuestions,
    rejectedCount: rejectionReasons.length,
    rejectionReasons,
  };
}

export class BriefService {
  private cache = new Map<string, StoredBriefItem>();
  private lastRefreshedAt: string = new Date().toISOString();
  private sources: SourceFeedConfig[] = [];

  constructor() {
    this.initSeedData();
    this.loadSourcesConfig();
  }

  private initSeedData(): void {
    for (const seed of SEED_BRIEF_ITEMS) {
      const ext = SEED_EXTENDED_DATA[seed.id];
      const stored: StoredBriefItem = {
        ...seed,
        studyExcerpt: ext?.studyExcerpt || seed.summary,
        transcript: seed.mediaType === 'audio' ? ext?.studyExcerpt : undefined,
        rawContent: seed.mediaType === 'text' ? ext?.studyExcerpt : undefined,
        keyVocabulary: ext?.keyVocabulary || [],
      };
      this.cache.set(seed.id, stored);
    }
  }

  private loadSourcesConfig(): void {
    try {
      const configPath = path.resolve(process.cwd(), 'server', 'sources.json');
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.sources = parsed.filter(
            (s) =>
              typeof s?.id === 'string' &&
              typeof s?.name === 'string' &&
              typeof s?.url === 'string' &&
              (s.language === 'es' || s.language === 'pt') &&
              (s.mediaType === 'audio' || s.mediaType === 'text')
          );
        }
      }
    } catch {
      this.sources = [];
    }
  }

  public getSources(): readonly SourceFeedConfig[] {
    return this.sources;
  }

  public getLastRefreshedAt(): string {
    return this.lastRefreshedAt;
  }

  public isSafeFeedUrl(urlString: string): boolean {
    try {
      const u = new URL(urlString);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;

      const hostname = u.hostname.toLowerCase();
      // Block localhost, link-local, loopbacks, internal domains
      if (
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal') ||
        hostname === '127.0.0.1' ||
        hostname === '0.0.0.0' ||
        hostname === '::1' ||
        hostname === '169.254.169.254' // Cloud instance metadata!
      ) {
        return false;
      }

      // Block placeholder domains explicitly to save network timeouts
      if (
        hostname === 'example.com' ||
        hostname === 'example.org' ||
        hostname === 'example.net' ||
        hostname.includes('placeholder')
      ) {
        return false;
      }

      // Check IPv4 private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8)
      const ipParts = hostname.split('.').map(Number);
      if (ipParts.length === 4 && ipParts.every((p) => !Number.isNaN(p) && p >= 0 && p <= 255)) {
        const [a, b] = ipParts;
        if (
          a === 127 ||
          a === 10 ||
          (a === 172 && b >= 16 && b <= 31) ||
          (a === 192 && b === 168) ||
          (a === 169 && b === 254)
        ) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  public hashUrl(url: string): string {
    return crypto.createHash('sha256').update(url.trim()).digest('hex');
  }

  public getFeed(options: Parameters<typeof filterBriefItems>[1]): {items: BriefItem[]; lastRefreshedAt: string} {
    const allItems = Array.from(this.cache.values());
    const filtered = filterBriefItems(allItems, options);
    // Sort by publication date descending
    filtered.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

    // Scrub internal server-only properties for client feed safety
    const publicItems: BriefItem[] = filtered.map((item) => ({
      id: item.id,
      title: item.title,
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl,
      audioUrl: item.audioUrl,
      mediaType: item.mediaType,
      language: item.language,
      dialectId: item.dialectId,
      publishedAt: item.publishedAt,
      ilrLevel: item.ilrLevel,
      topic: item.topic,
      orientationLine: item.orientationLine,
      summary: item.summary,
      matchingDomains: item.matchingDomains,
      estimatedMinutes: item.estimatedMinutes,
      lengthLabel: item.lengthLabel,
    }));

    return {
      items: publicItems,
      lastRefreshedAt: this.lastRefreshedAt,
    };
  }

  public getItemById(id: string): StoredBriefItem | undefined {
    return this.cache.get(id);
  }

  public getStudyExcerpt(id: string): {
    briefId: string;
    title: string;
    orientationLine: string;
    sourceUrl: string;
    excerpt: string;
    keyVocabulary: {term: string; english: string}[];
  } | null {
    const item = this.cache.get(id);
    if (!item) return null;

    const excerpt = item.studyExcerpt || item.summary;
    return {
      briefId: item.id,
      title: item.title,
      orientationLine: item.orientationLine,
      sourceUrl: item.sourceUrl,
      excerpt,
      keyVocabulary: item.keyVocabulary || [],
    };
  }

  /**
   * Generates strict DLPT-format multiple-choice questions for a cached brief item.
   * Caps count by language and skill: Listening <= 3; Reading ES <= 5, PT <= 4.
   * Strictly validates schema, trap types, justifications, and source-quote grounding.
   */
  public async generateDrill(briefId: string, generate: GenerateStructured): Promise<BriefDrill> {
    const item = this.cache.get(briefId);
    if (!item) {
      throw new UserFacingError(404, `Brief item "${briefId}" not found.`);
    }

    const maxQuestions = getMaxQuestionsForPassage(item.language, item.mediaType);
    const passageText = item.transcript || item.rawContent || item.studyExcerpt || item.summary;
    const skillLabel = item.mediaType === 'audio' ? 'Listening' : 'Reading';

    const prompt = `You are a senior Defense Language Proficiency Test (DLPT5) item writer creating authentic ${skillLabel} comprehension items in English for an ILR Level ${item.ilrLevel} ${item.language === 'es' ? 'Spanish' : 'Portuguese'} passage.

ORIENTATION LINE:
${item.orientationLine}

SOURCE PASSAGE (target language):
${passageText}

STRICT DLPT5 ITEM REQUIREMENTS:
1. Write exactly ${maxQuestions} questions in English (${item.mediaType === 'audio' ? 'listening: up to 3' : item.language === 'es' ? 'Spanish reading: up to 5' : 'Portuguese reading: up to 4'}).
2. Mix question types across the set using ONLY these enum values for questionType:
   - "main_idea"
   - "detail"
   - "inference"
   - "vocabulary_in_context"
   - "speaker_attitude"
3. Mix complete English questions and DLPT-style incomplete statements (e.g., "According to the speaker, the new measure is primarily intended to...").
4. Each question MUST have:
   - "choices": an array of EXACTLY 4 distinct English choices (index 0=A, 1=B, 2=C, 3=D).
   - "correctIndex": integer 0, 1, 2, or 3 identifying the ONE choice unambiguously supported by the source passage.
   - "sourceQuote": an EXACT verbatim phrase (5 to 20 words) copied word-for-word from the SOURCE PASSAGE above that proves the correct answer. Never paraphrase or invent words not in the passage.
   - For EVERY choice in "choices":
     * "text": the English option text.
     * "justification": 1-2 crisp sentences in English referencing/quoting the source passage explaining why it is correct OR why it is a trap.
     * "trapType": for the ONE correct choice set "none"; for EACH of the 3 wrong choices pick the most accurate distractor tag from:
       - "mentioned_not_answer"
       - "not_in_passage"
       - "true_not_answer"
       - "wrong_detail"
       - "over_inference"
   - "targetVocabulary": 1 to 3 key target-language terms from the passage central to this question, with English glosses.
5. Never write a question whose correct answer relies on outside world knowledge not stated or clearly implied in the source passage.`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        orientationLine: {type: Type.STRING},
        questions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              questionEnglish: {type: Type.STRING},
              questionType: {type: Type.STRING},
              correctIndex: {type: Type.INTEGER},
              sourceQuote: {type: Type.STRING},
              choices: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: {type: Type.STRING},
                    justification: {type: Type.STRING},
                    trapType: {type: Type.STRING},
                  },
                  required: ['text', 'justification', 'trapType'],
                },
              },
              targetVocabulary: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    term: {type: Type.STRING},
                    english: {type: Type.STRING},
                  },
                  required: ['term', 'english'],
                },
              },
            },
            required: ['questionEnglish', 'questionType', 'correctIndex', 'sourceQuote', 'choices', 'targetVocabulary'],
          },
        },
      },
      required: ['questions'],
    };

    const response = await generate({
      model: MODELS.standard,
      contents: prompt,
      thinkingLevel: ThinkingLevel.LOW,
      responseSchema: schema,
      emptyMessage: 'Could not generate DLPT questions for this passage.',
      budget: BUDGETS.standard,
    });

    const validation = validateDlptQuestions(response.questions, passageText, maxQuestions, item.id);
    if (validation.validQuestions.length === 0) {
      throw new UserFacingError(
        502,
        'Generated DLPT items failed strict source-support verification. Please retry to generate a verified set.'
      );
    }

    const orientation =
      typeof response.orientationLine === 'string' && response.orientationLine.trim().length >= 12
        ? response.orientationLine.trim()
        : item.orientationLine;

    return {
      briefId: item.id,
      language: item.language,
      dialectId: item.dialectId,
      mediaType: item.mediaType,
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl,
      audioUrl: item.audioUrl,
      targetIlrLevel: item.ilrLevel,
      ilrLevel: item.ilrLevel,
      title: item.title,
      orientationLine: orientation,
      questions: validation.validQuestions,
      studyExcerpt: item.studyExcerpt || item.summary,
    };
  }

  /**
   * Grades a learner's 3-sentence English gist against the server-side source transcript.
   * Highlights additions (unsupported claims not in the source) as the highest-severity fidelity error.
   */
  public async gradeGist(briefId: string, summary: string, generate: GenerateStructured): Promise<GistGradeResult> {
    const item = this.cache.get(briefId);
    if (!item) {
      throw new UserFacingError(404, `Brief item "${briefId}" not found.`);
    }

    const transcript = item.transcript || item.studyExcerpt || item.rawContent || item.summary;
    const cleanedSummary = summary.trim();
    const fallbackQuote = transcript.split(/(?<=[.!?])\s+/)[0]?.slice(0, 140) || transcript.slice(0, 140);

    // Deterministic result when auto-submitted empty at 0:00
    if (cleanedSummary.length === 0) {
      return {
        briefId: item.id,
        mainPoint: 'missed',
        keyDetails: {
          found: 0,
          total: 3,
          missing: ['Main topic and core actors', 'Key event or action reported', 'Outcome or operational context'],
        },
        additions: [],
        omissions: [
          {
            description:
              'No summary was entered before the 60-second timer expired, so the main point and key details were omitted.',
            sourceQuote: fallbackQuote,
          },
        ],
        distortions: [],
        modelGist: item.summary,
        studyExcerpt: item.studyExcerpt || transcript,
      };
    }

    const prompt = `You are a senior intelligence & foreign-language fidelity grader evaluating a learner's English gist summary against a ${item.language === 'es' ? 'Spanish' : 'Portuguese'} audio broadcast transcript (ILR Level ${item.ilrLevel}).

ORIENTATION LINE:
${item.orientationLine}

SOURCE TRANSCRIPT (ground truth):
${transcript}

LEARNER'S ENGLISH SUMMARY:
${cleanedSummary}

GRADING RULES (STRICT FIDELITY):
1. mainPoint: "captured" if the core message is accurate, "partial" if incomplete or unfocused, "missed" if absent or wrong.
2. keyDetails: identify 3 to 5 essential concrete details from the transcript (total), count how many the learner accurately included (found <= total), and list concise descriptions of any missing details in missing[].
3. additions[] (MOST SERIOUS ERROR): list EVERY claim, fact, actor, number, motive, or conclusion the learner stated that is NOT supported by the source transcript.
   - For each addition, include:
     * "description": concise 1-sentence explanation of what was added without source support.
     * "learnerSpan": the EXACT verbatim phrase copied word-for-word from LEARNER'S ENGLISH SUMMARY containing the unsupported addition so it can be highlighted.
     * "sourceQuote": a short verbatim quote (5-20 words) from SOURCE TRANSCRIPT showing what the source actually focused on (or closest relevant line).
4. omissions[]: list important facts from the source transcript left out of the learner's summary, each with "description" and a short verbatim "sourceQuote" from SOURCE TRANSCRIPT.
5. distortions[]: list facts from the source transcript that the learner misstated (wrong number, actor, location, polarity, or cause), each with "description", exact "learnerSpan" from the learner's text, and short verbatim "sourceQuote" from SOURCE TRANSCRIPT.
6. If there are no errors in a category, return an empty array [] for that category. Never invent fake errors when the summary is faithful.
7. modelGist: write an ideal, strictly faithful 3-sentence English gist covering only what is stated in the source transcript.`;

    const findingSchema = {
      type: Type.OBJECT,
      properties: {
        description: {type: Type.STRING},
        learnerSpan: {type: Type.STRING},
        sourceQuote: {type: Type.STRING},
      },
      required: ['description', 'sourceQuote'],
    };

    const schema = {
      type: Type.OBJECT,
      properties: {
        mainPoint: {type: Type.STRING},
        keyDetails: {
          type: Type.OBJECT,
          properties: {
            found: {type: Type.INTEGER},
            total: {type: Type.INTEGER},
            missing: {type: Type.ARRAY, items: {type: Type.STRING}},
          },
          required: ['found', 'total', 'missing'],
        },
        additions: {type: Type.ARRAY, items: findingSchema},
        omissions: {type: Type.ARRAY, items: findingSchema},
        distortions: {type: Type.ARRAY, items: findingSchema},
        modelGist: {type: Type.STRING},
      },
      required: ['mainPoint', 'keyDetails', 'additions', 'omissions', 'distortions', 'modelGist'],
    };

    const response = await generate({
      model: MODELS.standard,
      contents: prompt,
      thinkingLevel: ThinkingLevel.LOW,
      responseSchema: schema,
      emptyMessage: 'Could not grade the gist summary right now.',
      budget: BUDGETS.standard,
    });

    const mainPoint: GistMainPointRating = isGistMainPointRating(response.mainPoint) ? response.mainPoint : 'partial';

    const rawDetails =
      response.keyDetails && typeof response.keyDetails === 'object'
        ? (response.keyDetails as Record<string, unknown>)
        : {};
    const total = Math.max(1, Math.min(8, Math.round(Number(rawDetails.total) || 3)));
    const found = Math.max(0, Math.min(total, Math.round(Number(rawDetails.found) || 0)));
    const missing = Array.isArray(rawDetails.missing)
      ? rawDetails.missing
          .map((m) => String(m ?? '').trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];

    const sanitizeFindings = (rawList: unknown, includeLearnerSpan: boolean): GistFinding[] => {
      if (!Array.isArray(rawList)) return [];
      const out: GistFinding[] = [];
      for (const entry of rawList.slice(0, 6)) {
        if (!entry || typeof entry !== 'object') continue;
        const rec = entry as Record<string, unknown>;
        const description = String(rec.description ?? '').trim();
        if (!description) continue;
        const sourceQuote = String(rec.sourceQuote ?? '').trim() || fallbackQuote;
        const rawSpan = includeLearnerSpan ? String(rec.learnerSpan ?? '').trim() : '';
        out.push({
          description,
          sourceQuote,
          ...(rawSpan ? {learnerSpan: rawSpan} : {}),
        });
      }
      return out;
    };

    const additions = sanitizeFindings(response.additions, true);
    const omissions = sanitizeFindings(response.omissions, false);
    const distortions = sanitizeFindings(response.distortions, true);
    const modelGist =
      typeof response.modelGist === 'string' && response.modelGist.trim().length >= 15
        ? response.modelGist.trim()
        : item.summary;

    const rawErrors = [
      ...additions.map((f) => ({
        key: 'addition',
        wrong: f.learnerSpan || f.description,
        fix: `Remove unsupported claim — source states: "${f.sourceQuote}"`,
        quote: f.sourceQuote,
      })),
      ...omissions.map((f) => ({
        key: 'omission',
        wrong: `Omitted: ${f.description}`,
        fix: `Include key fact: "${f.sourceQuote}"`,
        quote: f.sourceQuote,
      })),
      ...distortions.map((f) => ({
        key: 'distortion',
        wrong: f.learnerSpan || f.description,
        fix: `Align with source: "${f.sourceQuote}"`,
        quote: f.sourceQuote,
      })),
    ];

    const errors = extractReportedErrors(rawErrors, item.language, 12);

    return {
      briefId: item.id,
      mainPoint,
      keyDetails: {found, total, missing},
      additions,
      omissions,
      distortions,
      modelGist,
      studyExcerpt: item.studyExcerpt || transcript,
      errors,
    };
  }

  /**
   * Refreshes feeds from safe open-source RSS/Atom sources.
   */
  public async refreshFeeds(generate?: GenerateStructured): Promise<{fetchedCount: number; newItemsCount: number}> {
    let fetchedCount = 0;
    let newItemsCount = 0;

    for (const source of this.sources) {
      if (!this.isSafeFeedUrl(source.url)) {
        continue;
      }

      try {
        const items = await this.fetchFeedItems(source);
        fetchedCount += items.length;

        for (const rawItem of items.slice(0, 3)) {
          // Process at most top 3 newest per feed
          const hashId = `${source.language}-${source.mediaType}-${this.hashUrl(rawItem.link).slice(0, 16)}`;
          if (this.cache.has(hashId)) {
            continue; // Already processed once!
          }

          const analyzed = await this.analyzeItem(rawItem, source, hashId, generate);
          if (analyzed) {
            this.cache.set(hashId, analyzed);
            newItemsCount++;
          }
        }
      } catch {
        // Individual feed failure should never crash the refresh job
      }
    }

    this.pruneCache();
    this.lastRefreshedAt = new Date().toISOString();
    return {fetchedCount, newItemsCount};
  }

  private async fetchFeedItems(
    source: SourceFeedConfig
  ): Promise<{title: string; link: string; description: string; pubDate?: string; audioUrl?: string}[]> {
    const res = await fetch(source.url, {
      signal: AbortSignal.timeout(MAX_FEED_FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'LinguaForge/1.0 (RSS Aggregator; Educational)',
        Accept: 'application/rss+xml, application/atom+xml, text/xml, application/xml',
      },
    });

    if (!res.ok) return [];
    const xml = await res.text();
    return this.parseXmlFeed(xml, source.mediaType);
  }

  private parseXmlFeed(
    xml: string,
    mediaType: BriefMediaType
  ): {
    title: string;
    link: string;
    description: string;
    pubDate?: string;
    audioUrl?: string;
    durationSeconds?: number;
  }[] {
    const results: {
      title: string;
      link: string;
      description: string;
      pubDate?: string;
      audioUrl?: string;
      durationSeconds?: number;
    }[] = [];
    const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
    let match: RegExpExecArray | null;

    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const titleMatch = /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(block);
      const linkMatch =
        /<link[^>]*href=["']([^"']+)["']/i.exec(block) ||
        /<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i.exec(block);
      const descMatch =
        /<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i.exec(block) ||
        /<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/i.exec(block);
      const dateMatch =
        /<pubDate[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/pubDate>/i.exec(block) ||
        /<published[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/published>/i.exec(block) ||
        /<updated[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/updated>/i.exec(block);
      const encMatch = /<enclosure[^>]*url=["']([^"']+)["'][^>]*type=["']audio\/[^"']+["']/i.exec(block);
      const durMatch = /<itunes:duration[^>]*>([\s\S]*?)<\/itunes:duration>/i.exec(block);

      const title = this.stripHtml(titleMatch?.[1] || '').trim();
      const link = (linkMatch?.[1] || '').trim();
      const rawDescription = this.stripHtml(descMatch?.[1] || '').trim();
      const description = this.capWords(rawDescription, 500);
      const audioUrl = encMatch?.[1]?.trim();
      const durationSeconds = this.parseDurationSeconds(durMatch?.[1]);

      if (title && link) {
        if (mediaType === 'audio' && !audioUrl) {
          continue;
        }
        results.push({
          title,
          link,
          description,
          pubDate: dateMatch?.[1],
          audioUrl: audioUrl || (mediaType === 'audio' ? link : undefined),
          durationSeconds,
        });
      }
    }

    return results;
  }

  private capWords(text: string, maxWords: number): string {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return text;
    return `${words.slice(0, maxWords).join(' ')}…`;
  }

  private parseDurationSeconds(raw: string | undefined): number | undefined {
    if (!raw) return undefined;
    const cleaned = raw.trim();
    if (/^\d+$/.test(cleaned)) return Number(cleaned);
    const parts = cleaned.split(':').map(Number);
    if (parts.some((n) => Number.isNaN(n))) return undefined;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return undefined;
  }

  private stripHtml(raw: string): string {
    return raw
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async analyzeItem(
    raw: {
      title: string;
      link: string;
      description: string;
      pubDate?: string;
      audioUrl?: string;
      durationSeconds?: number;
    },
    source: SourceFeedConfig,
    id: string,
    generate?: GenerateStructured
  ): Promise<StoredBriefItem | null> {
    const isLongAudio =
      source.mediaType === 'audio' && typeof raw.durationSeconds === 'number' && raw.durationSeconds > 150;
    const baseEstimatedMins = isLongAudio
      ? 2
      : source.mediaType === 'audio' && typeof raw.durationSeconds === 'number'
        ? Math.max(1, Math.min(3, Math.round(raw.durationSeconds / 60)))
        : 2;

    if (!generate) {
      // Offline fallback item creation
      return {
        id,
        title: raw.title,
        sourceName: source.name,
        sourceUrl: raw.link,
        audioUrl: raw.audioUrl,
        mediaType: source.mediaType,
        language: source.language,
        dialectId: source.dialectId,
        publishedAt: raw.pubDate ? new Date(raw.pubDate).toISOString() : new Date().toISOString(),
        ilrLevel: '2+',
        topic: 'society',
        orientationLine: `This passage is from a ${source.language === 'es' ? 'Spanish' : 'Portuguese'} news source.`,
        summary: raw.description ? raw.description.slice(0, 200) : raw.title,
        matchingDomains: [],
        estimatedMinutes: baseEstimatedMins,
        lengthLabel: isLongAudio ? 'First ~2 min segment' : formatBriefLength(source.mediaType, baseEstimatedMins),
        studyExcerpt: raw.description.slice(0, 400),
      };
    }

    const prompt = `Analyze this authentic news item in ${source.language === 'es' ? 'Spanish' : 'Portuguese'} for language training.
Title: ${raw.title}
Source: ${source.name}
Description / Excerpt: ${raw.description}
Media Type: ${source.mediaType}${isLongAudio ? ' (longer than 2.5 min: focus only on the opening ~2 min segment)' : ''}

Produce a structured evaluation:
1. ilrLevel: Select one of '2', '2+', '3', '3+'. Level 2 = concrete facts & events; Level 3 = hypothesis, opinion, policy, abstract analysis.
2. topic: Select one of 'society', 'politics', 'economy', 'culture', 'scitech', 'security'.
3. orientationLine: An authentic DLPT-style English orientation line (e.g. "This passage is from a Chilean radio broadcast discussing environmental regulations.").
4. summary: A concise English summary of at most 2 sentences.
5. matchingDomains: Identify any applicable operational domains from: ['maritime_surveillance', 'aviation_logistics', 'c2_comms', 'delegation_hosting', 'general_policy']. If purely general news, return empty array [].
6. studyExcerpt: A short authentic target-language excerpt of ~150-250 words suitable for vocabulary lookup and reading/listening review.
7. keyVocabulary: 2 to 4 notable vocabulary items with English translations.
8. estimatedMinutes: Number of minutes (1 to 3).`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        ilrLevel: {type: Type.STRING},
        topic: {type: Type.STRING},
        orientationLine: {type: Type.STRING},
        summary: {type: Type.STRING},
        matchingDomains: {
          type: Type.ARRAY,
          items: {type: Type.STRING},
        },
        studyExcerpt: {type: Type.STRING},
        keyVocabulary: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              term: {type: Type.STRING},
              english: {type: Type.STRING},
            },
            required: ['term', 'english'],
          },
        },
        estimatedMinutes: {type: Type.INTEGER},
      },
      required: ['ilrLevel', 'topic', 'orientationLine', 'summary', 'studyExcerpt', 'estimatedMinutes'],
    };

    try {
      const result = await generate({
        model: MODELS.standard,
        contents: prompt,
        thinkingLevel: ThinkingLevel.LOW,
        responseSchema: schema,
        emptyMessage: 'Brief analysis failed.',
        budget: BUDGETS.standard,
      });

      const ilrLevel: BriefIlrLevel = isBriefIlrLevel(result.ilrLevel) ? result.ilrLevel : '2+';
      const topic: BriefTopic = isBriefTopic(result.topic) ? result.topic : 'society';
      const mins = isLongAudio ? 2 : Math.max(1, Math.min(3, Number(result.estimatedMinutes) || baseEstimatedMins));
      const domains = Array.isArray(result.matchingDomains)
        ? (result.matchingDomains.filter((d: unknown) =>
            [
              'maritime_surveillance',
              'aviation_logistics',
              'c2_comms',
              'delegation_hosting',
              'general_policy',
            ].includes(String(d))
          ) as MilitaryDomain[])
        : [];

      const excerptText = this.capWords(String(result.studyExcerpt || raw.description), 250);

      return {
        id,
        title: raw.title,
        sourceName: source.name,
        sourceUrl: raw.link,
        audioUrl: raw.audioUrl,
        mediaType: source.mediaType,
        language: source.language,
        dialectId: source.dialectId,
        publishedAt: raw.pubDate ? new Date(raw.pubDate).toISOString() : new Date().toISOString(),
        ilrLevel,
        topic,
        orientationLine: String(result.orientationLine || `This passage is from a ${source.name} segment.`),
        summary: String(result.summary || raw.description.slice(0, 200)),
        matchingDomains: domains,
        estimatedMinutes: mins,
        lengthLabel: isLongAudio ? 'First ~2 min segment' : formatBriefLength(source.mediaType, mins),
        studyExcerpt: excerptText,
        transcript: source.mediaType === 'audio' ? excerptText : undefined,
        rawContent: source.mediaType === 'text' ? excerptText : undefined,
        keyVocabulary: Array.isArray(result.keyVocabulary)
          ? result.keyVocabulary.map((v: any) => ({
              term: String(v?.term || ''),
              english: String(v?.english || ''),
            }))
          : [],
      };
    } catch {
      return null;
    }
  }

  private pruneCache(): void {
    if (this.cache.size <= MAX_CACHE_SIZE) return;
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => new Date(b[1].publishedAt).getTime() - new Date(a[1].publishedAt).getTime());
    // Keep top MAX_CACHE_SIZE
    const toKeep = new Set(entries.slice(0, MAX_CACHE_SIZE).map((e) => e[0]));
    for (const id of this.cache.keys()) {
      if (!toKeep.has(id)) {
        this.cache.delete(id);
      }
    }
  }
}

export const globalBriefService = new BriefService();
