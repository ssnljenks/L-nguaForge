import React, {useEffect, useRef, useState} from 'react';
import {BookmarkPlus, Check, Loader2, Volume2, X} from 'lucide-react';
import type {MissionConfig} from '../../types';
import type {SaveVocabFn} from '../../hooks/useWordLookup';
import {requestTotPhrase} from '../../services/dictionaryApi';
import {LANGUAGE_LABELS} from '../../utils/ilrLogic';
import type {EnrichedTotResult} from '../../utils/localDictionary';
import {totSourceLabel} from '../shared/lookupLabels';

const RECALL_WINDOW_SECONDS = 5;

interface TotRetrievalHelperProps {
  config: MissionConfig;
  onSaveVocab: SaveVocabFn;
  onSpeak: (text: string) => void;
  onClose: () => void;
}

/**
 * "How do I say…?" with a 5-second active-recall window: the answer is fetched immediately but
 * only revealed after the countdown (or when the user taps Reveal Now), so they try first.
 */
export const TotRetrievalHelper: React.FC<TotRetrievalHelperProps> = ({config, onSaveVocab, onSpeak, onClose}) => {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [revealEarly, setRevealEarly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EnrichedTotResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const requestSeqRef = useRef(0);

  const countdown =
    startedAt === null || revealEarly ? 0 : Math.max(0, RECALL_WINDOW_SECONDS - Math.floor((now - startedAt) / 1000));
  const revealed = countdown === 0 ? result : null;

  useEffect(() => {
    if (countdown <= 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [countdown]);

  useEffect(
    () => () => {
      requestSeqRef.current += 1;
    },
    []
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const seq = ++requestSeqRef.current;
    const started = Date.now();
    setSubmittedQuery(q);
    setError(null);
    setResult(null);
    setSaved(false);
    setRevealEarly(false);
    setStartedAt(started);
    setNow(started);
    setLoading(true);
    try {
      const res = await requestTotPhrase({
        language: config.language,
        dialect: config.dialect,
        domain: 'general_policy',
        englishQuery: q,
      });
      if (seq === requestSeqRef.current) setResult(res);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setError(err instanceof Error ? err.message : 'Unable to retrieve high-register phrase.');
      setStartedAt(null);
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  const handleSave = () => {
    if (!revealed) return;
    onSaveVocab({
      term: revealed.targetPhrase,
      englishConcept: submittedQuery,
      contextSentence: revealed.exampleSentence,
      registerTag: revealed.registerNote,
      category: revealed.category,
      language: config.language,
      dialect: config.dialect,
      domain: 'general_policy',
    });
    setSaved(true);
  };

  return (
    <section
      aria-label="Stuck? Hold for a hint"
      className="rounded-xl border border-[#D99B26]/35 bg-[#131A22] p-4 sm:p-5 space-y-4"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-[#F8FAFC]">Stuck? Hold for a hint</h2>
          <p className="text-xs text-[#94A3B8] mt-0.5">
            Type what you want to say in English. Hold for 5 seconds to try recalling it before the phrase reveals.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close hint helper"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-[#94A3B8] hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2.5">
        <label htmlFor="tot-query-input" className="sr-only">
          English phrase to express
        </label>
        <input
          id="tot-query-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='e.g., "provided that public funding stays steady" or "on the other hand"'
          className="flex-1 min-h-[44px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3.5 py-2 text-sm text-[#E6EDF3] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#D99B26]"
        />
        <button
          type="submit"
          disabled={!query.trim() || loading}
          className="px-4 py-2 min-h-[44px] rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
        >
          Hold 5s for hint
        </button>
      </form>

      {countdown > 0 && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-[#23303E] bg-[#0B1117] px-4 py-3">
          <div className="flex items-center gap-3">
            <span
              data-testid="tot-countdown"
              role="timer"
              aria-live="off"
              className="font-mono text-2xl font-bold text-[#D99B26] tabular-nums w-8 text-center"
            >
              {countdown}
            </span>
            <div>
              <p className="text-sm font-medium text-[#F8FAFC]">Active Retrieval Window — Try saying it aloud first</p>
              <p className="text-xs text-[#94A3B8]">
                Retrieving before seeing the answer strengthens ILR 2+ lexical access.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRevealEarly(true)}
            disabled={loading && !result}
            className="px-3 py-1.5 rounded-lg border border-[#2E4054] text-xs font-medium text-[#CBD5E1] hover:text-white whitespace-nowrap"
          >
            Reveal Now
          </button>
        </div>
      )}

      {countdown === 0 && loading && (
        <div className="flex items-center gap-2 text-xs text-[#94A3B8]" role="status">
          <Loader2 className="w-4 h-4 animate-spin text-[#D99B26]" />
          <span>Fetching high-register {LANGUAGE_LABELS[config.language]} expression…</span>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-300" role="alert">
          {error}
        </p>
      )}

      {revealed && (
        <div className="rounded-lg border border-[#23303E] bg-[#0B1117] p-4 space-y-2.5" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs text-[#94A3B8]">
                {[totSourceLabel(revealed.source, 'Target High-Register Phrase'), revealed.category]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="text-lg font-semibold text-[#F8FAFC] mt-0.5">{revealed.targetPhrase}</p>
              {revealed.alternativeFormal && (
                <p className="text-xs text-[#94A3B8] mt-0.5">
                  Alternative: <span className="text-[#CBD5E1]">{revealed.alternativeFormal}</span>
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSpeak(revealed.targetPhrase)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#23303E] text-xs text-[#CBD5E1] hover:text-white"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Listen</span>
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saved}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] disabled:opacity-70"
              >
                {saved ? <Check className="w-3.5 h-3.5" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
                <span>{saved ? 'Saved to Vocab' : 'Save to Vocab'}</span>
              </button>
            </div>
          </div>
          <p className="text-xs text-[#94A3B8]">{revealed.registerNote}</p>
          <p className="text-sm text-[#CBD5E1] italic">&ldquo;{revealed.exampleSentence}&rdquo;</p>
        </div>
      )}
    </section>
  );
};
