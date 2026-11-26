import React from 'react';
import type {DebriefReport} from '../../types';
import {HIGHER_LEVELS_NOT_RATED_NOTE, PRACTICE_RATING_DISCLAIMER} from '../../utils/opiRating';

interface DebriefLevelCardProps {
  report: DebriefReport;
  displayRating: string;
  floorLabel: number;
  ceilingLabel: number | null;
  isLevel3Rating: boolean;
}

/** Estimated speaking level (0+..3) with floor/ceiling and the practice-estimate disclaimer. */
export const DebriefLevelCard: React.FC<DebriefLevelCardProps> = ({
  report,
  displayRating,
  floorLabel,
  ceilingLabel,
  isLevel3Rating,
}) => (
  <section
    data-testid="debrief-level-card"
    className="rounded-xl border border-[#23303E] bg-[#111922] p-5 sm:p-6 space-y-2.5"
  >
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-xs font-medium text-[#94A3B8]">Estimated speaking level</span>
      <span data-testid="debrief-estimate-disclaimer" className="text-xs font-medium text-[#7DD3FC]">
        {PRACTICE_RATING_DISCLAIMER}
      </span>
    </div>

    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-[#F8FAFC]">ILR {displayRating}</h2>
      <p className="text-xs text-[#94A3B8] font-mono tabular-nums">
        Floor: Level {floorLabel}
        {ceilingLabel !== null ? ` · Ceiling: Level ${ceilingLabel}` : ''}
      </p>
    </div>

    {isLevel3Rating && (
      <p data-testid="debrief-higher-levels-note" className="text-xs font-medium text-[#D99B26]">
        {report.ratingNote || HIGHER_LEVELS_NOT_RATED_NOTE}
      </p>
    )}

    <p className="text-sm sm:text-[15px] text-[#CBD5E1] leading-relaxed">
      {report.oneLineRationale || report.summaryAssessment}
    </p>
  </section>
);
