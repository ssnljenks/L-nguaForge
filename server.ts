import 'dotenv/config';
import express, {type NextFunction, type Request, type RequestHandler, type Response} from 'express';
import {rateLimit} from 'express-rate-limit';
import helmet from 'helmet';
import http, {type IncomingMessage} from 'http';
import path from 'path';
import {fileURLToPath} from 'url';
import {GoogleGenAI, LiveServerMessage, Modality, ThinkingLevel, Type} from '@google/genai';
import {WebSocket, WebSocketServer} from 'ws';
import {getDialectInfo, getDomainInfo} from './src/utils/ilrLogic.ts';
import type {MilitaryDomain} from './src/types.ts';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

const GEMINI_MODEL = 'gemini-3.8-flash';
const GEMINI_CHAT_MODEL = 'gemini-4-hydrogen';
const GEMINI_FAST_LOOKUP_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_LIVE_MODEL = 'gemini-3.8-live';
const VALID_LIVE_VOICES = ['Zephyr', 'Puck', 'Kore', 'Fenrir', 'Charon'] as const;
const VALID_VOCAB_CATEGORIES = [
  'High-Register Connectors',
  'Operational/Military Terms',
  'Regional Idioms',
  'False Friends',
];

// ---------------------------------------------------------------------------
// Runtime configuration (all optional; see .env.example)
// ---------------------------------------------------------------------------

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function readPositiveInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback;
}

/** Number of reverse-proxy hops in front of this server (Cloud Run = 1). 0 = trust no X-Forwarded-* headers. */
const TRUST_PROXY_HOPS = readPositiveInt('TRUST_PROXY', 1);
const API_RATE_LIMIT_PER_MINUTE = readPositiveInt('API_RATE_LIMIT_PER_MINUTE', 40);
const MAX_LIVE_SESSIONS = readPositiveInt('MAX_LIVE_SESSIONS', 20);
const MAX_LIVE_SESSIONS_PER_IP = readPositiveInt('MAX_LIVE_SESSIONS_PER_IP', 2);
const MAX_LIVE_SESSION_MINUTES = readPositiveInt('MAX_LIVE_SESSION_MINUTES', 15);
const LIVE_WS_MAX_PAYLOAD_BYTES = 128 * 1024;

function parseHostList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      try {
        return [new URL(entry).host];
      } catch {
        return [];
      }
    });
}

/** Extra browser origins allowed to open /ws/live, besides the server's own host. */
const EXTRA_ALLOWED_HOSTS = parseHostList(`${process.env.APP_URL ?? ''},${process.env.ALLOWED_ORIGINS ?? ''}`);

/** CSP frame-ancestors (production only). AI Studio embeds the app in an iframe. */
const FRAME_ANCESTORS = (process.env.FRAME_ANCESTORS ?? "'self' https://aistudio.google.com")
  .split(/[,\s]+/)
  .filter(Boolean);

