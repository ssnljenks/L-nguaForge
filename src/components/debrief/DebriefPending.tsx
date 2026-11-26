import React from 'react';
import {FileCheck2, Loader2} from 'lucide-react';

interface DebriefPendingProps {
  isAnalyzing: boolean;
  hasCandidateSpeech: boolean;
  onAnalyze: () => void;
}

/** Run: no report yet — analyzing, nothing to analyze, or ready to run. */
export const DebriefPending: React.FC<DebriefPendingProps> = ({
  isAnalyzing,
  hasCandidateSpeech,
  onAnalyze: handleAnalyze,
}) => (
  <div className="rounded-xl border border-[#23303E] bg-[#111922] p-6 sm:p-8 space-y-4">
    {isAnalyzing ? (
      <div role="status" className="flex items-center gap-3 text-sm text-[#CBD5E1]">
        <Loader2 className="w-5 h-5 animate-spin text-[#D99B26] shrink-0" />
        <div>
          <p className="font-semibold text-[#F8FAFC]">Auditing your call transcript…</p>
          <p className="text-xs text-[#94A3B8] mt-0.5">
            Computing ILR floor &amp; ceiling, pinpointing breakdowns, and mapping accuracy descriptors.
          </p>
        </div>
      </div>
    ) : !hasCandidateSpeech ? (
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-[#F8FAFC]">Call ended before a response was recorded</h2>
        <p className="text-sm text-[#94A3B8]">
          Start another call and answer at least one examiner prompt to generate a speaking debrief and breakdown
          analysis.
        </p>
      </div>
    ) : (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold text-[#F8FAFC]">Ready to generate your debrief</h2>
          <p className="text-sm text-[#94A3B8]">
            Run diagnostic grading to see your estimated speaking level (0+ to 3), ceiling breakdown moment, next-level
            function scores, and accuracy notes.
          </p>
        </div>
        <button
          type="button"
          onClick={handleAnalyze}
          className="inline-flex items-center gap-2 px-5 min-h-[52px] rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
        >
          <FileCheck2 className="w-4 h-4" />
          <span>Run Diagnostic Debrief</span>
        </button>
      </div>
    )}
  </div>
);
