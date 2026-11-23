import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import {fileURLToPath} from 'url';
import {GoogleGenAI, LiveServerMessage, Modality, ThinkingLevel, Type} from '@google/genai';
import {WebSocket, WebSocketServer} from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GEMINI_MODEL = 'gemini-3.8-flash';
const GEMINI_CHAT_MODEL = 'gemini-4-hydrogen';
const GEMINI_FAST_LOOKUP_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_LIVE_MODEL = 'gemini-3.8-live';
const VALID_LIVE_VOICES = ['Zephyr', 'Puck', 'Kore', 'Fenrir', 'Charon'] as const;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server. Configure it in Settings > Secrets.');
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
    throw new Error('GEMINI_API_KEY is not configured on the server. Configure it in Settings > Secrets.');
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

function sanitizeString(val: unknown, maxLen = 4000): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function validateLanguage(val: unknown): 'es' | 'pt' {
  return val === 'pt' ? 'pt' : 'es';
}

function parseJsonSafe<T>(raw: string | undefined, fallbackError: string): T {
  const cleaned = (raw ?? '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  if (!cleaned) {
    throw new Error(fallbackError);
  }
  return JSON.parse(cleaned) as T;
}

function formatGeminiError(err: unknown): {status: number; message: string} {
  const rawObj = err && typeof err === 'object' ? (err as {message?: unknown; error?: {message?: unknown}}) : null;
  const msg =
    err instanceof Error
      ? err.message
      : typeof rawObj?.message === 'string'
      ? rawObj.message
      : typeof rawObj?.error?.message === 'string'
      ? rawObj.error.message
      : 'Unexpected server error';
  if (msg.includes('GEMINI_API_KEY')) {
    return {status: 503, message: msg};
  }
  if (msg.includes('403') || msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID')) {
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
    return {
      status: 404,
      message: `Model "${GEMINI_MODEL}" was not found or is unavailable: ${msg}`,
    };
  }
  return {status: 500, message: msg};
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

async function startServer() {
  const app = express();
  app.use(express.json({limit: '1mb'}));

  app.get('/api/health', (_req, res) => {
    res.json({ok: true, model: GEMINI_MODEL});
  });

  // 1. Live OPI Examiner Turn (ThinkingLevel.LOW)
  app.post('/api/opi/turn', async (req, res) => {
    try {
      const language = validateLanguage(req.body?.language);
      const dialectLabel = sanitizeString(req.body?.dialectLabel, 120) || 'Neutral Latin American';
      const domainLabel = sanitizeString(req.body?.domainLabel, 120) || 'General Policy & Strategy';
      const probeLevel = req.body?.probeLevel === 'level_3_probe' ? 'level_3_probe' : 'level_2_baseline';
      const elapsedSeconds = Number(req.body?.elapsedSeconds ?? 0);
      const history = Array.isArray(req.body?.history) ? req.body.history.slice(-14) : [];
      const userMessage = sanitizeString(req.body?.userMessage, 2500);
      const isOpening = Boolean(req.body?.isOpening);

      if (!isOpening && !userMessage) {
        return res.status(400).json({error: 'Candidate message is required.'});
      }

      const langName = language === 'es' ? 'Spanish' : 'Portuguese';
      const systemInstruction = `You are a certified senior ILR Oral Proficiency Interview (OPI) examiner conducting an operational interview strictly in ${langName} (${dialectLabel} dialect) within the domain: ${domainLabel}.
Keep your examiner turn concise (2–4 natural sentences), authentic to the chosen regional dialect, and strictly in ${langName} (no English explanations inside examinerText).

PROBING PROTOCOL:
- Current target probe level: ${probeLevel === 'level_3_probe' ? 'ILR LEVEL 3 PROBE' : 'ILR LEVEL 2 BASELINE'} (elapsed ${Math.round(elapsedSeconds)}s).
- In LEVEL 2 BASELINE: Ask concrete narrative, procedural, or factual questions about operations, roles, timelines, or recent events in the domain. If the candidate struggled on the prior turn, smoothly step down to stabilize fluency.
- In LEVEL 3 PROBE: Push into abstract defense/diplomatic policy, systemic root causes, competing institutional priorities, or hypothetical ("what if" / counterfactual) scenarios that naturally elicit the imperfect subjunctive and conditional.
- Return nextProbeLevel ("level_2_baseline" or "level_3_probe") and a brief English probeReason explaining why you stayed at or shifted to that level.`;

      const transcriptBlock = history
        .map((m: {role?: string; text?: string}) => `${m.role === 'examiner' ? 'EXAMINER' : 'CANDIDATE'}: ${sanitizeString(m.text, 1000)}`)
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
        throw new Error('OPI examiner returned an empty response. Please try again.');
      }
      const resolvedProbe = data.nextProbeLevel === 'level_3_probe' ? 'level_3_probe' : 'level_2_baseline';
      res.json({
        examinerText,
        probeLevel: resolvedProbe,
        probeReason: sanitizeString(data.probeReason, 500),
      });
    } catch (err) {
      const {status, message} = formatGeminiError(err);
      res.status(status).json({error: message});
    }
  });

  // 3. Tap-to-Save Contextual Word/Phrase Lookup (ThinkingLevel.LOW)
  app.post('/api/vocab/lookup', async (req, res) => {
    try {
      const language = validateLanguage(req.body?.language);
      const dialectLabel = sanitizeString(req.body?.dialectLabel, 120) || 'Neutral Latin American';
      const word = sanitizeString(req.body?.word, 120);
      const contextSentence = sanitizeString(req.body?.contextSentence, 1200);

      if (!word || !contextSentence) {
        return res.status(400).json({error: 'Word and context sentence are required.'});
      }

      const langName = language === 'es' ? 'Spanish' : 'Portuguese';
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
        throw new Error('Could not retrieve a definition for that word. Please try again.');
      }

      const validCategories = [
        'High-Register Connectors',
        'Operational/Military Terms',
        'Regional Idioms',
        'False Friends',
      ];
      const rawCategory = sanitizeString(data.suggestedCategory, 80);
      const suggestedCategory = validCategories.includes(rawCategory)
        ? rawCategory
        : 'Regional Idioms';

      res.json({
        word,
        contextualMeaning,
        registerTag: sanitizeString(data.registerTag, 80) || 'General Usage',
        grammarNote: sanitizeString(data.grammarNote, 400),
        suggestedCategory,
      });
    } catch (err) {
      const {status, message} = formatGeminiError(err);
      res.status(status).json({error: message});
    }
  });

  // 4. Tip-of-the-Tongue ("How do I say...?") Helper (ThinkingLevel.LOW)
  app.post('/api/vocab/tot', async (req, res) => {
    try {
      const language = validateLanguage(req.body?.language);
      const dialectLabel = sanitizeString(req.body?.dialectLabel, 120) || 'Neutral Latin American';
      const domainLabel = sanitizeString(req.body?.domainLabel, 120) || 'General Policy & Strategy';
      const englishQuery = sanitizeString(req.body?.englishQuery, 400);

      if (!englishQuery) {
        return res.status(400).json({error: 'Please enter the English phrase or concept you want to express.'});
      }

      const langName = language === 'es' ? 'Spanish' : 'Portuguese';
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
      const validCategories = [
        'High-Register Connectors',
        'Operational/Military Terms',
        'Regional Idioms',
        'False Friends',
      ];
      const targetPhrase = sanitizeString(data.targetPhrase, 300);
      if (!targetPhrase) {
        throw new Error('TOT helper returned an empty phrase. Please try again.');
      }
      res.json({
        targetPhrase,
        alternativeFormal: sanitizeString(data.alternativeFormal, 300),
        registerNote: sanitizeString(data.registerNote, 400),
        exampleSentence: sanitizeString(data.exampleSentence, 800),
        category: validCategories.includes(data.category) ? data.category : 'High-Register Connectors',
      });
    } catch (err) {
      const {status, message} = formatGeminiError(err);
      res.status(status).json({error: message});
    }
  });

  // 5. Vocab Active-Recall Sentence Coach (ThinkingLevel.LOW)
  app.post('/api/vocab/evaluate-sentence', async (req, res) => {
    try {
      const language = validateLanguage(req.body?.language);
      const targetTerm = sanitizeString(req.body?.targetTerm, 150);
      const userSentence = sanitizeString(req.body?.userSentence, 800);
      const domainLabel = sanitizeString(req.body?.domainLabel, 120) || 'General Policy & Strategy';

      if (!targetTerm || !userSentence) {
        return res.status(400).json({error: 'Target term and candidate sentence are required.'});
      }

      const langName = language === 'es' ? 'Spanish' : 'Portuguese';
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

      const data = parseJsonSafe<{isNatural: boolean; feedback: string; polishedVersion: string}>(
        response.text,
        'Empty response from sentence evaluator.'
      );
      res.json(data);
    } catch (err) {
      const {status, message} = formatGeminiError(err);
      res.status(status).json({error: message});
    }
  });

  // 5. Post-Session ILR Debrief & Natural 2+ Rewriter (ThinkingLevel.MEDIUM)
  app.post('/api/debrief/analyze', async (req, res) => {
    try {
      const language = validateLanguage(req.body?.language);
      const dialectLabel = sanitizeString(req.body?.dialectLabel, 120) || 'Neutral Latin American';
      const domainLabel = sanitizeString(req.body?.domainLabel, 120) || 'General Policy & Strategy';
      const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-30) : [];

      const candidateUtterances = messages
        .filter((m: {role?: string; text?: string}) => m.role === 'candidate' && typeof m.text === 'string' && m.text.trim())
        .map((m: {text: string}) => sanitizeString(m.text, 1200));

      if (candidateUtterances.length === 0) {
        return res.status(400).json({error: 'No candidate speech found in this session to analyze.'});
      }

      const langName = language === 'es' ? 'Spanish' : 'Portuguese';
      const fullTranscript = messages
        .map((m: {role?: string; text?: string}) => `${m.role === 'examiner' ? 'EXAMINER' : 'CANDIDATE'}: ${sanitizeString(m.text, 1200)}`)
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
      res.json({
        ...report,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      const {status, message} = formatGeminiError(err);
      res.status(status).json({error: message});
    }
  });

  // 7. PREP Monologue Prompt Generator (ThinkingLevel.LOW)
  app.post('/api/lab/prep-prompt', async (req, res) => {
    try {
      const language = validateLanguage(req.body?.language);
      const dialectLabel = sanitizeString(req.body?.dialectLabel, 120) || 'Neutral Latin American';
      const domainLabel = sanitizeString(req.body?.domainLabel, 120) || 'General Policy & Strategy';
      const langName = language === 'es' ? 'Spanish' : 'Portuguese';

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

      const data = parseJsonSafe<{
        promptTarget: string;
        promptEnglish: string;
        recommendedConnectors: string[];
      }>(response.text, 'Empty response from PREP prompt generator.');

      res.json({
        id: `prep-${Date.now()}`,
        language,
        domain: req.body?.domain ?? 'general_policy',
        ...data,
      });
    } catch (err) {
      const {status, message} = formatGeminiError(err);
      res.status(status).json({error: message});
    }
  });

  // 8. PREP Monologue Grader (ThinkingLevel.MEDIUM)
  app.post('/api/lab/grade-prep', async (req, res) => {
    try {
      const language = validateLanguage(req.body?.language);
      const dialectLabel = sanitizeString(req.body?.dialectLabel, 120) || 'Neutral Latin American';
      const promptTarget = sanitizeString(req.body?.promptTarget, 1000);
      const transcript = sanitizeString(req.body?.transcript, 3500);
      const durationSeconds = Number(req.body?.durationSeconds ?? 90);

      if (!transcript) {
        return res.status(400).json({error: 'Record or enter your monologue transcript before grading.'});
      }

      const langName = language === 'es' ? 'Spanish' : 'Portuguese';
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
      res.json(data);
    } catch (err) {
      const {status, message} = formatGeminiError(err);
      res.status(status).json({error: message});
    }
  });

  // 9. Consecutive Interpretation Briefing Generator (ThinkingLevel.LOW)
  app.post('/api/lab/interp-briefing', async (req, res) => {
    try {
      const language = validateLanguage(req.body?.language);
      const dialectLabel = sanitizeString(req.body?.dialectLabel, 120) || 'Neutral Latin American';
      const domainLabel = sanitizeString(req.body?.domainLabel, 120) || 'General Policy & Strategy';
      const langName = language === 'es' ? 'Spanish' : 'Portuguese';

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
      res.json({
        id: `interp-${Date.now()}`,
        language,
        dialect: req.body?.dialect ?? 'neutral_latam',
        domain: req.body?.domain ?? 'general_policy',
        ...data,
      });
    } catch (err) {
      const {status, message} = formatGeminiError(err);
      res.status(status).json({error: message});
    }
  });

  // 10. Consecutive Interpretation Grader (ThinkingLevel.MEDIUM)
  app.post('/api/lab/grade-interp', async (req, res) => {
    try {
      const language = validateLanguage(req.body?.language);
      const briefingText = sanitizeString(req.body?.briefingText, 2500);
      const candidateRendition = sanitizeString(req.body?.candidateRendition, 2500);
      const chunkNotes = sanitizeString(req.body?.chunkNotes, 1500);
      const direction = req.body?.direction === 'en_to_target' ? 'English to Target Language' : 'Target Language to English';

      if (!briefingText || !candidateRendition) {
        return res.status(400).json({error: 'Briefing source and your interpretation rendition are required.'});
      }

      const langName = language === 'es' ? 'Spanish' : 'Portuguese';
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
      res.json(data);
    } catch (err) {
      const {status, message} = formatGeminiError(err);
      res.status(status).json({error: message});
    }
  });

  // 11. Free Conversation Turn + Automatic Struggle-Word Capture (ThinkingLevel.LOW)
  app.post('/api/chat/turn', async (req, res) => {
    try {
      const language = validateLanguage(req.body?.language);
      const dialectLabel = sanitizeString(req.body?.dialectLabel, 120) || 'Neutral Latin American';
      const domainLabel = sanitizeString(req.body?.domainLabel, 120) || 'General Policy & Strategy';
      const registerMode = ['everyday', 'professional', 'debate'].includes(req.body?.registerMode)
        ? req.body.registerMode
        : 'professional';
      const history = Array.isArray(req.body?.history) ? req.body.history.slice(-16) : [];
      const userMessage = sanitizeString(req.body?.userMessage, 2500);

      if (!userMessage) {
        return res.status(400).json({error: 'Message text is required.'});
      }

      const langName = language === 'es' ? 'Spanish' : 'Portuguese';
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
        .map((m: {role?: string; text?: string}) => `${m.role === 'assistant' ? 'PARTNER' : 'USER'}: ${sanitizeString(m.text, 1000)}`)
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
        throw new Error('Conversation partner returned an empty reply. Please try sending again.');
      }

      const validCategories = [
        'High-Register Connectors',
        'Operational/Military Terms',
        'Regional Idioms',
        'False Friends',
      ];

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
            suggestedCategory: validCategories.includes(rawCategory) ? rawCategory : 'Regional Idioms',
          };
        })
        .filter((item) => Boolean(item.targetPhrase && item.englishConcept));

      res.json({
        replyText,
        struggleSuggestions,
      });
    } catch (err) {
      const {status, message} = formatGeminiError(err);
      res.status(status).json({error: message});
    }
  });

  const httpServer = http.createServer(app);

  // Real-time Gemini Live bidirectional voice WebSocket bridge (/ws/live)
  const liveWss = new WebSocketServer({noServer: true});

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname === '/ws/live') {
      liveWss.handleUpgrade(request, socket, head, (ws) => {
        liveWss.emit('connection', ws, request);
      });
    }
    // Non-/ws/live upgrade requests (such as Vite dev HMR) are left untouched
  });

  liveWss.on('connection', (clientWs) => {
    let liveSession: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
    let isClosing = false;

    const sendToClient = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const closeLiveSession = () => {
      if (isClosing) return;
      isClosing = true;
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
        if (liveSession) return;
        try {
          const language = validateLanguage(msg.language);
          const dialectLabel = sanitizeString(msg.dialectLabel, 120) || 'Neutral Latin American';
          const domainLabel = sanitizeString(msg.domainLabel, 120) || 'General Policy & Strategy';
          const registerMode = ['everyday', 'professional', 'debate'].includes(String(msg.registerMode))
            ? String(msg.registerMode)
            : 'professional';
          const rawVoice = sanitizeString(msg.voiceName, 40);
          const voiceName = (VALID_LIVE_VOICES as readonly string[]).includes(rawVoice) ? rawVoice : 'Zephyr';

          const langName = language === 'es' ? 'Spanish' : 'Portuguese';
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
                sendToClient({
                  type: 'closed',
                  code: typeof rawEvent?.code === 'number' ? rawEvent.code : undefined,
                  reason: typeof rawEvent?.reason === 'string' ? rawEvent.reason : undefined,
                });
              },
            },
          });

          if (isClosing) {
            session.close();
            return;
          }
          liveSession = session;
          sendToClient({type: 'ready', model: GEMINI_LIVE_MODEL, voiceName});
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
    const distDir = path.resolve(__dirname, 'dist');
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
