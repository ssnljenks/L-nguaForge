import React, {useEffect, useState} from 'react';
import {BookmarkPlus, Check, ExternalLink, Loader2, Sparkles, X} from 'lucide-react';
import type {BriefItem, MissionConfig, VocabItem} from '../../types';
import {fetchBriefStudyExcerpt} from '../../services/api';
import {type SaveVocabFn, useWordLookup} from '../../hooks/useWordLookup';
import {TappableText} from '../shared/TappableText';
import {WordLookupPopover} from '../shared/WordLookupPopover';

interface BriefStudySheetProps {
  item: BriefItem;
  config: MissionConfig;
  vocabItems: VocabItem[];
  onClose: () => void;
  onSaveVocab: SaveVocabFn;
}

export const BriefStudySheet: React.FC<BriefStudySheetProps> = ({item, config, vocabItems, onClose, onSaveVocab}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [studyData, setStudyData] = useState<{
    excerpt: string;
    keyVocabulary: {term: string; english: string}[];
  } | null>(null);
  const [savedTerms, setSavedTerms] = useState<Set<string>>(new Set());

  const wordLookup = useWordLookup({
    config,
    vocabItems,
    onSaveVocab,
    vocabSource: 'brief',
    omitDomain: !config.workFocusEnabled,
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    fetchBriefStudyExcerpt(item.id)
      .then((data) => {
        if (!active) return;
        setStudyData({
          excerpt: data.excerpt,
          keyVocabulary: data.keyVocabulary,
        });
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        // Fallback to item summary if server excerpt fetch fails
        setStudyData({
          excerpt: item.summary,
          keyVocabulary: [],
        });
        setError(err instanceof Error ? err.message : 'Could not load extended excerpt.');
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [item.id, item.summary]);

  const handleQuickSaveVocab = (term: string, meaning: string) => {
    onSaveVocab({
      term,
      englishConcept: meaning,
      contextSentence: studyData?.excerpt?.slice(0, 160) || item.title,
      registerTag: 'Standard Press',
      category: config.workFocusEnabled ? 'Operational/Military Terms' : 'High-Register Connectors',
      source: 'brief',
      language: item.language,
      dialect: item.dialectId,
    });
    setSavedTerms((prev) => new Set(prev).add(term.toLowerCase()));
  };

  const isTermSaved = (term: string) => {
    const norm = term.toLowerCase();
    return (
      savedTerms.has(norm) ||
      vocabItems.some((v) => v.language === item.language && v.term.trim().toLowerCase() === norm)
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="brief-study-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm"
    >
      <div className="relative flex flex-col w-full max-w-2xl max-h-[90vh] rounded-2xl border border-[#23303E] bg-[#111922] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5 border-b border-[#23303E] bg-[#0B1117]">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#D99B26]">
              <span>Study Excerpt · Level {item.ilrLevel}</span>
            </div>
            <h2 id="brief-study-title" className="text-lg font-semibold text-[#F8FAFC] mt-0.5 line-clamp-1">
              {item.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close study sheet"
            className="p-2 text-[#94A3B8] hover:text-white rounded-lg hover:bg-[#16202B] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {/* Orientation line */}
          <p className="text-xs sm:text-sm italic text-[#94A3B8] leading-relaxed">{item.orientationLine}</p>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-[#94A3B8] gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-[#D99B26]" />
              <span className="text-sm">Loading authentic excerpt…</span>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Tap-to-lookup study passage */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#7DD3FC]">
                    Target Language Excerpt
                  </span>
                  <span className="text-xs text-[#94A3B8]">Tap any word to inspect</span>
                </div>

                <div className="p-4 rounded-xl border border-[#23303E] bg-[#0B1117] text-sm sm:text-base text-[#F8FAFC] leading-relaxed">
                  <TappableText
                    text={studyData?.excerpt || item.summary}
                    activeWord={wordLookup.lookup?.word}
                    onWordTap={(w) => void wordLookup.lookUpWord('study-sheet', w, studyData?.excerpt || item.summary)}
                  />
                </div>
              </div>

              {/* Word Lookup Popover */}
              {wordLookup.lookup && (
                <WordLookupPopover
                  lookup={wordLookup.lookup}
                  onClose={wordLookup.close}
                  onRetry={wordLookup.retry}
                  onSave={wordLookup.save}
                  loadingLabel="Looking up meaning…"
                />
              )}

              {/* Key Vocabulary Chips */}
              {studyData?.keyVocabulary && studyData.keyVocabulary.length > 0 && (
                <div className="space-y-2.5 pt-3 border-t border-[#23303E]">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
                    <Sparkles className="w-3.5 h-3.5 text-[#D99B26]" />
                    <span>Key Target Vocabulary</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {studyData.keyVocabulary.map((kv) => {
                      const saved = isTermSaved(kv.term);
                      return (
                        <div
                          key={kv.term}
                          className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-[#23303E] bg-[#0B1117]"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-[#F8FAFC] truncate">{kv.term}</p>
                            <p className="text-[11px] text-[#94A3B8] truncate">{kv.english}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleQuickSaveVocab(kv.term, kv.english)}
                            disabled={saved}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition-colors shrink-0 ${
                              saved
                                ? 'bg-[#16202B] text-[#7DD3FC] opacity-80 cursor-default'
                                : 'bg-[#D99B26] text-[#0B1117] hover:bg-[#E5AE42]'
                            }`}
                          >
                            {saved ? <Check className="w-3 h-3" /> : <BookmarkPlus className="w-3 h-3" />}
                            <span>{saved ? 'Saved' : 'Save'}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {error && <p className="text-xs text-[#94A3B8]">Note: Extended excerpt offline; showing summary.</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-t border-[#23303E] bg-[#0B1117] text-xs">
          <p className="italic text-[#7D8FA3]">Sources are linked or embedded, never copied.</p>
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[#7DD3FC] hover:underline font-medium min-h-[44px]"
          >
            <span>Read full story at {item.sourceName}</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
};
