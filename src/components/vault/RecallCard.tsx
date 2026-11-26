import React, {useMemo, useState} from 'react';
import {Check, Loader2, Mic, MicOff, Volume2} from 'lucide-react';
import type {VocabFsrsRating, VocabItem} from '../../types';
import {getDialectInfo, getDomainInfo, LANGUAGE_LABELS, scorePhraseRecallMatch} from '../../utils/ilrLogic';
import {formatDueSummary, getFsrsIntervalPreviews} from '../../utils/vocabFsrs';
import {evaluateRecallSentence} from '../../services/api';
import {useSpeechRecognition} from '../../hooks/useSpeech';

interface RecallCardProps {
  card: VocabItem;
  /** 1-based position in the deck, for display. */
  position: number;
  deckSize: number;
  onGradeFsrs?: (rating: VocabFsrsRating) => void;
  onGrade: (mastery: VocabItem['mastery']) => void;
  onSpeak: (text: string, lang: string) => void;
}

/** Strips parenthetical notes such as "(formal)" from a term before speaking or scoring it. */
function stripNotes(term: string): string {
  return term.replace(/\s*\(.*?\)\s*/g, '').trim();
}

/**
 * One reverse active-recall card: recall the target phrase from its English concept (typed or
 * spoken), then use it in a sentence for AI coaching, then self-rate mastery. The parent remounts
 * this component for each card, which resets all per-card state.
 */
