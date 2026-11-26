import React, {useMemo, useState} from 'react';
import {Brain, Check, CheckCircle2, Volume2, X} from 'lucide-react';
import type {DrillHistoryEntry, MissionConfig, VocabFsrsRating, VocabItem} from '../../types';
import {getDialectInfo, LANGUAGE_LABELS} from '../../utils/ilrLogic';
import {getFsrsIntervalPreviews} from '../../utils/vocabFsrs';
import {useSpeechSynthesis} from '../../hooks/useSpeech';
import {createId} from '../../utils/ids';

interface VocabWarmupModalProps {
  cards: VocabItem[];
  config: MissionConfig;
  onReviewFsrs: (id: string, rating: VocabFsrsRating) => void;
  onLogHistory: (entry: DrillHistoryEntry) => void;
  onComplete: () => void;
  onClose: () => void;
}

function stripNotes(term: string): string {
  return term.replace(/\s*\(.*?\)\s*/g, '').trim();
}

export const VocabWarmupModal: React.FC<VocabWarmupModalProps> = ({
  cards,
  config,
  onReviewFsrs,
  onLogHistory,
  onComplete,
  onClose,
}) => {
  // Snapshot the warm-up batch on mount so reviewing a card doesn't shrink the array mid-session
  const [deck] = useState<VocabItem[]>(() => cards);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [ratedCounts, setRatedCounts] = useState({again: 0, hard: 0, good: 0, easy: 0});

  const tts = useSpeechSynthesis();
  const currentCard = deck[index] ?? null;

  const previews = useMemo(() => (currentCard ? getFsrsIntervalPreviews(currentCard) : null), [currentCard]);

  const handleRate = (rating: VocabFsrsRating) => {
    if (!currentCard) return;
    onReviewFsrs(currentCard.id, rating);
    const nextCounts = {...ratedCounts, [rating]: ratedCounts[rating] + 1};
    setRatedCounts(nextCounts);

    if (index + 1 >= deck.length) {
      setFinished(true);
      onLogHistory({
        id: createId('hist-warmup'),
        module: 'vocab_recall',
        language: config.language,
        dialect: config.dialect,
        domain: config.domain,
        completedAt: new Date().toISOString(),
        summary: `Today's Vocab Warm-up (${deck.length} FSRS ${deck.length === 1 ? 'card' : 'cards'})`,
        scoreLabel: `${nextCounts.good + nextCounts.easy}/${deck.length} recalled`,
      });
      onComplete();
    } else {
      setIndex((i) => i + 1);
      setRevealed(false);
    }
  };

  const progressPct = deck.length > 0 ? Math.round(((finished ? deck.length : index) / deck.length) * 100) : 100;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vocab-warmup-title"
    >
      <button
        type="button"
        aria-label="Close vocab warm-up"
        onClick={onClose}
        className="fixed inset-0 bg-black/75 backdrop-blur-sm cursor-default"
      />

      <div className="relative z-10 w-full sm:max-w-xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[#23303E] bg-[#111922] p-5 sm:p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#23303E]">
          <div className="flex items-center gap-2.5 min-w-0">
            <Brain className="w-5 h-5 text-[#D99B26] shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-[#F3C669]">Today&apos;s plan · Step 1 of 3</p>
              <h2 id="vocab-warmup-title" className="font-display text-base font-semibold text-[#F8FAFC] truncate">
                Vocab warm-up · FSRS
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close warm-up"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-[#94A3B8] hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-[#94A3B8]">
            <span>{LANGUAGE_LABELS[config.language]} due cards</span>
            <span className="font-mono tabular-nums text-[#F8FAFC]">
              {finished ? deck.length : Math.min(index + 1, deck.length)} of {deck.length}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-[#1C2836] overflow-hidden">
            <div className="h-full bg-[#D99B26] transition-all duration-300" style={{width: `${progressPct}%`}} />
          </div>
        </div>

        {deck.length === 0 ? (
          <div className="py-6 text-center space-y-4">
            <p className="text-sm text-[#CBD5E1]">
              No {LANGUAGE_LABELS[config.language]} cards saved yet. Save expressions in Talk or Brief to build your
              FSRS deck.
            </p>
            <button
              type="button"
              onClick={() => {
                onComplete();
                onClose();
              }}
              className="min-h-[52px] px-6 rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
            >
              Mark done &amp; return to Today
            </button>
          </div>
        ) : finished ? (
          <div data-testid="vocab-warmup-complete" className="py-4 space-y-5 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <div className="space-y-1">
              <h3 className="font-display text-xl font-semibold text-[#F8FAFC]">Warm-up complete</h3>
              <p className="text-sm text-[#94A3B8]">
                Reviewed <span className="font-mono text-[#F8FAFC] tabular-nums">{deck.length}</span>{' '}
                {deck.length === 1 ? 'card' : 'cards'}. Next intervals updated with FSRS.
              </p>
            </div>
            <button
              type="button"
              data-testid="vocab-warmup-return-btn"
              onClick={onClose}
              className="w-full min-h-[52px] rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
            >
              Return to Today
            </button>
          </div>
        ) : currentCard && previews ? (
          <div className="space-y-5">
            <div className="rounded-xl border border-[#23303E] bg-[#0B1117] p-5 space-y-3">
              <p className="text-xs text-[#7D8FA3]">
                Recall the {LANGUAGE_LABELS[currentCard.language]} expression · {currentCard.registerTag}
              </p>
              <p className="font-display text-xl sm:text-2xl font-semibold text-[#F8FAFC] leading-snug">
                {currentCard.englishConcept}
              </p>

              {revealed && (
                <div className="pt-4 mt-3 border-t border-[#23303E] space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-display text-2xl font-bold text-[#F3C669]">{currentCard.term}</p>
                    <button
                      type="button"
                      onClick={() =>
                        tts.speak(stripNotes(currentCard.term), {
                          lang: getDialectInfo(currentCard.language, currentCard.dialect).bcp47,
                          rate: config.speechRate,
                          voiceURI: config.voiceURI,
                        })
                      }
                      aria-label="Pronounce term"
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-[#23303E] bg-[#111922] text-[#D99B26] hover:border-[#D99B26]/50 shrink-0"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                  </div>
                  {currentCard.contextSentence && (
                    <p className="text-sm text-[#CBD5E1] italic leading-relaxed">
                      &ldquo;{currentCard.contextSentence}&rdquo;
                    </p>
                  )}
                </div>
              )}
            </div>

            {!revealed ? (
              <button
                type="button"
                data-testid="vocab-warmup-reveal"
                onClick={() => setRevealed(true)}
                className="w-full min-h-[52px] rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
              >
                Show answer
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-[#94A3B8]">How well did you recall it?</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    data-testid="vocab-warmup-rate-again"
                    onClick={() => handleRate('again')}
                    className="flex flex-col items-center justify-center min-h-[50px] rounded-xl border border-red-500/35 bg-red-950/20 text-xs font-semibold text-red-300 hover:bg-red-950/40 transition-colors"
                  >
                    <span>Again</span>
                    <span className="font-mono text-[11px] text-red-300/80 tabular-nums">{previews.again}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="vocab-warmup-rate-hard"
                    onClick={() => handleRate('hard')}
                    className="flex flex-col items-center justify-center min-h-[50px] rounded-xl border border-amber-500/35 bg-amber-950/20 text-xs font-semibold text-amber-300 hover:bg-amber-950/40 transition-colors"
                  >
                    <span>Hard</span>
                    <span className="font-mono text-[11px] text-amber-300/80 tabular-nums">{previews.hard}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="vocab-warmup-rate-good"
                    onClick={() => handleRate('good')}
                    className="flex flex-col items-center justify-center min-h-[50px] rounded-xl border border-sky-500/35 bg-sky-950/20 text-xs font-semibold text-[#7DD3FC] hover:bg-sky-950/40 transition-colors"
                  >
                    <span>Good</span>
                    <span className="font-mono text-[11px] text-[#7DD3FC]/80 tabular-nums">{previews.good}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="vocab-warmup-rate-easy"
                    onClick={() => handleRate('easy')}
                    className="flex flex-col items-center justify-center min-h-[50px] rounded-xl border border-emerald-500/40 bg-emerald-600/20 text-xs font-semibold text-emerald-300 hover:bg-emerald-600/30 transition-colors"
                  >
                    <span className="inline-flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      Easy
                    </span>
                    <span className="font-mono text-[11px] text-emerald-300/80 tabular-nums">{previews.easy}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};
