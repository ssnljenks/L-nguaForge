import React, {useEffect, useRef, useState} from 'react';
import {BookmarkPlus, Check, Loader2, X} from 'lucide-react';
import type {MissionConfig, VocabCategory} from '../../types';
import type {SaveVocabFn} from '../../hooks/useWordLookup';
import {requestTotPhrase} from '../../services/api';
import {LANGUAGE_LABELS, normalizeVocabCategory} from '../../utils/ilrLogic';
import type {EnrichedTotResult} from '../../utils/localDictionary';
import {totSourceLabel} from '../shared/lookupLabels';

interface FlagWordDrawerProps {
  config: MissionConfig;
  /** Context sentence used for direct saves (normally the latest message in the conversation). */
  fallbackContextSentence: string;
  onSaveVocab: SaveVocabFn;
  onSaved: (term: string) => void;
  onClose: () => void;
}

type FlagMode = 'lookup' | 'direct';

const CATEGORY_OPTIONS: {value: VocabCategory; label: string}[] = [
  {value: 'Regional Idioms', label: 'Idioms'},
  {value: 'High-Register Connectors', label: 'Connectors'},
  {value: 'Operational/Military Terms', label: 'Operational'},
  {value: 'False Friends', label: 'False Friends'},
];

/** "Flag a word you struggled with": look up how to say an English phrase, or save a term directly. */
export const FlagWordDrawer: React.FC<FlagWordDrawerProps> = ({
  config,
  fallbackContextSentence,
  onSaveVocab,
  onSaved,
  onClose,
}) => {
  const [mode, setMode] = useState<FlagMode>('lookup');
  const [input, setInput] = useState('');
  const [directEnglish, setDirectEnglish] = useState('');
  const [category, setCategory] = useState<VocabCategory>('Regional Idioms');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EnrichedTotResult | null>(null);
  const [saved, setSaved] = useState(false);
  const requestSeqRef = useRef(0);

  useEffect(
    () => () => {
      requestSeqRef.current += 1;
    },
    []
  );

  const switchMode = (next: FlagMode) => {
    setMode(next);
    setError(null);
    if (next === 'direct') setResult(null);
  };

  const saveDirect = () => {
    const term = input.trim();
    if (!term || !directEnglish.trim()) {
      setError('Enter both the word/phrase and its English meaning.');
      return;
    }
    onSaveVocab({
      term,
      englishConcept: directEnglish.trim(),
      contextSentence: fallbackContextSentence || `Saved during live ${LANGUAGE_LABELS[config.language]} conversation.`,
      registerTag: 'Live Voice Capture',
      category,
      language: config.language,
      dialect: config.dialect,
      domain: config.domain,
    });
    onSaved(term);
    setInput('');
    setDirectEnglish('');
    setSaved(true);
  };

  const lookUp = async () => {
    const query = input.trim();
    if (!query) {
      setError('Type the English phrase you wanted to say.');
      return;
    }
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setResult(null);
    try {
      const res = await requestTotPhrase({
        language: config.language,
        dialect: config.dialect,
        domain: config.domain,
        englishQuery: query,
      });
      if (seq === requestSeqRef.current) setResult(res);
    } catch (err) {
      if (seq === requestSeqRef.current) setError(err instanceof Error ? err.message : 'Could not translate phrase.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (mode === 'direct') saveDirect();
    else void lookUp();
  };

  const saveResult = () => {
    if (!result) return;
    onSaveVocab({
      term: result.targetPhrase,
      englishConcept: input.trim() || result.registerNote,
      contextSentence: result.exampleSentence,
      registerTag: result.registerNote,
      category: normalizeVocabCategory(result.category),
      language: config.language,
      dialect: config.dialect,
      domain: config.domain,
    });
    onSaved(result.targetPhrase);
    setSaved(true);
  };

  const inputClass =
    'min-h-[40px] rounded-lg border border-[#23303E] bg-[#111922] px-3 py-2 text-xs text-[#E6EDF3] placeholder:text-[#64748B] focus:outline-none focus:border-[#D99B26]';

  return (
    <div className="p-4 border-b border-[#23303E] bg-[#0D141C] space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div
          className="flex items-center p-0.5 rounded-lg bg-[#111922] border border-[#23303E]"
          role="group"
          aria-label="Flag mode"
        >
          {(
            [
              ['lookup', 'How do I say…?'],
              ['direct', 'Save Directly'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => switchMode(value)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                mode === value ? 'bg-[#1D2B3A] text-white' : 'text-[#8B9BB0]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close flag word drawer"
          className="p-1 text-[#94A3B8] hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
        <input
          type="text"
          aria-label={mode === 'lookup' ? 'English phrase to look up' : 'Word or phrase to save'}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setSaved(false);
          }}
          placeholder={
            mode === 'lookup'
              ? 'English phrase you got stuck on…'
              : `${LANGUAGE_LABELS[config.language]} word or phrase`
          }
          className={`${mode === 'direct' ? 'sm:col-span-4' : 'sm:col-span-9'} ${inputClass}`}
        />

        {mode === 'direct' && (
          <>
            <input
              type="text"
              aria-label="English meaning"
              value={directEnglish}
              onChange={(e) => setDirectEnglish(e.target.value)}
              placeholder="English meaning"
              className={`sm:col-span-4 ${inputClass}`}
            />
            <select
              aria-label="Vault category"
              value={category}
              onChange={(e) => setCategory(e.target.value as VocabCategory)}
              className="sm:col-span-2 min-h-[40px] rounded-lg border border-[#23303E] bg-[#111922] px-2 text-xs text-[#E6EDF3]"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </>
        )}

        <button
          type="submit"
          disabled={loading}
          className={`${
            mode === 'direct' ? 'sm:col-span-2' : 'sm:col-span-3'
          } min-h-[40px] rounded-lg bg-[#16202B] border border-[#2E4054] text-xs font-semibold text-[#F8FAFC] hover:bg-[#1E2C3A] disabled:opacity-50 flex items-center justify-center gap-1.5`}
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D99B26]" /> : null}
          <span>{mode === 'lookup' ? 'Look Up' : 'Save'}</span>
        </button>
      </form>

      {error && (
        <p className="text-xs text-red-300" role="alert">
          {error}
        </p>
      )}
      {saved && mode === 'direct' && (
        <p className="text-xs text-emerald-400" role="status">
          Saved to Vocab Vault.
        </p>
      )}

      {result && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-[#23303E]">
          <div className="space-y-0.5">
            <p className="text-[11px] text-[#7D8FA3]">{totSourceLabel(result.source, 'AI Suggestion')}</p>
            <p className="text-sm font-semibold text-[#F3C669]">{result.targetPhrase}</p>
            <p className="text-xs text-[#94A3B8]">{result.exampleSentence}</p>
          </div>
          <button
            type="button"
            onClick={saveResult}
            disabled={saved}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] disabled:opacity-70 shrink-0"
          >
            {saved ? <Check className="w-3.5 h-3.5" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
            <span>{saved ? 'Saved' : 'Save to Vault'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