export const RecallCard: React.FC<RecallCardProps> = ({card, position, deckSize, onGradeFsrs, onGrade, onSpeak}) => {
  const [recallGuess, setRecallGuess] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [recallMatchScore, setRecallMatchScore] = useState<number | null>(null);
  const [usageSentence, setUsageSentence] = useState('');
  const [sentenceEval, setSentenceEval] = useState<{
    isNatural: boolean;
    feedback: string;
    polishedVersion: string;
  } | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const stt = useSpeechRecognition();

  const spokenTerm = stripNotes(card.term);
  const bcp47 = getDialectInfo(card.language, card.dialect).bcp47;
  const fsrsPreviews = useMemo(() => getFsrsIntervalPreviews(card), [card]);
  const dueSummary = useMemo(() => formatDueSummary(card), [card]);

  const handleFsrsRate = (rating: VocabFsrsRating) => {
    if (onGradeFsrs) {
      onGradeFsrs(rating);
      return;
    }
    onGrade(rating === 'again' ? 'new' : rating === 'easy' ? 'mastered' : 'practicing');
  };

  const handleCheckRecall = (e: React.FormEvent) => {
    e.preventDefault();
    const guess = (recallGuess || stt.finalTranscript).trim();
    setRecallMatchScore(guess ? scorePhraseRecallMatch(spokenTerm, guess) : 0);
    setRevealed(true);
    stt.stopListening();
  };

  const handleVoiceRecall = () => {
    if (stt.isListening) {
      stt.stopListening();
      if (stt.finalTranscript) {
        if (!revealed) setRecallGuess(stt.finalTranscript);
        else setUsageSentence(stt.finalTranscript);
      }
      return;
    }
    stt.resetTranscript();
    stt.startListening({
      lang: bcp47,
      continuous: false,
      onFinalSegment: (seg) => {
        if (!revealed) setRecallGuess((prev) => (prev ? `${prev} ${seg}` : seg));
        else setUsageSentence((prev) => (prev ? `${prev} ${seg}` : seg));
      },
    });
  };

  const handleEvaluateSentence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usageSentence.trim()) return;
    setEvalLoading(true);
    setEvalError(null);
    try {
      const res = await evaluateRecallSentence({
        language: card.language,
        targetTerm: card.term,
        userSentence: usageSentence.trim(),
        domain: card.domain ?? 'general_policy',
      });
      setSentenceEval(res);
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : 'Unable to evaluate sentence.');
    } finally {
      setEvalLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto rounded-xl border border-[#23303E] bg-[#111922] p-5 sm:p-7 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#94A3B8]">
        <span>
          FSRS Active Recall · Card{' '}
          <span className="font-mono text-[#F8FAFC] tabular-nums">
            {position}/{deckSize}
          </span>
          <span className="mx-1.5" aria-hidden="true">
            ·
          </span>
          <span className="text-[#F3C669]">{dueSummary}</span>
        </span>
        <span>
          Target: <strong className="text-[#E6EDF3]">{LANGUAGE_LABELS[card.language]}</strong> · {card.category}
        </span>
      </div>

      {/* Step 1: English Concept Only (Target Term Hidden!) */}
      <div className="space-y-2 py-2">
        <p className="text-xs text-[#7D8FA3]">Recall the {LANGUAGE_LABELS[card.language]} expression for:</p>
        <h2 data-testid="recall-english-prompt" className="text-2xl font-semibold text-[#F8FAFC] leading-snug">
          {card.englishConcept}
        </h2>
        <p className="text-xs text-[#94A3B8]">
          Register target: {card.registerTag}
          {card.domain
            ? ` · Domain: ${getDomainInfo(card.domain).shortLabel}`
            : card.regionTag
              ? ` · ${card.regionTag}`
              : ''}
        </p>
      </div>

      {!revealed ? (
        <form onSubmit={handleCheckRecall} className="space-y-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleVoiceRecall}
              aria-label={stt.isListening ? 'Stop voice recall' : 'Speak target phrase from memory'}
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border transition-colors shrink-0 ${
                stt.isListening
                  ? 'border-red-500 bg-red-600 text-white'
                  : 'border-[#2E4054] bg-[#16202B] text-[#E6EDF3] hover:bg-[#1E2C3A]'
              }`}
            >
              {stt.isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            <label htmlFor="recall-attempt-input" className="sr-only">
              Type or speak the target term from memory
            </label>
            <input
              id="recall-attempt-input"
              type="text"
              value={recallGuess}
              onChange={(e) => setRecallGuess(e.target.value)}
              placeholder={`Speak or type the ${LANGUAGE_LABELS[card.language]} phrase from memory…`}
              className="flex-1 min-h-[44px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3.5 py-2 text-sm text-[#E6EDF3] placeholder:text-[#64748B] focus:outline-none focus:border-[#D99B26]"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setRecallMatchScore(0);
                setRevealed(true);
              }}
              className="px-3.5 py-2 min-h-[42px] rounded-lg text-xs font-medium text-[#94A3B8] hover:text-white"
            >
              Reveal Answer
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 min-h-[44px] rounded-lg bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
            >
              Check Recall
            </button>
          </div>
        </form>
      ) : (
        /* Step 2: Reveal Target Term + Full Operational Sentence Prompt */
        <div className="space-y-6 pt-4 border-t border-[#23303E]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs text-[#94A3B8]">
                Target Expression
                {recallMatchScore !== null && (
                  <>
                    <span className="mx-1.5" aria-hidden="true">
                      ·
                    </span>
                    <span
                      className={`font-mono font-semibold tabular-nums ${
                        recallMatchScore >= 75 ? 'text-emerald-400' : 'text-amber-300'
                      }`}
                    >
                      {recallMatchScore}% recall match
                    </span>
                  </>
                )}
              </p>
              <p data-testid="recall-revealed-term" className="text-2xl font-bold text-[#F3C669]">
                {card.term}
              </p>
              <p className="text-sm text-[#CBD5E1] italic mt-1">&ldquo;{card.contextSentence}&rdquo;</p>
            </div>

            <button
              type="button"
              onClick={() => onSpeak(spokenTerm, bcp47)}
              className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg border border-[#2E4054] bg-[#16202B] text-xs font-medium text-[#E6EDF3] hover:bg-[#1E2C3A]"
            >
              <Volume2 className="w-4 h-4 text-[#D99B26]" />
              <span>Listen</span>
            </button>
          </div>

          {/* Production step: use it in a full operational sentence */}
          <form onSubmit={handleEvaluateSentence} className="space-y-3 pt-4 border-t border-[#23303E]">
            <label htmlFor="recall-sentence-input" className="block text-xs font-semibold text-[#E6EDF3]">
              Step 2 — Use &ldquo;{spokenTerm}&rdquo; in a full operational sentence:
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleVoiceRecall}
                aria-label={stt.isListening ? 'Stop speaking sentence' : 'Speak full sentence'}
                className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border shrink-0 ${
                  stt.isListening
                    ? 'border-red-500 bg-red-600 text-white'
                    : 'border-[#2E4054] bg-[#16202B] text-[#E6EDF3]'
                }`}
              >
                {stt.isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <input
                id="recall-sentence-input"
                type="text"
                value={usageSentence}
                onChange={(e) => setUsageSentence(e.target.value)}
                placeholder={`Produce a complete ${LANGUAGE_LABELS[card.language]} sentence…`}
                className="flex-1 min-h-[44px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3.5 py-2 text-sm text-[#E6EDF3] placeholder:text-[#64748B] focus:outline-none focus:border-[#D99B26]"
              />
              <button
                type="submit"
                disabled={!usageSentence.trim() || evalLoading}
                className="px-4 py-2 min-h-[44px] rounded-lg border border-[#2E4054] bg-[#16202B] text-xs font-semibold text-[#F8FAFC] hover:bg-[#1E2C3A] disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                {evalLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Coach Check'}
              </button>
            </div>

            {evalError && (
              <p className="text-xs text-red-300" role="alert">
                {evalError}
              </p>
            )}

            {sentenceEval && (
              <div className="rounded-lg border border-[#23303E] bg-[#0B1117] p-3.5 space-y-1.5">
                <p
                  className={`text-xs font-semibold ${sentenceEval.isNatural ? 'text-emerald-400' : 'text-amber-300'}`}
                >
                  {sentenceEval.isNatural ? 'Natural Operational Register' : 'Register Adjustment Suggested'}
                </p>
                <p className="text-xs text-[#CBD5E1]">{sentenceEval.feedback}</p>
                <p className="text-xs text-[#94A3B8]">
                  Polished: <span className="text-[#F8FAFC]">{sentenceEval.polishedVersion}</span>
                </p>
              </div>
            )}
          </form>

          {/* FSRS Self-Rating & Next Card */}
          <div className="space-y-2.5 pt-4 border-t border-[#23303E]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-[#94A3B8]">Rate recall (FSRS schedule):</span>
              <span className="font-mono text-[11px] text-[#7D8FA3] tabular-nums">
                {card.reviewCount} {card.reviewCount === 1 ? 'review' : 'reviews'}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => handleFsrsRate('again')}
                className="flex flex-col items-center justify-center px-3 py-2 min-h-[48px] rounded-lg border border-red-500/35 bg-red-950/20 text-xs font-semibold text-red-300 hover:bg-red-950/40 transition-colors"
              >
                <span>Again</span>
                <span className="font-mono text-[11px] text-red-300/80 tabular-nums">{fsrsPreviews.again}</span>
              </button>
              <button
                type="button"
                onClick={() => handleFsrsRate('hard')}
                className="flex flex-col items-center justify-center px-3 py-2 min-h-[48px] rounded-lg border border-amber-500/35 bg-amber-950/20 text-xs font-semibold text-amber-300 hover:bg-amber-950/40 transition-colors"
              >
                <span>Hard</span>
                <span className="font-mono text-[11px] text-amber-300/80 tabular-nums">{fsrsPreviews.hard}</span>
              </button>
              <button
                type="button"
                onClick={() => handleFsrsRate('good')}
                className="flex flex-col items-center justify-center px-3 py-2 min-h-[48px] rounded-lg border border-sky-500/35 bg-sky-950/20 text-xs font-semibold text-[#7DD3FC] hover:bg-sky-950/40 transition-colors"
              >
                <span>Good</span>
                <span className="font-mono text-[11px] text-[#7DD3FC]/80 tabular-nums">{fsrsPreviews.good}</span>
              </button>
              <button
                type="button"
                onClick={() => handleFsrsRate('easy')}
                className="flex flex-col items-center justify-center px-3 py-2 min-h-[48px] rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-xs font-semibold text-emerald-300 hover:bg-emerald-600/30 transition-colors"
              >
                <span className="inline-flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  Easy
                </span>
                <span className="font-mono text-[11px] text-emerald-300/80 tabular-nums">{fsrsPreviews.easy}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
