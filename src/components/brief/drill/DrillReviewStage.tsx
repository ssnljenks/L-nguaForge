import React, {useState} from 'react';
import {AlertTriangle, ArrowLeft, ArrowRight, ClipboardCheck, Flag} from 'lucide-react';
import type {BriefDrill, BriefItem} from '../../../types';
import type {DlptRuleProfile} from '../../../utils/dlptRules';
import {ModalBody, ModalFooter} from '../modalLayout';

export interface DrillReviewPage {
  passage: BriefItem;
  drill: BriefDrill | undefined;
  questionIds: string[];
}

interface DrillReviewStageProps {
  profile: DlptRuleProfile;
  pages: DrillReviewPage[];
  selectedAnswers: Record<string, number>;
  flaggedPassages: Record<string, boolean>;
  totalUnanswered: number;
  onOpenPassage: (index: number) => void;
  onBackToPassages: () => void;
  onSubmit: () => void;
}

/** Review stage (PT Lower-Range): every passage with its answered count, then submit. */
export const DrillReviewStage: React.FC<DrillReviewStageProps> = ({
  profile,
  pages,
  selectedAnswers,
  flaggedPassages,
  totalUnanswered,
  onOpenPassage,
  onBackToPassages,
  onSubmit,
}) => {
  // Mounted fresh each time the review opens, so the confirmation always starts closed.
  const [confirmUnansweredSubmit, setConfirmUnansweredSubmit] = useState(false);

  const handleSubmit = () => {
    if (totalUnanswered > 0 && !confirmUnansweredSubmit) {
      setConfirmUnansweredSubmit(true);
      return;
    }
    onSubmit();
  };

  return (
    <>
      <ModalBody>
        <div className="space-y-5">
          <div className="rounded-xl border border-[#7DD3FC]/35 bg-[#7DD3FC]/8 p-4 space-y-1.5">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-[#7DD3FC]" />
              <h2 id="brief-drill-title" className="text-base font-semibold text-[#F8FAFC]">
                Review before submitting ({profile.pillLabel})
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-[#CBD5E1] leading-relaxed">
              Select any passage below to return and change answers. Audio recordings remain locked and will not replay.
            </p>
          </div>

          {/* No-guessing-penalty warning for any unanswered questions */}
          {profile.warnUnansweredBeforeSubmit && totalUnanswered > 0 && (
            <div
              data-testid="pt-unanswered-warning"
              className="rounded-xl border border-[#D99B26]/60 bg-[#D99B26]/12 p-4 space-y-2"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-[#D99B26] shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-[#F8FAFC]">
                    No guessing penalty — {totalUnanswered} unanswered{' '}
                    {totalUnanswered === 1 ? 'question' : 'questions'}
                  </p>
                  <p className="text-xs text-[#CBD5E1] leading-relaxed">
                    On the DLPT5 Lower-Range there is no penalty for guessing. Jump back to mark your best answer before
                    submitting.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Passage review list */}
          <div className="space-y-3">
            {pages.map(({passage, drill, questionIds}, idx) => {
              const answeredCount = questionIds.filter((id) => typeof selectedAnswers[id] === 'number').length;
              const totalQ = questionIds.length;
              const isFlagged = Boolean(flaggedPassages[passage.id]);
              const hasMissing = totalQ === 0 || answeredCount < totalQ;

              return (
                <button
                  key={passage.id}
                  type="button"
                  onClick={() => onOpenPassage(idx)}
                  className="w-full text-left rounded-xl border border-[#23303E] bg-[#0B1117] hover:border-[#7DD3FC]/50 p-4 min-h-[64px] transition-colors flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono font-semibold text-[#7DD3FC] tabular-nums">Passage {idx + 1}</span>
                      {isFlagged && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#D99B26]/15 text-[#F3C669] text-[11px] font-medium">
                          <Flag className="w-3 h-3" />
                          Flagged
                        </span>
                      )}
                      {hasMissing && (
                        <span className="text-[#F87171] font-medium">
                          {totalQ === 0 ? 'Not visited yet' : `${totalQ - answeredCount} unanswered`}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-[#F8FAFC] truncate">{passage.title}</p>
                    <p className="text-xs text-[#94A3B8] font-mono tabular-nums">
                      {drill ? `${answeredCount} / ${totalQ} answered` : 'Tap to open passage'}
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[#94A3B8] shrink-0" />
                </button>
              );
            })}
          </div>

          {confirmUnansweredSubmit && totalUnanswered > 0 && (
            <div className="rounded-xl border border-[#F87171]/50 bg-[#F87171]/10 p-4 space-y-3">
              <p className="text-sm font-semibold text-[#FECACA]">
                Submit with {totalUnanswered} unanswered {totalUnanswered === 1 ? 'question' : 'questions'}?
              </p>
              <p className="text-xs text-[#E2E8F0]">
                Unanswered items score zero. You can still return to any passage above to enter a guess.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onSubmit}
                  className="px-4 py-2 min-h-[44px] rounded-xl bg-[#F87171] text-[#0B1117] text-xs font-semibold hover:bg-[#FCA5A5] transition-colors"
                >
                  Submit anyway
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmUnansweredSubmit(false)}
                  className="px-4 py-2 min-h-[44px] rounded-xl border border-[#23303E] bg-[#111922] text-xs font-semibold text-[#CBD5E1] hover:text-white transition-colors"
                >
                  Keep reviewing
                </button>
              </div>
            </div>
          )}
        </div>
      </ModalBody>

      <ModalFooter>
        <button
          type="button"
          onClick={onBackToPassages}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-xl border border-[#23303E] bg-[#111922] text-xs sm:text-sm font-semibold text-[#CBD5E1] hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to passages</span>
        </button>

        <button
          type="button"
          data-testid="pt-final-submit-btn"
          onClick={handleSubmit}
          className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[52px] rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
        >
          <ClipboardCheck className="w-4 h-4" />
          <span>Submit test</span>
        </button>
      </ModalFooter>
    </>
  );
};
