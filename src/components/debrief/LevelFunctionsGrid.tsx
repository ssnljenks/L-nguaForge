import React, {useState} from 'react';
import {CheckCircle2, ChevronDown, ChevronUp, MinusCircle, XCircle} from 'lucide-react';
import type {IlrBaseLevel} from '../../data/ilrSpeakingLevels';
import type {IlrFunctionCheck, IlrFunctionRating} from '../../types';

const STATUS_BADGE: Record<
  IlrFunctionRating,
  {label: string; className: string; icon: React.FC<{className?: string}>}
> = {
  met: {
    label: 'Met',
    className: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
    icon: CheckCircle2,
  },
  partly: {
    label: 'Partly',
    className: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
    icon: MinusCircle,
  },
  not_met: {
    label: 'Not met',
    className: 'text-[#F87171] bg-red-500/10 border-[#F87171]/35',
    icon: XCircle,
  },
};

interface LevelFunctionsGridProps {
  gridLevel: IlrBaseLevel;
  floorLabel: number;
  levelFunctions: IlrFunctionCheck[];
}

/** Functions for the level just above the floor; each card expands to its turn evidence. */
export const LevelFunctionsGrid: React.FC<LevelFunctionsGridProps> = ({gridLevel, floorLabel, levelFunctions}) => {
  const [expandedEvidenceKeys, setExpandedEvidenceKeys] = useState<Record<string, boolean>>({});
  const toggleEvidence = (fnKey: string) => {
    setExpandedEvidenceKeys((prev) => ({...prev, [fnKey]: !prev[fnKey]}));
  };

  return (
    <section
      data-testid="debrief-functions-grid"
      className="rounded-xl border border-[#23303E] bg-[#111922] p-5 sm:p-6 space-y-4"
    >
      <div className="space-y-1">
        <h2 className="font-display text-lg font-semibold text-[#F8FAFC]">Level {gridLevel} functions</h2>
        <p className="text-xs text-[#94A3B8]">
          {floorLabel >= 3
            ? 'ILR Level 3 core functions evaluated across this interview. Tap any card to inspect turn evidence.'
            : `Next-level benchmark above your Level ${floorLabel} floor. Tap any card to inspect turn evidence.`}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {levelFunctions.map((fn) => {
          const badge = STATUS_BADGE[fn.status];
          const Icon = badge.icon;
          const isExpanded = Boolean(expandedEvidenceKeys[fn.functionKey]);
          const evidenceItems = fn.evidence && fn.evidence.length > 0 ? fn.evidence : [];
          return (
            <button
              key={fn.functionKey}
              type="button"
              data-testid={`fn-card-${fn.functionKey}`}
              aria-expanded={isExpanded}
              onClick={() => toggleEvidence(fn.functionKey)}
              className="w-full text-left rounded-xl border border-[#23303E] bg-[#0B1117] hover:border-[#35495E] p-4 min-h-[44px] space-y-2 transition-colors"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[#F8FAFC]">{fn.label}</span>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-semibold shrink-0 ${badge.className}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{badge.label}</span>
                </span>
              </span>

              {fn.note && <span className="block text-xs text-[#94A3B8] leading-relaxed">{fn.note}</span>}

              <span className="flex items-center justify-between pt-0.5 text-[11px] font-medium text-[#7DD3FC]">
                <span>
                  {evidenceItems.length > 0 ? `Evidence (${evidenceItems.length})` : 'View assessment details'}
                </span>
                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </span>

              {isExpanded && (
                <span
                  data-testid={`fn-evidence-${fn.functionKey}`}
                  className="block mt-2 pt-2.5 border-t border-[#1D2835] space-y-1.5 text-xs text-[#CBD5E1]"
                >
                  {evidenceItems.length > 0 ? (
                    evidenceItems.map((ev) => (
                      <span key={ev} className="block leading-relaxed text-[#CBD5E1]">
                        • {ev}
                      </span>
                    ))
                  ) : (
                    <span className="block text-[#94A3B8]">
                      {fn.note || 'No direct turn quote recorded for this function.'}
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
};
