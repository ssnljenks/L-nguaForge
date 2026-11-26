import {useCallback, useEffect, useRef, useState} from 'react';
import type {MissionConfig, VocabItem, VocabSource} from '../types';
import {lookupContextualWord} from '../services/dictionaryApi';
import {normalizeVocabCategory} from '../utils/ilrLogic';
import {type EnrichedWordLookup, incrementApiSavedCount, lookupLocalWord} from '../utils/localDictionary';

export interface WordLookupState {
  messageId: string;
  word: string;
  contextSentence: string;
  loading: boolean;
  result?: EnrichedWordLookup;
  error?: string;
  saved?: boolean;
}

export type SaveVocabFn = (item: Omit<VocabItem, 'id' | 'createdAt' | 'mastery' | 'reviewCount'>) => void;

interface UseWordLookupOptions {
  config: MissionConfig;
  vocabItems: VocabItem[];
  onSaveVocab: SaveVocabFn;
  /** Called after a word is saved (e.g. to record it on the active chat thread). */
  onSaved?: (term: string) => void;
  vocabSource?: VocabSource;
  regionTag?: string;
  omitDomain?: boolean;
}

/**
 * Tap-a-word lookup shared by the OPI and Free Chat transcripts: resolves instantly from the
 * vault/offline dictionaries/cache when possible, otherwise asks the AI with the sentence as context.
 */
export function useWordLookup({
  config,
  vocabItems,
  onSaveVocab,
  onSaved,
  vocabSource,
  regionTag,
  omitDomain = false,
}: UseWordLookupOptions) {
  const [lookup, setLookup] = useState<WordLookupState | null>(null);
  // Ignore responses that arrive after the user tapped a different word or closed the popover.
  const requestSeqRef = useRef(0);

  useEffect(
    () => () => {
      requestSeqRef.current += 1;
    },
    []
  );

  const lookUpWord = useCallback(
    async (messageId: string, word: string, contextSentence: string, forceAi = false) => {
      if (!word) return;
      const seq = ++requestSeqRef.current;
      const base = {messageId, word, contextSentence};

      if (!forceAi) {
        const localHit = lookupLocalWord(config.language, word, vocabItems);
        if (localHit) {
          incrementApiSavedCount();
          setLookup({...base, loading: false, result: localHit, saved: localHit.source === 'vault'});
          return;
        }
      }

      setLookup({...base, loading: true});
      try {
        const result = await lookupContextualWord({
          language: config.language,
          dialect: config.dialect,
          word,
          contextSentence,
          vocabItems,
          forceAi,
        });
        if (seq !== requestSeqRef.current) return;
        if (!result.contextualMeaning?.trim()) {
          throw new Error('Could not retrieve the word meaning. Please tap Retry.');
        }
        setLookup({...base, loading: false, result, saved: false});
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        setLookup({...base, loading: false, error: err instanceof Error ? err.message : 'Lookup failed.'});
      }
    },
    [config.language, config.dialect, vocabItems]
  );

  const close = useCallback(() => {
    requestSeqRef.current += 1;
    setLookup(null);
  }, []);

  const retry = useCallback(
    (forceAi = false) => {
      if (lookup) void lookUpWord(lookup.messageId, lookup.word, lookup.contextSentence, forceAi);
    },
    [lookup, lookUpWord]
  );

  const save = useCallback(() => {
    if (!lookup?.result) return;
    onSaveVocab({
      term: lookup.word,
      englishConcept: lookup.result.contextualMeaning,
      contextSentence: lookup.contextSentence,
      registerTag: lookup.result.registerTag,
      category: normalizeVocabCategory(lookup.result.suggestedCategory),
      language: config.language,
      dialect: config.dialect,
      ...(!omitDomain ? {domain: config.domain} : {}),
      ...(vocabSource ? {source: vocabSource} : {}),
      ...(regionTag ? {regionTag} : {}),
      kind: lookup.word.trim().includes(' ') ? 'phrase' : 'word',
    });
    onSaved?.(lookup.word);
    setLookup((prev) => (prev ? {...prev, saved: true} : null));
  }, [
    lookup,
    onSaveVocab,
    onSaved,
    config.language,
    config.dialect,
    config.domain,
    omitDomain,
    vocabSource,
    regionTag,
  ]);

  return {lookup, lookUpWord, retry, save, close};
}
