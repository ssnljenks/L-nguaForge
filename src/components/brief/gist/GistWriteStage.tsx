import React from 'react';
import {AlertCircle, Clock, Send} from 'lucide-react';
import {formatGistCountdown, GIST_TIMER_SECONDS} from '../../../utils/gistLogic';
import {ModalBody, ModalFooter} from '../modalLayout';

interface GistWriteStageProps {
  secondsLeft: number;
  summaryText: string;
  sentenceCount: number;
  error: string | null;
  onChangeSummary: (text: string) => void;
  onSubmit: () => void;
}

/** Run stage: the 60-second countdown and the 3-sentence summary box. */
export const GistWriteStage: React.FC<GistWriteStageProps> = ({
  secondsLeft,
  summaryText,
  sentenceCount,
  error,
  onChangeSummary,
  onSubmit,
}) => {
  const timerProgressPct = Math.round((secondsLeft / GIST_TIMER_SECONDS) * 100);
  const timerColorClass =
    secondsLeft <= 10 ? 'text-[#F87171]' : secondsLeft <= 20 ? 'text-[#D99B26]' : 'text-[#7DD3FC]';

  return (
    <>
      <ModalBody>
        <div className="space-y-4">
          {/* Countdown Header */}
          <div className="rounded-xl border border-[#23303E] bg-[#0B1117] p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Clock className={`w-4 h-4 ${timerColorClass}`} />
                <span className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
                  Step 2 of 2 · Auto-submits at 0:00
                </span>
              </div>
              <span
                data-testid="gist-countdown"
                className={`font-mono text-xl font-bold tabular-nums ${timerColorClass}`}
              >
                {formatGistCountdown(secondsLeft)}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[#16202B] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  secondsLeft <= 10 ? 'bg-[#F87171]' : secondsLeft <= 20 ? 'bg-[#D99B26]' : 'bg-[#7DD3FC]'
                }`}
                style={{width: `${timerProgressPct}%`}}
              />
            </div>
          </div>

          {error && (
            <div className="p-3.5 rounded-xl border border-[#F87171]/45 bg-[#F87171]/10 text-xs text-[#FECACA] flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-[#F87171] shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor="gist-summary-input" className="text-sm font-semibold text-[#F8FAFC]">
                Summarize in 3 English sentences.
              </label>
              <span className="font-mono text-xs text-[#94A3B8] tabular-nums">
                {sentenceCount} / 3 {sentenceCount === 1 ? 'sentence' : 'sentences'}
              </span>
            </div>

            <textarea
              id="gist-summary-input"
              data-testid="gist-summary-input"
              rows={5}
              value={summaryText}
              onChange={(e) => onChangeSummary(e.target.value)}
              placeholder="State the main point and key concrete details in up to 3 English sentences. Report only what the speaker said—never add outside facts."
              className="w-full rounded-xl border border-[#23303E] bg-[#0B1117] p-4 text-sm text-[#F8FAFC] placeholder-[#7D8FA3] leading-relaxed focus:border-[#D99B26] focus:outline-none resize-y"
            />

            <p className="text-xs text-[#7D8FA3]">
              Fidelity rule: additions (stating something the source never said) count as the most serious error.
            </p>
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <span className="font-mono text-xs text-[#94A3B8] tabular-nums">
          {formatGistCountdown(secondsLeft)} remaining
        </span>
        <button
          type="button"
          data-testid="gist-submit-btn"
          onClick={onSubmit}
          className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[52px] rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
        >
          <Send className="w-4 h-4" />
          <span>Submit gist</span>
        </button>
      </ModalFooter>
    </>
  );
};
