import React from 'react';
import {ArrowRight, BookmarkCheck, ShieldCheck} from 'lucide-react';
import type {IlrBaseLevel, IlrFunctionKey} from '../../data/ilrSpeakingLevels';
import type {DebriefReport, OpiAccuracyNote} from '../../types';

const ACCURACY_STATUS_STYLE: Record<OpiAccuracyNote['status'], {label: string; className: string}> = {
  strength: {label: 'Strength', className: 'text-emerald-300'},
  watch: {label: 'Developing', className: 'text-amber-300'},
  gap: {label: 'Ceiling signal', className: 'text-[#F87171]'},
};

/** Speech accuracy notes mapped to ILR descriptors. */
export const AccuracyNotesCard: React.FC<{
  accuracyNotes: OpiAccuracyNote[];
  floorLabel: number;
  gridLevel: IlrBaseLevel;
}> = ({accuracyNotes, floorLabel, gridLevel}) => (
  <section
    data-testid="debrief-accuracy-notes"
    className="rounded-xl border border-[#23303E] bg-[#111922] p-5 sm:p-6 space-y-4"
  >
    <div className="flex items-center gap-2">
      <ShieldCheck className="w-4 h-4 text-[#7DD3FC] shrink-0" />
      <div>
        <h2 className="font-display text-lg font-semibold text-[#F8FAFC]">Accuracy notes</h2>
        <p className="text-xs text-[#94A3B8]">
          Speech accuracy and comprehensibility against ILR Level {floorLabel === 0 ? 1 : gridLevel} benchmarks.
        </p>
      </div>
    </div>

    <ul className="divide-y divide-[#1D2835]">
      {accuracyNotes.map((item) => {
        const style = ACCURACY_STATUS_STYLE[item.status] ?? ACCURACY_STATUS_STYLE.watch;
        return (
          <li key={item.descriptor} className="py-3 first:pt-0 last:pb-0 space-y-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-[#F8FAFC]">{item.descriptor}</span>
              <span className={`text-xs font-semibold ${style.className}`}>{style.label}</span>
            </div>
            <p className="text-xs text-[#94A3B8] leading-relaxed">{item.observation}</p>
          </li>
        );
      })}
    </ul>
  </section>
);

/** Words the debrief added to Vocab automatically. */
export const AutoVocabCard: React.FC<{autoVocab: NonNullable<DebriefReport['autoAddedVocab']>}> = ({autoVocab}) => (
  <section
    data-testid="debrief-auto-vocab"
    className="rounded-xl border border-[#23303E] bg-[#111922] p-5 sm:p-6 space-y-3"
  >
    <div className="flex items-center gap-2">
      <BookmarkCheck className="w-4 h-4 text-[#D99B26]" />
      <h2 className="font-display text-base font-semibold text-[#F8FAFC]">Words auto-added to Vocab</h2>
    </div>
    <div className="flex flex-wrap gap-2">
      {autoVocab.map((item) => (
        <div
          key={item.term}
          className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 max-w-full rounded-lg border border-[#2E4054] bg-[#0B1117] px-3 py-2 text-xs leading-snug"
        >
          <span className="font-semibold text-[#F8FAFC] whitespace-nowrap">{item.term}</span>
          {item.englishConcept && <span className="text-[#94A3B8]">— {item.englishConcept}</span>}
        </div>
      ))}
    </div>
  </section>
);

/** Secondary CTA: a focused 3-minute call on the weakest function. */
export const TargetedRetryCard: React.FC<{
  primaryRetryFn: {functionKey: IlrFunctionKey; label: string};
  onStartTargetedRetry: (functionKey: IlrFunctionKey) => void;
}> = ({primaryRetryFn, onStartTargetedRetry}) => (
  <section className="rounded-xl border border-[#D99B26]/35 bg-[#131B24] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div className="space-y-1">
      <p className="text-xs font-semibold text-[#D99B26]">Targeted follow-up</p>
      <p className="text-sm text-[#CBD5E1]">
        Run a focused 3-minute call drilling only{' '}
        <span className="text-[#F8FAFC] font-medium">{primaryRetryFn.label}</span>.
      </p>
    </div>
    <button
      type="button"
      data-testid="debrief-retry-probe-btn"
      onClick={() => onStartTargetedRetry(primaryRetryFn.functionKey)}
      className="inline-flex items-center justify-center gap-2 min-h-[52px] px-5 rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors whitespace-nowrap shrink-0"
    >
      <span>Retry the {primaryRetryFn.label} probe · 3 min</span>
      <ArrowRight className="w-4 h-4" />
    </button>
  </section>
);
