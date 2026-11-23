import React from 'react';
import {BookmarkPlus, Check, Volume2} from 'lucide-react';
import type {MissionConfig} from '../../types';
import type {SaveVocabFn} from '../../hooks/useWordLookup';
import {getDomainInfo, LANGUAGE_LABELS} from '../../utils/ilrLogic';
import {getOfflineMilitaryEntries, normalizeLookupKey} from '../../utils/localDictionary';

export type GlossaryEntry = ReturnType<typeof getOfflineMilitaryEntries>[number];

interface MilitaryGlossaryListProps {
  config: MissionConfig;
  entries: GlossaryEntry[];
  /** Normalized terms already in the vault, shown as "In Vault". */
  savedTerms: Set<string>;
  onAddVocab: SaveVocabFn;
  onSpeak: (text: string) => void;
}

/** Built-in offline military dictionary with one-tap save to the vault. */
export const MilitaryGlossaryList: React.FC<MilitaryGlossaryListProps> = ({
  config,
  entries,
  savedTerms,
  onAddVocab,
  onSpeak,
}) => (
  <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#94A3B8]">
      <span>
        Built-in offline {LANGUAGE_LABELS[config.language]} military lexicon —{' '}
        <span className="font-mono text-[#E6EDF3] tabular-nums">{entries.length}</span>{' '}
        {entries.length === 1 ? 'term' : 'terms'} ready with zero API calls
      </span>
    </div>

    {entries.length === 0 ? (
      <div className="rounded-xl border border-[#23303E] bg-[#111922] p-10 text-center space-y-2">
        <p className="text-sm font-medium text-[#E6EDF3]">
          No offline {LANGUAGE_LABELS[config.language]} military terms match that search.
        </p>
        <p className="text-xs text-[#94A3B8]">
          Try clearing the domain filter or searching by English or {LANGUAGE_LABELS[config.language]} root word.
        </p>
      </div>
    ) : (
      <div className="rounded-xl border border-[#23303E] bg-[#111922] divide-y divide-[#1D2835]">
        {entries.map((entry) => {
          const alreadySaved = savedTerms.has(normalizeLookupKey(entry.term));
          return (
            <div
              key={`${config.language}-${entry.term}`}
              className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4 hover:bg-[#141E29] transition-colors"
            >
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="text-base font-semibold text-[#F8FAFC]">{entry.term}</h3>
                  <span className="text-sm text-[#CBD5E1]">{entry.meaning}</span>
                </div>
                <p className="text-xs text-[#94A3B8] leading-relaxed">{entry.note}</p>
                <p className="text-xs text-[#7D8FA3]">
                  {getDomainInfo(entry.domain).shortLabel}
                  <span className="mx-1.5" aria-hidden="true">
                    ·
                  </span>
                  {entry.register}
                  <span className="mx-1.5" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-emerald-400">Offline Ready</span>
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onSpeak(entry.term)}
                  aria-label={`Listen to ${entry.term}`}
                  className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-[#23303E] text-[#CBD5E1] hover:text-[#F3C669] hover:border-[#35495E] transition-colors"
                >
                  <Volume2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={alreadySaved}
                  onClick={() =>
                    onAddVocab({
                      term: entry.term,
                      englishConcept: entry.meaning,
                      contextSentence: entry.note,
                      registerTag: entry.register,
                      category: entry.category,
                      language: config.language,
                      dialect: config.dialect,
                      domain: entry.domain,
                    })
                  }
                  aria-label={alreadySaved ? `${entry.term} already in Vault` : `Save ${entry.term} to Vault`}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                    alreadySaved
                      ? 'border border-emerald-500/35 bg-emerald-950/25 text-emerald-300 cursor-default'
                      : 'bg-[#D99B26] text-[#0B1117] hover:bg-[#E5AE42]'
                  }`}
                >
                  {alreadySaved ? <Check className="w-3.5 h-3.5" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
                  <span>{alreadySaved ? 'In Vault' : 'Save to Vault'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>
);
