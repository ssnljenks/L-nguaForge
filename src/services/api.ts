import type {
  ChatRegisterMode,
  ChatStruggleSuggestion,
  DebriefReport,
  FreeChatMessage,
  InterpBriefing,
  InterpEvaluation,
  MilitaryDomain,
  OpiMessage,
  PrepEvaluation,
  PrepPromptItem,
  ProbeLevel,
  TargetLanguage,
  TotResult,
  VocabItem,
  WordLookupResult,
} from '../types';
import {
  type EnrichedTotResult,
  type EnrichedWordLookup,
  incrementApiSavedCount,
  lookupLocalTotPhrase,
  lookupLocalWord,
  normalizeLookupKey,
  saveTotToLocalCache,
  saveWordToLocalCache,
} from '../utils/localDictionary';

const inflightWordLookups = new Map<string, Promise<EnrichedWordLookup>>();

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  timeoutMs = 45000
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timed out. Tap Retry to try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const rawText = await response.text();
  let data: Record<string, unknown> | null = null;
  if (rawText.trim()) {
    try {
      data = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const errMsg = typeof data?.error === 'string' && data.error.trim()
      ? data.error
      : `Request failed (${response.status})`;
    throw new Error(errMsg);
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Server returned an unexpected empty response. Please try again.');
  }
  return data as T;
}

export async function requestOpiTurn(params: {
  language: TargetLanguage;
  dialectLabel: string;
  domainLabel: string;
  probeLevel: ProbeLevel;
  elapsedSeconds: number;
  history: Pick<OpiMessage, 'role' | 'text'>[];
  userMessage?: string;
  isOpening?: boolean;
}): Promise<{examinerText: string; probeLevel: ProbeLevel; probeReason: string}> {
  return postJson('/api/opi/turn', params);
}

export async function lookupContextualWord(params: {
  language: TargetLanguage;
  dialectLabel: string;
  word: string;
  contextSentence: string;
  vocabItems?: VocabItem[];
  forceAi?: boolean;
}): Promise<EnrichedWordLookup> {
  if (!params.forceAi) {
    const localHit = lookupLocalWord(params.language, params.word, params.vocabItems ?? []);
    if (localHit) {
      incrementApiSavedCount();
      return localHit;
    }
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error(
      'Offline — this term is not in the built-in military dictionary or local cache yet. Reconnect to look it up with AI.'
    );
  }

  const dedupeKey = `${params.language}:${normalizeLookupKey(params.word)}:${params.forceAi ? 'ai' : 'std'}`;
  const existing = inflightWordLookups.get(dedupeKey);
  if (existing) return existing;

  const requestPromise = (async (): Promise<EnrichedWordLookup> => {
    try {
      const result = await postJson<WordLookupResult>(
        '/api/vocab/lookup',
        {
          language: params.language,
          dialectLabel: params.dialectLabel,
          word: params.word,
          contextSentence: params.contextSentence,
        },
        15000
      );
      if (!result || typeof result.contextualMeaning !== 'string' || !result.contextualMeaning.trim()) {
        throw new Error('Word definition came back empty. Tap Retry to look it up again.');
      }
      saveWordToLocalCache(params.language, result, params.word);
      return {...result, source: 'ai'};
    } finally {
      inflightWordLookups.delete(dedupeKey);
    }
  })();

  inflightWordLookups.set(dedupeKey, requestPromise);
  return requestPromise;
}

export async function requestTotPhrase(params: {
  language: TargetLanguage;
  dialectLabel: string;
  domainLabel: string;
  englishQuery: string;
  forceAi?: boolean;
}): Promise<EnrichedTotResult> {
  if (!params.forceAi) {
    const localHit = lookupLocalTotPhrase(params.language, params.englishQuery);
    if (localHit) {
      incrementApiSavedCount();
      return localHit;
    }
  }

  const res = await postJson<TotResult>(
    '/api/vocab/tot',
    {
      language: params.language,
      dialectLabel: params.dialectLabel,
      domainLabel: params.domainLabel,
      englishQuery: params.englishQuery,
    },
    15000
  );
  saveTotToLocalCache(params.language, params.englishQuery, res);
  return {...res, source: 'ai'};
}

export async function evaluateRecallSentence(params: {
  language: TargetLanguage;
  targetTerm: string;
  userSentence: string;
  domainLabel: string;
}): Promise<{isNatural: boolean; feedback: string; polishedVersion: string}> {
  return postJson('/api/vocab/evaluate-sentence', params);
}

export async function runSessionDebrief(params: {
  language: TargetLanguage;
  dialectLabel: string;
  domainLabel: string;
  messages: Pick<OpiMessage, 'role' | 'text'>[];
}): Promise<DebriefReport> {
  return postJson('/api/debrief/analyze', params);
}

export async function generatePrepPrompt(params: {
  language: TargetLanguage;
  dialectLabel: string;
  domain: MilitaryDomain;
  domainLabel: string;
}): Promise<PrepPromptItem> {
  return postJson('/api/lab/prep-prompt', params);
}

export async function gradePrepMonologue(params: {
  language: TargetLanguage;
  dialectLabel: string;
  promptTarget: string;
  transcript: string;
  durationSeconds: number;
}): Promise<PrepEvaluation> {
  return postJson('/api/lab/grade-prep', params);
}

export async function generateInterpBriefing(params: {
  language: TargetLanguage;
  dialect: string;
  dialectLabel: string;
  domain: MilitaryDomain;
  domainLabel: string;
}): Promise<InterpBriefing> {
  return postJson('/api/lab/interp-briefing', params);
}

export async function gradeInterpretation(params: {
  language: TargetLanguage;
  briefingText: string;
  candidateRendition: string;
  chunkNotes: string;
  direction: 'target_to_en' | 'en_to_target';
}): Promise<InterpEvaluation> {
  return postJson('/api/lab/grade-interp', params);
}

export async function sendFreeChatTurn(params: {
  language: TargetLanguage;
  dialectLabel: string;
  domainLabel: string;
  registerMode: ChatRegisterMode;
  history: Pick<FreeChatMessage, 'role' | 'text'>[];
  userMessage: string;
}): Promise<{replyText: string; struggleSuggestions: ChatStruggleSuggestion[]}> {
  return postJson('/api/chat/turn', params);
}
