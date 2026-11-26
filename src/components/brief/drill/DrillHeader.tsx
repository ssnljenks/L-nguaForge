import React from 'react';
import {Info, X} from 'lucide-react';
import type {DlptDrillMode} from '../../../types';

interface DrillHeaderProps {
  mode: DlptDrillMode;
  modeLocked: boolean;
  onModeSwitch: (mode: DlptDrillMode) => void;
  rulesPillLabel: string;
  onOpenRules: () => void;
  onClose: () => void;
  counterLabel: string;
  skillLabel: string;
  progressPct: number;
}

/** Mode toggle, rules pill, close button and session progress. */
export const DrillHeader: React.FC<DrillHeaderProps> = ({
  mode,
  modeLocked,
  onModeSwitch,
  rulesPillLabel,
  onOpenRules,
  onClose,
  counterLabel,
  skillLabel,
  progressPct,
}) => (
  <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-[#23303E] bg-[#0B1117] space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Practice / Test segmented toggle */}
        <div
          role="group"
          aria-label="Drill mode"
          className="inline-flex p-0.5 rounded-lg bg-[#111922] border border-[#23303E]"
        >
          <button
            type="button"
            disabled={modeLocked}
            onClick={() => onModeSwitch('practice')}
            className={`px-3 py-1.5 min-h-[44px] rounded-md text-xs font-semibold transition-colors ${
              mode === 'practice'
                ? 'bg-[#D99B26] text-[#0B1117]'
                : 'text-[#94A3B8] hover:text-white disabled:opacity-50'
            }`}
          >
            Practice
          </button>
          <button
            type="button"
            disabled={modeLocked}
            onClick={() => onModeSwitch('test')}
            className={`px-3 py-1.5 min-h-[44px] rounded-md text-xs font-semibold transition-colors ${
              mode === 'test' ? 'bg-[#7DD3FC] text-[#0B1117]' : 'text-[#94A3B8] hover:text-white disabled:opacity-50'
            }`}
          >
            Test
          </button>
        </div>

        {/* Active DLPT rules pill button (opens rules sheet) */}
        <button
          type="button"
          data-testid="dlpt-rules-pill"
          onClick={onOpenRules}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] rounded-full border border-[#7DD3FC]/40 bg-[#7DD3FC]/10 text-[#7DD3FC] hover:bg-[#7DD3FC]/20 font-mono text-[11px] font-medium transition-colors"
        >
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>{rulesPillLabel}</span>
        </button>
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close DLPT drill"
        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#94A3B8] hover:text-white rounded-xl hover:bg-[#16202B] transition-colors"
      >
        <X className="w-5 h-5" />
      </button>
    </div>

    {/* Progress bar + Passage x of y · Question x of y */}
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-mono font-medium text-[#CBD5E1] tabular-nums">{counterLabel}</span>
        <span className="text-[11px] text-[#94A3B8]">{skillLabel}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-[#16202B] overflow-hidden">
        <div
          className="h-full rounded-full bg-[#D99B26] transition-all duration-300"
          style={{width: `${progressPct}%`}}
        />
      </div>
    </div>
  </div>
);
