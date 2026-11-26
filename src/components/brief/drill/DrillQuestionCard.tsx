import React from 'react';
import {BookmarkPlus, Check, CheckCircle2, XCircle} from 'lucide-react';
import type {BriefDrillQuestion} from '../../../types';
import {CHOICE_LETTERS, QUESTION_TYPE_LABELS} from '../../../utils/dlptRules';
import {DlptTrapCard} from '../DlptTrapCard';

interface DrillQuestionCardProps {
  question: BriefDrillQuestion;
  index: number;
  total: number;
  userChoice: number | undefined;
  showFeedback: boolean;
  onSelect: (optionIndex: number) => void;
  isTermSaved: (term: string) => boolean;
  onSaveTerm: (term: string, english: string) => void;
}

/** One DLPT question: four radio choices, then (Practice, after checking) the trap card and key terms. */
export const DrillQuestionCard: React.FC<DrillQuestionCardProps> = ({
  question: q,
  index: qIdx,
  total,
  userChoice,
  showFeedback,
  onSelect,
  isTermSaved,
  onSaveTerm,
}) => {
  const isCorrect = userChoice === q.correctIndex;
  const qTypeLabel = q.questionType ? QUESTION_TYPE_LABELS[q.questionType] : null;

  return (
    <fieldset className="p-4 sm:p-5 rounded-xl border border-[#23303E] bg-[#0B1117] space-y-3.5">
      <legend className="sr-only">
        Question {qIdx + 1}: {q.questionEnglish || q.question}
      </legend>

      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#94A3B8]">
            <span className="font-mono font-semibold text-[#7DD3FC] tabular-nums">
              Question {qIdx + 1} of {total}
            </span>
            {qTypeLabel && showFeedback && (
              <>
                <span aria-hidden="true">·</span>
                <span>{qTypeLabel}</span>
              </>
            )}
          </div>
          <p className="text-sm sm:text-base font-semibold text-[#F8FAFC] leading-snug">
            {q.questionEnglish || q.question}
          </p>
        </div>

        {showFeedback && (
          <span className="shrink-0 flex items-center gap-1 text-xs font-semibold">
            {isCorrect ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-[#7DD3FC]" />
                <span className="text-[#7DD3FC]">Correct</span>
              </>
            ) : (
              <>
                <XCircle className="w-5 h-5 text-[#F87171]" />
                <span className="text-[#F87171]">Missed</span>
              </>
            )}
          </span>
        )}
      </div>

      {/* 4 Radio Choices (>= 44px tall each) */}
      <div className="space-y-2">
        {q.options.slice(0, 4).map((optionText, optIdx) => {
          const letter = CHOICE_LETTERS[optIdx] ?? 'A';
          const isSelected = userChoice === optIdx;
          let choiceClasses = 'border-[#23303E] bg-[#111922] text-[#CBD5E1] hover:border-[#35495E]';

          if (showFeedback) {
            if (optIdx === q.correctIndex) {
              choiceClasses = 'border-[#7DD3FC] bg-[#7DD3FC]/12 text-[#F8FAFC] font-medium';
            } else if (isSelected && !isCorrect) {
              choiceClasses = 'border-[#F87171] bg-[#F87171]/12 text-[#FECACA]';
            } else {
              choiceClasses = 'border-[#23303E] bg-[#111922]/50 text-[#7D8FA3] opacity-70';
            }
          } else if (isSelected) {
            choiceClasses = 'border-[#D99B26] bg-[#D99B26]/12 text-[#F8FAFC] font-medium';
          }

          return (
            <label
              key={letter}
              className={`flex items-start gap-3 px-3.5 py-3 rounded-xl border min-h-[44px] transition-colors ${
                showFeedback ? 'cursor-default' : 'cursor-pointer'
              } ${choiceClasses}`}
            >
              <input
                type="radio"
                name={`question-${q.id}`}
                checked={isSelected}
                disabled={showFeedback}
                onChange={() => onSelect(optIdx)}
                className="mt-1 h-4 w-4 accent-[#D99B26] shrink-0 cursor-pointer"
              />
              <span className="font-mono text-xs font-bold mt-0.5 shrink-0 text-[#94A3B8]">({letter})</span>
              <span className="text-xs sm:text-sm leading-relaxed flex-1">{optionText}</span>
              {showFeedback && optIdx === q.correctIndex && (
                <span className="text-[11px] font-semibold text-[#7DD3FC] shrink-0">Correct</span>
              )}
              {showFeedback && isSelected && !isCorrect && (
                <span className="text-[11px] font-semibold text-[#F87171] shrink-0">Your pick</span>
              )}
            </label>
          );
        })}
      </div>

      {/* Practice Mode Per-Page Trap Card & Vocab */}
      {showFeedback && (
        <>
          <DlptTrapCard question={q} userChoiceIndex={userChoice} />

          {(q.targetVocabulary || []).length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] font-semibold text-[#94A3B8]">Key terms:</span>
              {(q.targetVocabulary || []).map((tv) => {
                const saved = isTermSaved(tv.term);
                return (
                  <button
                    key={tv.term}
                    type="button"
                    disabled={saved}
                    onClick={() => onSaveTerm(tv.term, tv.english)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 min-h-[44px] rounded-lg text-[11px] font-medium border transition-colors ${
                      saved
                        ? 'border-[#23303E] bg-[#16202B] text-[#7DD3FC]'
                        : 'border-[#D99B26]/40 bg-[#D99B26]/10 text-[#F3C669] hover:bg-[#D99B26]/20'
                    }`}
                  >
                    {saved ? <Check className="w-3 h-3" /> : <BookmarkPlus className="w-3 h-3" />}
                    <span>
                      {tv.term} ({tv.english})
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </fieldset>
  );
};
