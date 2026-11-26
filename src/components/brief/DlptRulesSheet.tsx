import React, {useEffect} from 'react';
import {ShieldCheck, X} from 'lucide-react';
import type {DlptRuleProfile} from '../../utils/dlptRules';

interface DlptRulesSheetProps {
  profile: DlptRuleProfile;
  onClose: () => void;
}

export const DlptRulesSheet: React.FC<DlptRulesSheetProps> = ({profile, onClose}) => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dlpt-rules-sheet-title"
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <button
        type="button"
        aria-label="Close rules sheet backdrop"
        onClick={onClose}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm cursor-default"
      />
      <div className="relative z-10 w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl border border-[#23303E] bg-[#111922] shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <span className="w-10 h-1.5 rounded-full bg-[#23303E]" aria-hidden="true" />
        </div>

        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#23303E] bg-[#0B1117]">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl border border-[#7DD3FC]/35 bg-[#7DD3FC]/10 flex items-center justify-center shrink-0 mt-0.5">
              <ShieldCheck className="w-4 h-4 text-[#7DD3FC]" />
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-wider text-[#7DD3FC]">{profile.pillLabel}</p>
              <h3 id="dlpt-rules-sheet-title" className="text-base font-semibold text-[#F8FAFC] mt-0.5">
                {profile.title}
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close rules sheet"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#94A3B8] hover:text-white hover:bg-[#16202B] transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <p className="text-xs sm:text-sm text-[#CBD5E1] leading-relaxed">{profile.summary}</p>

          <dl className="space-y-3">
            {profile.rules.map((rule) => (
              <div key={rule.heading} className="rounded-xl border border-[#23303E] bg-[#0B1117] p-3.5 space-y-1">
                <dt className="text-xs sm:text-sm font-semibold text-[#F8FAFC]">{rule.heading}</dt>
                <dd className="text-xs text-[#94A3B8] leading-relaxed">{rule.detail}</dd>
              </div>
            ))}
          </dl>

          <p className="text-[11px] text-[#7D8FA3] leading-relaxed">
            Practice mode adds immediate per-page feedback, trap analysis, and replay with transcript. Switch to Test
            mode to enforce full exam timing and end-only feedback.
          </p>
        </div>

        <div className="p-4 border-t border-[#23303E] bg-[#0B1117]">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[44px] rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
