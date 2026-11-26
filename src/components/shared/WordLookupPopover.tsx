import React, {useEffect, useRef} from 'react';
import {BookmarkPlus, Check, Loader2, X} from 'lucide-react';
import type {WordLookupState} from '../../hooks/useWordLookup';
import {WORD_SOURCE_LABELS} from './lookupLabels';

interface WordLookupPopoverProps {
  lookup: WordLookupState;
  onClose: () => void;
  onRetry: (forceAi?: boolean) => void;
  onSave: () => void;
  loadingLabel?: string;
  /** Compact sizing for the Free Chat caption pane. */
  compact?: boolean;
}

/** Inline card under a tapped message: meaning, register, retry / "ask AI", and save-to-vault. */
export const WordLookupPopover: React.FC<WordLookupPopoverProps> = ({
  lookup,
  onClose,
  onRetry,
  onSave,
  loadingLabel = 'Looking up meaning…',
  compact = false,
}) => {
  const ref = useRef<HTMLDivElement | null>(null);

  // Keep the card fully visible inside the scrolling transcript pane.
  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      ref.current?.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [lookup.word, lookup.loading]);

  const {result} = lookup;
  const meta = result
    ? [WORD_SOURCE_LABELS[result.source], result.registerTag, result.suggestedCategory].filter(Boolean).join(' · ')
    : '';
  const smallText = compact ? 'text-[11px]' : 'text-xs';

  return (
    <div
      ref={ref}
      role="region"
      aria-label={`Word lookup for ${lookup.word}`}
      aria-busy={lookup.loading}
      className={`mt-2.5 w-full ${compact ? 'max-w-sm space-y-2' : 'max-w-md shadow-lg space-y-2.5'} rounded-xl border border-[#D99B26]/45 bg-[#0D141C] p-3.5`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#F8FAFC]">{lookup.word}</p>
          {meta && <p className={`${smallText} text-[#94A3B8]`}>{meta}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close word lookup"
          className="p-1 text-[#94A3B8] hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {lookup.loading && (
        <div className="flex items-center gap-2 text-xs text-[#94A3B8]" role="status">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D99B26]" />
          <span>{loadingLabel}</span>
        </div>
      )}

      {lookup.error && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-red-300" role="alert">
            {lookup.error}
          </p>
          <button
            type="button"
            onClick={() => onRetry()}
            className="px-2.5 py-1 rounded-md border border-[#2E4054] bg-[#16202B] text-xs font-medium text-[#F8FAFC] hover:bg-[#1E2C3A] shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {result && (
        <>
          <p className="text-sm text-[#E6EDF3] font-medium">{result.contextualMeaning}</p>
          {result.grammarNote && <p className="text-xs text-[#94A3B8] leading-relaxed">{result.grammarNote}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {result.source !== 'ai' ? (
              <button
                type="button"
                onClick={() => onRetry(true)}
                className={`${smallText} font-medium text-[#94A3B8] hover:text-[#F3C669] hover:underline`}
              >
                Ask AI for sentence context
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={onSave}
              disabled={lookup.saved}
              className="min-h-[52px] flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] disabled:opacity-70 transition-colors"
            >
              {lookup.saved ? <Check className="w-3.5 h-3.5" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
              <span>{lookup.saved ? 'Saved to Vocab' : 'Save to Vocab'}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};
