import React from 'react';
import {ArrowLeft, ArrowRight, Sparkles, Zap} from 'lucide-react';
import type {ErrorTaxonomyKey} from '../../data/errorTaxonomy';
import type {ModuleTab} from '../../types';
import type {RankedErrorPattern} from '../../utils/errorPatterns';

interface RecurringErrorsViewProps {
  rankedErrors: RankedErrorPattern[];
  currentFloor: 0 | 1 | 2 | 3;
  weakestSkill: string;
  onBack: () => void;
  onLaunchFix: (key: ErrorTaxonomyKey) => void;
  onNavigateTab: (tab: ModuleTab) => void;
}

export const RecurringErrorsView: React.FC<RecurringErrorsViewProps> = ({
  rankedErrors,
  currentFloor,
  weakestSkill,
  onBack,
  onLaunchFix,
  onNavigateTab,
}) => {
  const targetLevel = Math.min(3, currentFloor + 1);

  return (
    <div data-testid="recurring-errors-view" className="space-y-6 pb-24 md:pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 min-h-[44px] px-3.5 rounded-lg border border-[#23303E] bg-[#111922] text-xs font-semibold text-[#CBD5E1] hover:text-white hover:border-[#35495E] transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-[#D99B26]" />
          <span>Back to Today</span>
        </button>

        <span className="font-mono text-xs text-[#94A3B8] tabular-nums">
          Last 14 days · Priority: L{targetLevel} &amp; {weakestSkill}
        </span>
      </div>

      <div className="space-y-1.5 border-b border-[#23303E] pb-4">
        <p className="text-xs font-medium text-[#F3C669]">Unified Error Log</p>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[#F8FAFC]">
          Recurring errors
        </h1>
        <p className="text-xs sm:text-sm text-[#94A3B8] max-w-2xl leading-relaxed">
          Ranked across your OPI, Role-play, Talk, DLPT, Gist, and Interpretation sessions over the last 14 days. Errors
          just above your current floor (Level {targetLevel}) carry the highest weight.
        </p>
      </div>

      {rankedErrors.length === 0 ? (
        <div className="rounded-xl border border-[#23303E] bg-[#111922] p-8 text-center space-y-4">
          <Sparkles className="w-8 h-8 text-[#7DD3FC] mx-auto" />
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-[#F8FAFC]">No recurring errors logged in the last 14 days</h2>
            <p className="text-xs text-[#94A3B8] max-w-md mx-auto leading-relaxed">
              Complete an OPI debrief, Role-play, Talk wrap-up, DLPT Brief drill, or Gist summary. Recurring grammar,
              register, listening trap, and fidelity habits will rank here automatically.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => onNavigateTab('test_prep')}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] transition-colors"
            >
              <span>Start an OPI or Role-play</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('brief')}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl border border-[#23303E] bg-[#0B1117] text-xs font-semibold text-[#CBD5E1] hover:text-white transition-colors"
            >
              <span>Open Daily Brief</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3.5">
          {rankedErrors.map((pattern, index) => {
            const isTop = index === 0;
            return (
              <article
                key={pattern.key}
                data-testid={isTop ? 'top-recurring-error-card' : `recurring-error-card-${pattern.key}`}
                className={`rounded-xl border bg-[#111922] p-5 space-y-4 transition-colors ${
                  isTop ? 'border-[#D99B26]' : 'border-[#23303E]'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium">
                      {isTop && <span className="text-[#F3C669] font-semibold">Top priority</span>}
                      {isTop && (
                        <span aria-hidden="true" className="text-[#556980]">
                          ·
                        </span>
                      )}
                      <span className="font-mono text-[#7DD3FC]">ILR L{pattern.entry.ilrLevel}</span>
                      <span aria-hidden="true" className="text-[#556980]">
                        ·
                      </span>
                      <span className="text-[#94A3B8]">Shows up in: {pattern.sourcesLabel}</span>
                    </div>
                    <h2 className="font-display text-lg font-semibold text-[#F8FAFC]">{pattern.entry.label}</h2>
                    <p className="text-xs text-[#94A3B8] leading-relaxed">{pattern.entry.explanation}</p>
                  </div>

                  <div className="flex flex-col items-end shrink-0">
                    <span className="font-mono text-xl font-bold text-[#F8FAFC] tabular-nums">
                      {pattern.displayCount}
                    </span>
                    {pattern.sessionRatioLabel && pattern.displayCount !== pattern.sessionRatioLabel && (
                      <span className="font-mono text-[11px] text-[#7D8FA3] tabular-nums">
                        {pattern.sessionRatioLabel} sessions
                      </span>
                    )}
                  </div>
                </div>

                {/* One Real Wrong -> Fix Example from User's Own Sessions */}
                <div className="rounded-lg border border-[#23303E] bg-[#0B1117] p-3.5 space-y-2 text-xs">
                  <p className="text-[11px] font-medium text-[#7D8FA3]">From your recent sessions</p>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2.5 leading-relaxed">
                    <span className="text-[#FECACA] line-through decoration-[#F87171]/70">{pattern.example.wrong}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#7D8FA3] shrink-0 hidden sm:block" />
                    <span className="text-[#7DD3FC] font-medium">{pattern.example.fix}</span>
                  </div>
                </div>

                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    data-testid={`launch-fix-${pattern.key}`}
                    onClick={() => onLaunchFix(pattern.key)}
                    className={`inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl text-xs font-semibold transition-colors ${
                      isTop
                        ? 'bg-[#D99B26] text-[#0B1117] hover:bg-[#E5AE42]'
                        : 'border border-[#D99B26]/50 bg-[#D99B26]/10 text-[#F3C669] hover:bg-[#D99B26]/20'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>2-min fix</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
