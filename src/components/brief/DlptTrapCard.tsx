import React, {useState} from 'react';
import {AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Quote} from 'lucide-react';
import type {BriefDrillQuestion, DlptChoiceDetail} from '../../types';
import {CHOICE_LETTERS, TRAP_TYPE_META} from '../../utils/dlptRules';

interface DlptTrapCardProps {
  question: BriefDrillQuestion;
  userChoiceIndex: number | undefined;
}

export const DlptTrapCard: React.FC<DlptTrapCardProps> = ({question, userChoiceIndex}) => {
  const [showAllChoices, setShowAllChoices] = useState(false);

  const choices: DlptChoiceDetail[] =
    question.choices && question.choices.length === 4
      ? question.choices
      : question.options.slice(0, 4).map((text, idx) => ({
          label: CHOICE_LETTERS[idx] ?? 'A',
          text,
          isCorrect: idx === question.correctIndex,
          justification:
            idx === question.correctIndex
              ? question.rationaleEnglish || question.explanation
              : 'This option is not supported by the source passage.',
          trapType: idx === question.correctIndex ? null : 'not_in_passage',
        }));

  const correctChoice = choices[question.correctIndex] ?? choices[0];
  const userPickedWrong =
    typeof userChoiceIndex === 'number' &&
    userChoiceIndex >= 0 &&
    userChoiceIndex < choices.length &&
    userChoiceIndex !== question.correctIndex;

  const wrongChoice = userPickedWrong ? choices[userChoiceIndex] : null;
  const wrongTrapMeta = wrongChoice?.trapType ? TRAP_TYPE_META[wrongChoice.trapType] : null;
  const otherDistractors = choices.filter((_, idx) => idx !== question.correctIndex && idx !== userChoiceIndex);

  return (
    <div className="pt-3 border-t border-[#23303E] space-y-3">
      {/* Primary Trap Card when the learner picked a distractor */}
      {wrongChoice && (
        <div
          data-testid={`trap-card-${question.id}`}
          className="rounded-xl border border-[#F87171]/45 bg-[#F87171]/8 p-3.5 space-y-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#F87171] shrink-0" />
              <span className="text-xs sm:text-sm font-semibold text-[#FECACA]">
                Why ({wrongChoice.label}) is a trap
              </span>
            </div>
            {wrongTrapMeta && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-[#F87171]/40 bg-[#F87171]/15 font-mono text-[11px] font-medium text-[#FCA5A5]">
                {wrongTrapMeta.label}
              </span>
            )}
          </div>

          <p className="text-xs sm:text-sm text-[#E2E8F0] leading-relaxed">{wrongChoice.justification}</p>

          {question.sourceQuote && (
            <div className="flex items-start gap-2 pt-1 text-xs text-[#94A3B8]">
              <Quote className="w-3.5 h-3.5 text-[#7DD3FC] shrink-0 mt-0.5" />
              <span className="italic text-[#CBD5E1]">“{question.sourceQuote}”</span>
            </div>
          )}
        </div>
      )}

      {/* Correct answer evidence */}
      <div className="rounded-xl border border-[#7DD3FC]/35 bg-[#7DD3FC]/8 p-3.5 space-y-1.5">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[#7DD3FC] shrink-0" />
          <span className="text-xs sm:text-sm font-semibold text-[#7DD3FC]">
            Why ({correctChoice.label}) is supported
          </span>
        </div>
        <p className="text-xs sm:text-sm text-[#E2E8F0] leading-relaxed">{correctChoice.justification}</p>
        {!wrongChoice && question.sourceQuote && (
          <div className="flex items-start gap-2 pt-1 text-xs text-[#94A3B8]">
            <Quote className="w-3.5 h-3.5 text-[#7DD3FC] shrink-0 mt-0.5" />
            <span className="italic text-[#CBD5E1]">“{question.sourceQuote}”</span>
          </div>
        )}
      </div>

      {/* Expandable breakdown of remaining wrong choices */}
      {otherDistractors.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowAllChoices((prev) => !prev)}
            className="inline-flex items-center gap-1.5 min-h-[44px] text-xs font-medium text-[#94A3B8] hover:text-[#F8FAFC] transition-colors"
          >
            {showAllChoices ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span>
              {showAllChoices
                ? 'Hide other distractors'
                : `Inspect ${otherDistractors.length} other ${otherDistractors.length === 1 ? 'trap' : 'traps'}`}
            </span>
          </button>

          {showAllChoices && (
            <div className="mt-2 space-y-2">
              {otherDistractors.map((choice) => {
                const meta = choice.trapType ? TRAP_TYPE_META[choice.trapType] : null;
                return (
                  <div key={choice.label} className="rounded-lg border border-[#23303E] bg-[#111922] p-3 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#CBD5E1]">Why ({choice.label}) is a trap</span>
                      {meta && (
                        <span className="px-2 py-0.5 rounded border border-[#23303E] bg-[#16202B] font-mono text-[10px] text-[#94A3B8]">
                          {meta.label}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#94A3B8] leading-relaxed">{choice.justification}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
