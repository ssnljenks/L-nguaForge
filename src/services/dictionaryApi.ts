import type {TargetLanguage, MilitaryDomain, TotResult, VocabItem, WordLookupResult} from '../types';
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
import {postJson} from './http';

/**
 * Lookups backed by the offline dictionaries (~100 kB). Kept out of `api.ts` so the startup bundle
 * only loads them with the screens that look words up (REVIEW M-7).
 */

const inflightWordLookups = new Map<string, Promise<EnrichedWordLookup>>();

export async function lookupContextualWord(params: {
  language: TargetLanguage;
  dialect: string;
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
          dialect: params.dialect,
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
  dialect: string;
  domain: MilitaryDomain;
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
      dialect: params.dialect,
      domain: params.domain,
      englishQuery: params.englishQuery,
    },
    15000
  );
  saveTotToLocalCache(params.language, params.englishQuery, res);
  return {...res, source: 'ai'};
}