// ---------------------------------------------------------------------------
// Gemini clients
// ---------------------------------------------------------------------------

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new UserFacingError(
      503,
      'GEMINI_API_KEY is not configured on the server. Configure it in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getLiveAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new UserFacingError(
      503,
      'GEMINI_API_KEY is not configured on the server. Configure it in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

function sanitizeString(val: unknown, maxLen = 4000): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function sanitizeStringArray(val: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .map((item) => sanitizeString(item, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function clampNumber(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampScore(val: unknown): number {
  return clampNumber(val, 0, 100, 0);
}

function validateLanguage(val: unknown): 'es' | 'pt' {
  return val === 'pt' ? 'pt' : 'es';
}

/**
 * Resolves language/dialect/domain from client-supplied IDs into server-owned labels.
 * Free-text labels from the client are never interpolated into prompts.
 */
function resolveTrainingContext(source: Record<string, unknown> | undefined) {
  const language = validateLanguage(source?.language);
  const dialect = getDialectInfo(language, typeof source?.dialect === 'string' ? source.dialect : '');
  const domain = getDomainInfo((typeof source?.domain === 'string' ? source.domain : '') as MilitaryDomain);
  return {
    language,
    langName: language === 'es' ? 'Spanish' : 'Portuguese',
    dialectId: dialect.id,
    dialectLabel: dialect.label,
    domainId: domain.id,
    domainLabel: domain.label,
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** An error whose message is safe to show to end users. */
class UserFacingError extends Error {
  readonly status: number;
  constructor(status: number, message: string, options?: {cause?: unknown}) {
    super(message, options);
    this.name = 'UserFacingError';
    this.status = status;
  }
}

function parseJsonSafe<T>(raw: string | undefined, fallbackError: string): T {
  const cleaned = (raw ?? '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  if (!cleaned) {
    throw new UserFacingError(502, fallbackError);
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    throw new UserFacingError(502, 'The AI returned an unreadable response. Please try again.', {cause: err});
  }
}

function formatGeminiError(err: unknown): {status: number; message: string} {
  if (err instanceof UserFacingError) {
    return {status: err.status, message: err.message};
  }
  const rawObj = err && typeof err === 'object' ? (err as {message?: unknown; error?: {message?: unknown}}) : null;
  const msg =
    err instanceof Error
      ? err.message
      : typeof rawObj?.message === 'string'
        ? rawObj.message
        : typeof rawObj?.error?.message === 'string'
          ? rawObj.error.message
          : 'Unexpected server error';
  if (
    msg.includes('403') ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('API_KEY_INVALID') ||
    msg.includes('API key not valid')
  ) {
    console.error('[gemini] authentication failed:', msg);
    return {
      status: 403,
      message: 'Gemini API authentication failed. Verify your API key in Settings > Secrets.',
    };
  }
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message: 'Gemini API rate limit reached. Please wait a moment and try again.',
    };
  }
  if (msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand')) {
    return {
      status: 503,
      message: 'Gemini is experiencing a brief demand spike. Please tap Send again in a moment.',
    };
  }
  if (msg.includes('404') || msg.includes('NOT_FOUND')) {
    console.error('[gemini] model not found:', msg);
    return {
      status: 502,
      message: 'The configured AI model is unavailable right now. Please try again later.',
    };
  }
  // Unknown failure: keep details in server logs, never in the response.
  console.error('[server] unexpected error:', err);
  return {status: 500, message: 'Something went wrong on the server. Please try again.'};
}

/** Wraps an async Express handler so every rejection becomes a sanitized JSON error response. */
function handleAsync(handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req: Request, res: Response, _next: NextFunction) => {
    handler(req, res).catch((err: unknown) => {
      const {status, message} = formatGeminiError(err);
      if (!res.headersSent) {
        res.status(status).json({error: message});
      }
    });
  };
}

async function withTransientRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand')) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return await fn();
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Client identity & WebSocket origin checks
// ---------------------------------------------------------------------------

function firstHeaderValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : (value ?? '')).split(',')[0].trim();
}

/** Mirrors Express's `trust proxy = <hops>` behaviour for raw upgrade requests. */
function getClientIp(req: IncomingMessage): string {
  const socketIp = req.socket.remoteAddress ?? 'unknown';
  if (TRUST_PROXY_HOPS <= 0) return socketIp;
  const forwarded = (
    Array.isArray(req.headers['x-forwarded-for'])
      ? req.headers['x-forwarded-for'].join(',')
      : (req.headers['x-forwarded-for'] ?? '')
  )
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
  const chain = [...forwarded, socketIp];
  return chain[Math.max(0, chain.length - 1 - TRUST_PROXY_HOPS)] ?? socketIp;
}

function isAllowedWebSocketOrigin(req: IncomingMessage): boolean {
  const origin = firstHeaderValue(req.headers.origin);
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const allowed = new Set<string>(EXTRA_ALLOWED_HOSTS);
  const host = firstHeaderValue(req.headers.host);
  if (host) allowed.add(host);
  if (TRUST_PROXY_HOPS > 0) {
    const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host']);
    if (forwardedHost) allowed.add(forwardedHost);
  }
  return allowed.has(originHost);
}

function rejectUpgrade(socket: import('stream').Duplex, statusCode: number, statusText: string) {
  socket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

async function startServer() {
  const app = express();
  app.set('trust proxy', TRUST_PROXY_HOPS);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Vite's dev server injects inline scripts, so the CSP is enforced in production builds only.
      contentSecurityPolicy: IS_PRODUCTION
        ? {
            useDefaults: true,
            directives: {
              'default-src': ["'self'"],
              'script-src': ["'self'"],
              'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
              'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
              'img-src': ["'self'", 'data:', 'blob:'],
              'media-src': ["'self'", 'blob:'],
              // 'self' covers same-origin ws:/wss: for /ws/live; font hosts are fetched by the service worker.
              'connect-src': ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
              'worker-src': ["'self'"],
              'manifest-src': ["'self'"],
              'frame-ancestors': FRAME_ANCESTORS,
              'upgrade-insecure-requests': null,
            },
          }
        : false,
      // Framing is governed by CSP frame-ancestors (X-Frame-Options cannot allow-list AI Studio).
      frameguard: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(express.json({limit: '1mb'}));

  app.get('/api/health', (_req, res) => {
    res.json({ok: true});
  });

  // Every Gemini-backed endpoint is rate limited per client IP to protect the API key's quota.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: API_RATE_LIMIT_PER_MINUTE,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {error: 'Too many requests. Please wait a minute and try again.'},
    })
  );

  // 1. Live OPI Examiner Turn (ThinkingLevel.LOW)
  app.post(
    '/api/opi/turn',
    handleAsync(async (req, res) => {
      const {langName, dialectLabel, domainLabel} = resolveTrainingContext(req.body);
      const probeLevel = req.body?.probeLevel === 'level_3_probe' ? 'level_3_probe' : 'level_2_baseline';
      const elapsedSeconds = clampNumber(req.body?.elapsedSeconds, 0, 24 * 60 * 60, 0);
      const history = Array.isArray(req.body?.history) ? req.body.history.slice(-14) : [];
      const userMessage = sanitizeString(req.body?.userMessage, 2500);
      const isOpening = Boolean(req.body?.isOpening);

      if (!isOpening && !userMessage) {
        return res.status(400).json({error: 'Candidate message is required.'});
      }
      const systemInstruction = `You are a certified senior ILR Oral Proficiency Interview (OPI) examiner conducting an operational interview strictly in ${langName} (${dialectLabel} dialect) within the domain: ${domainLabel}.
Keep your examiner turn concise (2–4 natural sentences), authentic to the chosen regional dialect, and strictly in ${langName} (no English explanations inside examinerText).

PROBING PROTOCOL:
- Current target probe level: ${probeLevel === 'level_3_probe' ? 'ILR LEVEL 3 PROBE' : 'ILR LEVEL 2 BASELINE'} (elapsed ${Math.round(elapsedSeconds)}s).
- In LEVEL 2 BASELINE: Ask concrete narrative, procedural, or factual questions about operations, roles, timelines, or recent events in the domain. If the candidate struggled on the prior turn, smoothly step down to stabilize fluency.
- In LEVEL 3 PROBE: Push into abstract defense/diplomatic policy, systemic root causes, competing institutional priorities, or hypothetical ("what if" / counterfactual) scenarios that naturally elicit the imperfect subjunctive and conditional.
- Return nextProbeLevel ("level_2_baseline" or "level_3_probe") and a brief English probeReason explaining why you stayed at or shifted to that level.`;

      const transcriptBlock = history
        .map(
          (m: {role?: string; text?: string}) =>
            `${m.role === 'examiner' ? 'EXAMINER' : 'CANDIDATE'}: ${sanitizeString(m.text, 1000)}`
        )
        .join('\n');

      const prompt = isOpening
        ? `Begin the ILR OPI interview now with a warm, professional Level 2 Baseline opening greeting and your first concrete operational question in ${langName} (${dialectLabel}) about ${domainLabel}.`
        : `Conversation so far:\n${transcriptBlock}\n\nCANDIDATE'S LATEST RESPONSE:\n${userMessage}\n\nRespond naturally as the OPI examiner in ${langName}, advancing or backing off the probe smoothly according to candidate performance.`;

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction,
          thinkingConfig: {thinkingLevel: ThinkingLevel.LOW},
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              examinerText: {type: Type.STRING},
              nextProbeLevel: {type: Type.STRING},
              probeReason: {type: Type.STRING},
            },
            required: ['examinerText', 'nextProbeLevel', 'probeReason'],
          },
        },
      });

      const data = parseJsonSafe<{examinerText: string; nextProbeLevel: string; probeReason: string}>(
        response.text,
        'Empty response from OPI examiner.'
      );

      const examinerText = sanitizeString(data.examinerText, 3000);
      if (!examinerText) {
        throw new UserFacingError(502, 'OPI examiner returned an empty response. Please try again.');
      }
      const resolvedProbe = data.nextProbeLevel === 'level_3_probe' ? 'level_3_probe' : 'level_2_baseline';
      res.json({
        examinerText,
        probeLevel: resolvedProbe,
        probeReason: sanitizeString(data.probeReason, 500),
      });
    })
  );

  // 3. Tap-to-Save Contextual Word/Phrase Lookup (ThinkingLevel.LOW)
  app.post(
    '/api/vocab/lookup',
    handleAsync(async (req, res) => {
      const {langName, dialectLabel} = resolveTrainingContext(req.body);
      const word = sanitizeString(req.body?.word, 120);
      const contextSentence = sanitizeString(req.body?.contextSentence, 1200);

      if (!word || !contextSentence) {
        return res.status(400).json({error: 'Word and context sentence are required.'});
      }
      const ai = getAiClient();
      const response = await withTransientRetry(() =>
        ai.models.generateContent({
          model: GEMINI_FAST_LOOKUP_MODEL,
          contents: `Explain the ${langName} (${dialectLabel}) word "${word}" in: "${contextSentence}".
Return concise contextual English meaning, crisp registerTag, 1-sentence grammarNote, and suggestedCategory ("High-Register Connectors", "Operational/Military Terms", "Regional Idioms", or "False Friends").`,
          config: {
            thinkingConfig: {thinkingLevel: ThinkingLevel.MINIMAL},
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                contextualMeaning: {type: Type.STRING},
                registerTag: {type: Type.STRING},
                grammarNote: {type: Type.STRING},
                suggestedCategory: {type: Type.STRING},
              },
              required: ['contextualMeaning', 'registerTag', 'grammarNote', 'suggestedCategory'],
            },
          },
        })
      );

      const data = parseJsonSafe<{
        contextualMeaning?: unknown;
        registerTag?: unknown;
        grammarNote?: unknown;
        suggestedCategory?: unknown;
      }>(response.text, 'Empty response from vocabulary lookup.');

      const contextualMeaning = sanitizeString(data.contextualMeaning, 400);
      if (!contextualMeaning) {
        throw new UserFacingError(502, 'Could not retrieve a definition for that word. Please try again.');
      }
      const rawCategory = sanitizeString(data.suggestedCategory, 80);
      const suggestedCategory = VALID_VOCAB_CATEGORIES.includes(rawCategory) ? rawCategory : 'Regional Idioms';

      res.json({
        word,
        contextualMeaning,
        registerTag: sanitizeString(data.registerTag, 80) || 'General Usage',
        grammarNote: sanitizeString(data.grammarNote, 400),
        suggestedCategory,
      });
    })
  );

  // 4. Tip-of-the-Tongue ("How do I say...?") Helper (ThinkingLevel.LOW)
  app.post(
    '/api/vocab/tot',
    handleAsync(async (req, res) => {
      const {langName, dialectLabel, domainLabel} = resolveTrainingContext(req.body);
      const englishQuery = sanitizeString(req.body?.englishQuery, 400);

      if (!englishQuery) {
        return res.status(400).json({error: 'Please enter the English phrase or concept you want to express.'});
      }
      const ai = getAiClient();
      const response = await withTransientRetry(() =>
        ai.models.generateContent({
          model: GEMINI_FAST_LOOKUP_MODEL,
          contents: `A military linguist targeting ILR 2+/3 in ${langName} (${dialectLabel}) within "${domainLabel}" needs a natural, high-register way to say:
"${englishQuery}"
Return the strongest idiomatic high-register target phrase, an optional formal diplomatic alternative, a concise register/grammar note (mentioning subjunctive triggers if relevant), a natural operational example sentence, and the best category from: "High-Register Connectors", "Operational/Military Terms", "Regional Idioms", or "False Friends".`,
          config: {
            thinkingConfig: {thinkingLevel: ThinkingLevel.MINIMAL},
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                targetPhrase: {type: Type.STRING},
                alternativeFormal: {type: Type.STRING},
                registerNote: {type: Type.STRING},
                exampleSentence: {type: Type.STRING},
                category: {type: Type.STRING},
              },
              required: ['targetPhrase', 'registerNote', 'exampleSentence', 'category'],
            },
          },
        })
      );

      const data = parseJsonSafe<Record<string, string>>(response.text, 'Empty response from TOT helper.');
      const targetPhrase = sanitizeString(data.targetPhrase, 300);
      if (!targetPhrase) {
        throw new UserFacingError(502, 'TOT helper returned an empty phrase. Please try again.');
      }
      res.json({
        targetPhrase,
        alternativeFormal: sanitizeString(data.alternativeFormal, 300),
        registerNote: sanitizeString(data.registerNote, 400),
        exampleSentence: sanitizeString(data.exampleSentence, 800),
        category: VALID_VOCAB_CATEGORIES.includes(data.category) ? data.category : 'High-Register Connectors',
      });
    })
  );

  // 5. Vocab Active-Recall Sentence Coach (ThinkingLevel.LOW)
  app.post(
    '/api/vocab/evaluate-sentence',
    handleAsync(async (req, res) => {
      const {langName, domainLabel} = resolveTrainingContext(req.body);
      const targetTerm = sanitizeString(req.body?.targetTerm, 150);
      const userSentence = sanitizeString(req.body?.userSentence, 800);

      if (!targetTerm || !userSentence) {
        return res.status(400).json({error: 'Target term and candidate sentence are required.'});
      }
      const ai = getAiClient();
      const response = await withTransientRetry(() =>
        ai.models.generateContent({
          model: GEMINI_CHAT_MODEL,
          contents: `Evaluate whether the linguist used the ${langName} expression "${targetTerm}" accurately and at an ILR 2+/3 operational register in this sentence (domain: ${domainLabel}):
"${userSentence}"
Be concise and tactical.`,
          config: {
            thinkingConfig: {thinkingLevel: ThinkingLevel.LOW},
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                isNatural: {type: Type.BOOLEAN},
                feedback: {type: Type.STRING},
                polishedVersion: {type: Type.STRING},
              },
              required: ['isNatural', 'feedback', 'polishedVersion'],
            },
          },
        })
      );

      const data = parseJsonSafe<Record<string, unknown>>(response.text, 'Empty response from sentence evaluator.');
      const feedback = sanitizeString(data.feedback, 1200);
      if (!feedback) {
        throw new UserFacingError(502, 'Sentence evaluator returned an empty response. Please try again.');
      }
      res.json({
        isNatural: data.isNatural === true,
        feedback,
        polishedVersion: sanitizeString(data.polishedVersion, 1200),
      });
    })
  );

  // 5. Post-Session ILR Debrief & Natural 2+ Rewriter (ThinkingLevel.MEDIUM)
  app.post(
    '/api/debrief/analyze',
    handleAsync(async (req, res) => {
      const {langName, dialectLabel, domainLabel} = resolveTrainingContext(req.body);
      const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-30) : [];

      const candidateUtterances = messages
        .filter(
          (m: {role?: string; text?: string}) => m.role === 'candidate' && typeof m.text === 'string' && m.text.trim()
        )
        .map((m: {text: string}) => sanitizeString(m.text, 1200));

      if (candidateUtterances.length === 0) {
        return res.status(400).json({error: 'No candidate speech found in this session to analyze.'});
      }
      const fullTranscript = messages
        .map(
          (m: {role?: string; text?: string}) =>
            `${m.role === 'examiner' ? 'EXAMINER' : 'CANDIDATE'}: ${sanitizeString(m.text, 1200)}`
        )
        .join('\n');

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `Perform a rigorous ILR OPI post-session diagnostic debrief for a military linguist speaking ${langName} (${dialectLabel}) in the domain "${domainLabel}".

SESSION TRANSCRIPT:
${fullTranscript}

REQUIREMENTS:
1. estimatedIlr: Realistic ILR rating (e.g., "ILR 2", "ILR 2+", "ILR 3").
2. discourseAudit: Score Point, Reason, Example, and Pivot (0–100 integers) based on PREP paragraph cohesion; provide crisp assessments of cohesionNotes, subjunctiveControl, and timeFrameStability.
3. naturalUpgrades: Pick up to 3 actual casual/Level 2 sentences the CANDIDATE said and rewrite each into natural, non-robotic ILR 2+ ${langName} (${dialectLabel}) using authentic high-register connectors. Quote the candidate's actual utterance in originalLevel2.
4. nextDrillRecommendation: One concrete actionable drill for the next session.`,
        config: {
          thinkingConfig: {thinkingLevel: ThinkingLevel.MEDIUM},
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              estimatedIlr: {type: Type.STRING},
              summaryAssessment: {type: Type.STRING},
              discourseAudit: {
                type: Type.OBJECT,
                properties: {
                  pointScore: {type: Type.INTEGER},
                  reasonScore: {type: Type.INTEGER},
                  exampleScore: {type: Type.INTEGER},
                  pivotScore: {type: Type.INTEGER},
                  cohesionNotes: {type: Type.STRING},
                  subjunctiveControl: {type: Type.STRING},
                  timeFrameStability: {type: Type.STRING},
                },
                required: [
                  'pointScore',
                  'reasonScore',
                  'exampleScore',
                  'pivotScore',
                  'cohesionNotes',
                  'subjunctiveControl',
                  'timeFrameStability',
                ],
              },
              naturalUpgrades: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    originalLevel2: {type: Type.STRING},
                    upgradedLevel2Plus: {type: Type.STRING},
                    connectorsUsed: {
                      type: Type.ARRAY,
                      items: {type: Type.STRING},
                    },
                    whyItUpgrades: {type: Type.STRING},
                  },
                  required: ['originalLevel2', 'upgradedLevel2Plus', 'connectorsUsed', 'whyItUpgrades'],
                },
              },
              nextDrillRecommendation: {type: Type.STRING},
            },
            required: [
              'estimatedIlr',
              'summaryAssessment',
              'discourseAudit',
              'naturalUpgrades',
              'nextDrillRecommendation',
            ],
          },
        },
      });

      const report = parseJsonSafe<Record<string, unknown>>(response.text, 'Empty response from ILR debrief.');
      const audit = (
        report.discourseAudit && typeof report.discourseAudit === 'object' ? report.discourseAudit : {}
      ) as Record<string, unknown>;
      const summaryAssessment = sanitizeString(report.summaryAssessment, 2000);
      if (!summaryAssessment) {
        throw new UserFacingError(502, 'ILR debrief came back empty. Please try again.');
      }
      res.json({
        estimatedIlr: sanitizeString(report.estimatedIlr, 40) || 'Unrated',
        summaryAssessment,
        discourseAudit: {
          pointScore: clampScore(audit.pointScore),
          reasonScore: clampScore(audit.reasonScore),
          exampleScore: clampScore(audit.exampleScore),
          pivotScore: clampScore(audit.pivotScore),
          cohesionNotes: sanitizeString(audit.cohesionNotes, 1200),
          subjunctiveControl: sanitizeString(audit.subjunctiveControl, 1200),
          timeFrameStability: sanitizeString(audit.timeFrameStability, 1200),
        },
        naturalUpgrades: (Array.isArray(report.naturalUpgrades) ? report.naturalUpgrades : [])
          .slice(0, 3)
          .map((item: Record<string, unknown> | null) => ({
            originalLevel2: sanitizeString(item?.originalLevel2, 1200),
            upgradedLevel2Plus: sanitizeString(item?.upgradedLevel2Plus, 1200),
            connectorsUsed: sanitizeStringArray(item?.connectorsUsed, 8, 80),
            whyItUpgrades: sanitizeString(item?.whyItUpgrades, 800),
          }))
          .filter((item) => Boolean(item.originalLevel2 && item.upgradedLevel2Plus)),
        nextDrillRecommendation: sanitizeString(report.nextDrillRecommendation, 1000),
        generatedAt: new Date().toISOString(),
      });
    })
  );

  // 7. PREP Monologue Prompt Generator (ThinkingLevel.LOW)
  app.post(
    '/api/lab/prep-prompt',
    handleAsync(async (req, res) => {
      const {language, langName, dialectLabel, domainId, domainLabel} = resolveTrainingContext(req.body);

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `Create one realistic ILR 2+/3 OPI abstract policy or hypothetical monologue prompt in ${langName} (${dialectLabel}) for the military domain "${domainLabel}".
The prompt should be answerable in 90 seconds using the PREP structure (Point -> Reason -> Example -> Pivot/Conclusion) and naturally invite subjunctive/conditional structures.
Provide the prompt in ${langName}, an English summary, and 4 recommended high-register connectors in ${langName}.`,
        config: {
          thinkingConfig: {thinkingLevel: ThinkingLevel.LOW},
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              promptTarget: {type: Type.STRING},
              promptEnglish: {type: Type.STRING},
              recommendedConnectors: {
                type: Type.ARRAY,
                items: {type: Type.STRING},
              },
            },
            required: ['promptTarget', 'promptEnglish', 'recommendedConnectors'],
          },
        },
      });

      const data = parseJsonSafe<Record<string, unknown>>(response.text, 'Empty response from PREP prompt generator.');
      const promptTarget = sanitizeString(data.promptTarget, 1500);
      if (!promptTarget) {
        throw new UserFacingError(502, 'PREP prompt generator returned an empty prompt. Please try again.');
      }
      res.json({
        id: `prep-${Date.now()}`,
        language,
        domain: domainId,
        promptTarget,
        promptEnglish: sanitizeString(data.promptEnglish, 1500),
        recommendedConnectors: sanitizeStringArray(data.recommendedConnectors, 6, 120),
      });
    })
  );

  // 8. PREP Monologue Grader (ThinkingLevel.MEDIUM)
  app.post(
    '/api/lab/grade-prep',
    handleAsync(async (req, res) => {
      const {langName, dialectLabel} = resolveTrainingContext(req.body);
      const promptTarget = sanitizeString(req.body?.promptTarget, 1000);
      const transcript = sanitizeString(req.body?.transcript, 3500);
      const durationSeconds = clampNumber(req.body?.durationSeconds, 0, 600, 90);

      if (!transcript) {
        return res.status(400).json({error: 'Record or enter your monologue transcript before grading.'});
      }
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `Grade this 90-second PREP monologue (actual duration: ${Math.round(durationSeconds)}s) in ${langName} (${dialectLabel}).
PROMPT: ${promptTarget}
CANDIDATE MONOLOGUE: ${transcript}

Evaluate Point (0:00–0:15), Reason (0:15–0:40), Example (0:40–1:10), and Pivot/Conclusion (1:10–1:30), plus subjunctive/conditional control and provide one polished ILR 2+/3 closing pivot sentence in ${langName}.`,
        config: {
          thinkingConfig: {thinkingLevel: ThinkingLevel.MEDIUM},
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              estimatedIlr: {type: Type.STRING},
              structureScore: {type: Type.INTEGER},
              phaseFeedback: {
                type: Type.OBJECT,
                properties: {
                  point: {type: Type.STRING},
                  reason: {type: Type.STRING},
                  example: {type: Type.STRING},
                  pivot: {type: Type.STRING},
                },
                required: ['point', 'reason', 'example', 'pivot'],
              },
              subjunctiveNote: {type: Type.STRING},
              upgradedConclusion: {type: Type.STRING},
            },
            required: ['estimatedIlr', 'structureScore', 'phaseFeedback', 'subjunctiveNote', 'upgradedConclusion'],
          },
        },
      });

      const data = parseJsonSafe<Record<string, unknown>>(response.text, 'Empty response from PREP grader.');
      const phase = (data.phaseFeedback && typeof data.phaseFeedback === 'object' ? data.phaseFeedback : {}) as Record<
        string,
        unknown
      >;
      res.json({
        estimatedIlr: sanitizeString(data.estimatedIlr, 40) || 'Unrated',
        structureScore: clampScore(data.structureScore),
        phaseFeedback: {
          point: sanitizeString(phase.point, 800),
          reason: sanitizeString(phase.reason, 800),
          example: sanitizeString(phase.example, 800),
          pivot: sanitizeString(phase.pivot, 800),
        },
        subjunctiveNote: sanitizeString(data.subjunctiveNote, 800),
        upgradedConclusion: sanitizeString(data.upgradedConclusion, 800),
      });
    })
  );

  // 9. Consecutive Interpretation Briefing Generator (ThinkingLevel.LOW)
  app.post(
    '/api/lab/interp-briefing',
    handleAsync(async (req, res) => {
      const {language, langName, dialectId, dialectLabel, domainId, domainLabel} = resolveTrainingContext(req.body);

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `Write a realistic 25-to-45 second spoken military/diplomatic briefing clip (75–105 words) in ${langName} (${dialectLabel}) for consecutive interpretation practice in the domain "${domainLabel}".
Example speaker: a Colonel, Naval Attaché, or Joint Staff Deputy addressing a visiting foreign delegation. Include 3–4 concrete operational details (numbers, timelines, unit coordination, policy caveats) that require disciplined idea-chunking notes. Also list 4 keyFacts in English.`,
        config: {
          thinkingConfig: {thinkingLevel: ThinkingLevel.LOW},
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              speakerRole: {type: Type.STRING},
              scenarioTitle: {type: Type.STRING},
              briefingText: {type: Type.STRING},
              estimatedSeconds: {type: Type.INTEGER},
              keyFacts: {
                type: Type.ARRAY,
                items: {type: Type.STRING},
              },
            },
            required: ['speakerRole', 'scenarioTitle', 'briefingText', 'estimatedSeconds', 'keyFacts'],
          },
        },
      });

      const data = parseJsonSafe<Record<string, unknown>>(response.text, 'Empty response from briefing generator.');
      const briefingText = sanitizeString(data.briefingText, 2500);
      if (!briefingText) {
        throw new UserFacingError(502, 'Briefing generator returned an empty briefing. Please try again.');
      }
      res.json({
        id: `interp-${Date.now()}`,
        language,
        dialect: dialectId,
        domain: domainId,
        speakerRole: sanitizeString(data.speakerRole, 200),
        scenarioTitle: sanitizeString(data.scenarioTitle, 200),
        briefingText,
        estimatedSeconds: clampNumber(data.estimatedSeconds, 10, 120, 35),
        keyFacts: sanitizeStringArray(data.keyFacts, 6, 300),
      });
    })
  );

  // 10. Consecutive Interpretation Grader (ThinkingLevel.MEDIUM)
  app.post(
    '/api/lab/grade-interp',
    handleAsync(async (req, res) => {
      const {langName} = resolveTrainingContext(req.body);
      const briefingText = sanitizeString(req.body?.briefingText, 2500);
      const candidateRendition = sanitizeString(req.body?.candidateRendition, 2500);
      const chunkNotes = sanitizeString(req.body?.chunkNotes, 1500);
      const direction =
        req.body?.direction === 'en_to_target' ? 'English to Target Language' : 'Target Language to English';

      if (!briefingText || !candidateRendition) {
        return res.status(400).json({error: 'Briefing source and your interpretation rendition are required.'});
      }
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `Grade this consecutive military/diplomatic interpretation (${direction}, source language: ${langName}).

SOURCE BRIEFING:
${briefingText}

CANDIDATE CHUNKING NOTES:
${chunkNotes || '(None entered)'}

CANDIDATE RENDITION:
${candidateRendition}

Score fidelityScore (0–100) and registerScore (0–100), list capturedPoints, list any missedOrDistorted numbers/caveats/facts, give concise terminologyFeedback, and supply a crisp diplomatic modelRendition.`,
        config: {
          thinkingConfig: {thinkingLevel: ThinkingLevel.MEDIUM},
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              fidelityScore: {type: Type.INTEGER},
              registerScore: {type: Type.INTEGER},
              capturedPoints: {
                type: Type.ARRAY,
                items: {type: Type.STRING},
              },
              missedOrDistorted: {
                type: Type.ARRAY,
                items: {type: Type.STRING},
              },
              terminologyFeedback: {type: Type.STRING},
              modelRendition: {type: Type.STRING},
            },
            required: [
              'fidelityScore',
              'registerScore',
              'capturedPoints',
              'missedOrDistorted',
              'terminologyFeedback',
              'modelRendition',
            ],
          },
        },
      });

      const data = parseJsonSafe<Record<string, unknown>>(response.text, 'Empty response from interpretation grader.');
      res.json({
        fidelityScore: clampScore(data.fidelityScore),
        registerScore: clampScore(data.registerScore),
        capturedPoints: sanitizeStringArray(data.capturedPoints, 10, 400),
        missedOrDistorted: sanitizeStringArray(data.missedOrDistorted, 10, 400),
        terminologyFeedback: sanitizeString(data.terminologyFeedback, 1500),
        modelRendition: sanitizeString(data.modelRendition, 3000),
      });
    })
  );

  // 11. Free Conversation Turn + Automatic Struggle-Word Capture (ThinkingLevel.LOW)
  app.post(
    '/api/chat/turn',
    handleAsync(async (req, res) => {
      const {langName, dialectLabel, domainLabel} = resolveTrainingContext(req.body);
      const registerMode = ['everyday', 'professional', 'debate'].includes(req.body?.registerMode)
        ? req.body.registerMode
        : 'professional';
      const history = Array.isArray(req.body?.history) ? req.body.history.slice(-16) : [];
      const userMessage = sanitizeString(req.body?.userMessage, 2500);

      if (!userMessage) {
        return res.status(400).json({error: 'Message text is required.'});
      }
      const registerGuidance =
        registerMode === 'everyday'
          ? 'Keep the tone relaxed, warm, and natural for everyday conversation, using authentic regional idioms.'
          : registerMode === 'debate'
            ? 'Engage in thoughtful ILR Level 3 discussion with nuanced perspectives, systemic causes, and hypothetical follow-ups.'
            : 'Keep a natural, collegial ILR 2+ professional conversational tone that feels like chatting with a sharp bilingual partner.';

      const systemInstruction = `You are a natural, engaging native ${langName} (${dialectLabel}) conversation partner inside LinguaForge ILR.
The user wants an open, free-flowing back-and-forth conversation (just like chatting with an intelligent partner on any topic they choose; their active domain context is "${domainLabel}", which you can reference naturally only if relevant).
${registerGuidance}

CRITICAL RULES:
1. replyText MUST be strictly in ${langName} (${dialectLabel}), warm, conversational, and 2–5 sentences long, ending with a natural follow-up question or thought to keep the dialogue flowing. Do NOT break character or lecture about grammar inside replyText.
2. struggleSuggestions: Silently inspect the user's latest message for 0 to 3 high-value words or phrases they struggled with, hesitated over, code-switched into English (e.g. "schedule", "budget", "deal with"), phrased awkwardly, or could naturally upgrade to sound more native.
   - If the user asked how to say something or mixed English into ${langName}, definitely capture the clean ${langName} equivalent in struggleSuggestions.
   - Even if their sentence was understandable, offer 1–2 genuinely useful native expressions or connectors from their topic so they can build their vocabulary vault effortlessly.
   - Each suggestion must include: targetPhrase (${langName}), englishConcept (concise English meaning), contextSentence (natural ${langName} sentence showing usage), reasonTag (short label like "Code-switch fix", "Natural phrasing", "Register upgrade", or "Useful expression"), note (1 brief helpful English tip), and suggestedCategory ("High-Register Connectors" | "Operational/Military Terms" | "Regional Idioms" | "False Friends").`;

      const transcriptBlock = history
        .map(
          (m: {role?: string; text?: string}) =>
            `${m.role === 'assistant' ? 'PARTNER' : 'USER'}: ${sanitizeString(m.text, 1000)}`
        )
        .join('\n');

      const prompt = transcriptBlock
        ? `Conversation history:\n${transcriptBlock}\n\nUSER'S LATEST MESSAGE:\n${userMessage}`
        : `USER'S OPENING MESSAGE:\n${userMessage}`;

      const ai = getAiClient();
      const response = await withTransientRetry(() =>
        ai.models.generateContent({
          model: GEMINI_CHAT_MODEL,
          contents: prompt,
          config: {
            systemInstruction,
            thinkingConfig: {thinkingLevel: ThinkingLevel.LOW},
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                replyText: {type: Type.STRING},
                struggleSuggestions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      targetPhrase: {type: Type.STRING},
                      englishConcept: {type: Type.STRING},
                      contextSentence: {type: Type.STRING},
                      reasonTag: {type: Type.STRING},
                      note: {type: Type.STRING},
                      suggestedCategory: {type: Type.STRING},
                    },
                    required: [
                      'targetPhrase',
                      'englishConcept',
                      'contextSentence',
                      'reasonTag',
                      'note',
                      'suggestedCategory',
                    ],
                  },
                },
              },
              required: ['replyText', 'struggleSuggestions'],
            },
          },
        })
      );

      const data = parseJsonSafe<{
        replyText?: unknown;
        struggleSuggestions?: Array<Record<string, unknown>>;
      }>(response.text, 'Empty response from conversation partner.');

      const replyText = sanitizeString(data.replyText, 4000);
      if (!replyText) {
        throw new UserFacingError(502, 'Conversation partner returned an empty reply. Please try sending again.');
      }

      const struggleSuggestions = (Array.isArray(data.struggleSuggestions) ? data.struggleSuggestions : [])
        .slice(0, 3)
        .map((item) => {
          const rawCategory = sanitizeString(item?.suggestedCategory, 80);
          return {
            targetPhrase: sanitizeString(item?.targetPhrase, 240),
            englishConcept: sanitizeString(item?.englishConcept, 240),
            contextSentence: sanitizeString(item?.contextSentence, 600) || replyText,
            reasonTag: sanitizeString(item?.reasonTag, 80) || 'Useful expression',
            note: sanitizeString(item?.note, 400),
            suggestedCategory: VALID_VOCAB_CATEGORIES.includes(rawCategory) ? rawCategory : 'Regional Idioms',
          };
        })
        .filter((item) => Boolean(item.targetPhrase && item.englishConcept));

      res.json({
        replyText,
        struggleSuggestions,
      });
    })
  );

  const httpServer = http.createServer(app);

  // Real-time Gemini Live bidirectional voice WebSocket bridge (/ws/live)
  const liveWss = new WebSocketServer({noServer: true, maxPayload: LIVE_WS_MAX_PAYLOAD_BYTES});
  const liveConnectionsByIp = new Map<string, number>();
  let liveConnectionCount = 0;

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname !== '/ws/live') {
      // Non-/ws/live upgrade requests (such as Vite dev HMR) are left untouched
      return;
    }
    if (!isAllowedWebSocketOrigin(request)) {
      console.warn('[live] rejected WebSocket upgrade from origin:', request.headers.origin ?? '(none)');
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }
    liveWss.handleUpgrade(request, socket, head, (ws) => {
      liveWss.emit('connection', ws, request);
    });
  });

  liveWss.on('connection', (clientWs, request: IncomingMessage) => {
    let liveSession: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
    let isClosing = false;
    let sessionStarted = false;
    let sessionTimer: NodeJS.Timeout | null = null;
    const clientIp = getClientIp(request);

    const sendToClient = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    // Concurrency caps protect the Gemini quota: live audio sessions are the most expensive calls.
    const ipCount = liveConnectionsByIp.get(clientIp) ?? 0;
    if (liveConnectionCount >= MAX_LIVE_SESSIONS || ipCount >= MAX_LIVE_SESSIONS_PER_IP) {
      sendToClient({
        type: 'error',
        error:
          ipCount >= MAX_LIVE_SESSIONS_PER_IP
            ? 'You already have the maximum number of live voice sessions open. Close another session and try again.'
            : 'Live voice is at capacity right now. Please try again in a few minutes.',
      });
      clientWs.close(1013, 'Try again later');
      return;
    }
    liveConnectionCount += 1;
    liveConnectionsByIp.set(clientIp, ipCount + 1);
    let released = false;
    const releaseSlot = () => {
      if (released) return;
      released = true;
      liveConnectionCount = Math.max(0, liveConnectionCount - 1);
      const remaining = (liveConnectionsByIp.get(clientIp) ?? 1) - 1;
      if (remaining > 0) liveConnectionsByIp.set(clientIp, remaining);
      else liveConnectionsByIp.delete(clientIp);
    };

    // Drop sockets that never send a start message.
    const startTimeout = setTimeout(() => {
      if (!sessionStarted) clientWs.close(1008, 'Session start timeout');
    }, 30_000);

    const closeLiveSession = () => {
      if (isClosing) return;
      isClosing = true;
      clearTimeout(startTimeout);
      if (sessionTimer) {
        clearTimeout(sessionTimer);
        sessionTimer = null;
      }
      releaseSlot();
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // Ignore close errors
        }
        liveSession = null;
      }
    };

    clientWs.on('message', async (rawData) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(rawData.toString());
      } catch {
        return;
      }

      if (msg.type === 'start') {
        if (liveSession || sessionStarted || isClosing) return;
        sessionStarted = true;
        clearTimeout(startTimeout);
        try {
          const {langName, dialectLabel, domainLabel} = resolveTrainingContext(msg);
          const registerMode = ['everyday', 'professional', 'debate'].includes(String(msg.registerMode))
            ? String(msg.registerMode)
            : 'professional';
          const rawVoice = sanitizeString(msg.voiceName, 40);
          const voiceName = (VALID_LIVE_VOICES as readonly string[]).includes(rawVoice) ? rawVoice : 'Zephyr';

          const registerGuidance =
            registerMode === 'everyday'
              ? 'Keep your speech relaxed, warm, and natural for everyday back-and-forth conversation, using authentic regional phrasing.'
              : registerMode === 'debate'
                ? 'Engage in natural, thought-provoking ILR Level 3 discussion with nuanced perspectives and hypothetical follow-ups.'
                : 'Maintain a natural, collegial ILR 2+ professional conversational tone, like talking with a fluent partner.';

          const systemInstruction = `You are a natural, warm, native ${langName} (${dialectLabel}) voice conversation partner inside LinguaForge ILR.
Speak strictly in ${langName} (${dialectLabel}) in a natural, conversational spoken cadence (2 to 4 crisp sentences per turn) so the back-and-forth flows just like a real phone call or live chat.
${registerGuidance}
The user's current operational domain context is "${domainLabel}", which you can touch on if they bring it up, or follow any topic they want to talk about.
If the user asks how to say something in ${langName} or slips into English for a word, smoothly give them the natural ${langName} expression in-voice and keep the conversation moving naturally without lecturing.
Greet the user briefly in ${langName} as soon as they speak, and always invite their next reply.`;

          const ai = getLiveAiClient();
          const session = await ai.live.connect({
            model: GEMINI_LIVE_MODEL,
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {voiceName},
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              systemInstruction,
            },
            callbacks: {
              onmessage: (message: LiveServerMessage) => {
                const content = message.serverContent;
                if (content?.inputTranscription?.text) {
                  sendToClient({type: 'input_transcript', text: content.inputTranscription.text});
                }
                if (content?.outputTranscription?.text) {
                  sendToClient({type: 'output_transcript', text: content.outputTranscription.text});
                }
                for (const part of content?.modelTurn?.parts ?? []) {
                  if (part.inlineData?.data) {
                    sendToClient({type: 'audio', data: part.inlineData.data});
                  }
                }
                if (content?.interrupted) {
                  sendToClient({type: 'interrupted'});
                }
                if (content?.turnComplete) {
                  sendToClient({type: 'turn_complete'});
                }
              },
              onerror: (err) => {
                const formatted = formatGeminiError(err);
                sendToClient({type: 'error', error: formatted.message});
              },
              onclose: (event) => {
                const rawEvent = event as {code?: number; reason?: string} | undefined;
                liveSession = null;
                if (rawEvent?.reason) {
                  // Upstream close reasons can contain provider details; log them, don't forward them.
                  console.warn('[live] Gemini session closed:', rawEvent.code, rawEvent.reason);
                }
                sendToClient({
                  type: 'closed',
                  code: typeof rawEvent?.code === 'number' ? rawEvent.code : undefined,
                });
              },
            },
          });

          if (isClosing) {
            session.close();
            return;
          }
          liveSession = session;
          if (MAX_LIVE_SESSION_MINUTES > 0) {
            sessionTimer = setTimeout(() => {
              sendToClient({
                type: 'error',
                error: `Live voice sessions are limited to ${MAX_LIVE_SESSION_MINUTES} minutes. Tap Start Live Voice to begin a new one.`,
              });
              closeLiveSession();
              clientWs.close(1000, 'Session time limit reached');
            }, MAX_LIVE_SESSION_MINUTES * 60_000);
          }
          sendToClient({type: 'ready', voiceName});
        } catch (err) {
          const formatted = formatGeminiError(err);
          sendToClient({type: 'error', error: formatted.message});
          closeLiveSession();
        }
        return;
      }

      if (msg.type === 'audio' && typeof msg.data === 'string' && liveSession) {
        try {
          liveSession.sendRealtimeInput({
            audio: {data: msg.data, mimeType: 'audio/pcm;rate=16000'},
          });
        } catch {
          // Ignore frames sent during teardown
        }
        return;
      }

      if (msg.type === 'text' && typeof msg.text === 'string' && liveSession) {
        const cleanText = sanitizeString(msg.text, 2000);
        if (cleanText) {
          try {
            liveSession.sendClientContent({
              turns: [{role: 'user', parts: [{text: cleanText}]}],
              turnComplete: true,
            });
          } catch {
            // Ignore errors during teardown
          }
        }
        return;
      }

      if (msg.type === 'stop') {
        closeLiveSession();
      }
    });

    clientWs.on('close', closeLiveSession);
    clientWs.on('error', closeLiveSession);
  });

  if (process.env.NODE_ENV !== 'production') {
    const {createServer: createViteServer} = await import('vite');
    const hmrEnabled = process.env.DISABLE_HMR !== 'true' && process.env.ENABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: hmrEnabled ? {server: httpServer} : false,
        hmr: hmrEnabled ? {server: httpServer} : false,
        watch: hmrEnabled ? {} : null,
      },
      appType: 'spa',
    });

    if (!hmrEnabled) {
      app.get('/@vite/client', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.send(`const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
  } else {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (search ? '&' + search.slice(1) : '') + (hash || '');
}
export class ErrorOverlay extends HTMLElement {}
`);
      });
    }

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(SERVER_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT ?? 3000);
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`LinguaForge ILR server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start LinguaForge ILR server:', err);
  process.exit(1);
});
