import React from 'react';
import {CheckCircle2, MinusCircle, RotateCcw, XCircle} from 'lucide-react';
import type {IlrFunctionRating, OpiSession, RoleplayDebriefResult, RoleplayScenarioPublic} from '../../types';

const ROLEPLAY_STATUS_BADGE: Record<
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
    label: 'Missed',
    className: 'text-[#F87171] bg-red-500/10 border-[#F87171]/35',
    icon: XCircle,
  },
};

interface RoleplayDebriefCardProps {
  rpDebrief: RoleplayDebriefResult;
  activeSession: OpiSession;
  onReplayRoleplayWithTwist?: (payload: {
    scenario: RoleplayScenarioPublic;
    hiddenGoal: string;
    complication: string;
  }) => void;
}

/** Role-play debrief: hidden goal and complication revealed, level checklist, replay with the twist known. */
export const RoleplayDebriefCard: React.FC<RoleplayDebriefCardProps> = ({
  rpDebrief,
  activeSession,
  onReplayRoleplayWithTwist,
}) => (
  <section
    data-testid="roleplay-debrief-card"
    className="rounded-xl border-2 border-[#D99B26]/70 bg-[#111922] p-5 sm:p-6 space-y-4"
  >
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-[#F3C669]">
          Role-play debrief · Level {rpDebrief.level}
        </p>
        <h2 className="font-display text-lg font-semibold text-[#F8FAFC] mt-0.5">
          {rpDebrief.characterRole} ({rpDebrief.register})
        </h2>
      </div>
      <span className="px-2.5 py-1 rounded-lg border border-[#23303E] bg-[#0B1117] text-xs font-semibold text-[#7DD3FC] capitalize">
        {rpDebrief.resolvedOutcome}
      </span>
    </div>

    <p className="text-sm text-[#CBD5E1] leading-relaxed">{rpDebrief.summary}</p>

    {/* Revealed server-side secrets */}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="rounded-lg border border-[#23303E] bg-[#0B1117] p-3.5 space-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#7DD3FC]">Hidden goal revealed</span>
        <p data-testid="roleplay-hidden-goal" className="text-xs sm:text-sm text-[#E6EDF3] leading-relaxed">
          {rpDebrief.hiddenGoal}
        </p>
      </div>

      <div className="rounded-lg border border-[#23303E] bg-[#0B1117] p-3.5 space-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#F3C669]">Complication revealed</span>
        <p data-testid="roleplay-complication" className="text-xs sm:text-sm text-[#E6EDF3] leading-relaxed">
          {rpDebrief.complication}
        </p>
      </div>
    </div>

    {/* Level-specific 3-item checklist (Met / Partly / Missed + 1 quoted evidence line) */}
    <div className="space-y-2.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
        Level {rpDebrief.level} checklist
      </span>
      <div className="space-y-2">
        {rpDebrief.checklist.map((item) => {
          const badge = ROLEPLAY_STATUS_BADGE[item.status] ?? ROLEPLAY_STATUS_BADGE.partly;
          const Icon = badge.icon;
          return (
            <div
              key={item.itemKey}
              data-testid={`roleplay-check-${item.itemKey}`}
              className="rounded-lg border border-[#23303E] bg-[#0B1117] p-3.5 space-y-1.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[#F8FAFC]">{item.label}</span>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-semibold shrink-0 ${badge.className}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{badge.label}</span>
                </span>
              </div>
              <p className="text-xs text-[#94A3B8] leading-relaxed">{item.evidence}</p>
            </div>
          );
        })}
      </div>
    </div>

    {activeSession.roleplayScenario && onReplayRoleplayWithTwist && (
      <div className="pt-1 flex justify-end">
        <button
          type="button"
          data-testid="roleplay-replay-btn"
          onClick={() =>
            onReplayRoleplayWithTwist({
              scenario: activeSession.roleplayScenario!,
              hiddenGoal: rpDebrief.hiddenGoal,
              complication: rpDebrief.complication,
            })
          }
          className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-xl border border-[#D99B26]/60 bg-[#D99B26]/12 text-sm font-semibold text-[#F3C669] hover:bg-[#D99B26]/22 transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Replay with the twist known</span>
        </button>
      </div>
    )}
  </section>
);
