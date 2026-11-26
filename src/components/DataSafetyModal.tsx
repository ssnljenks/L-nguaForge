import React from 'react';
import {ShieldAlert} from 'lucide-react';
import {DATA_SAFETY_SHORT_NOTICE} from '../utils/classificationGuard';
import {Dialog} from './shared/Dialog';

interface DataSafetyModalProps {
  open: boolean;
  onAcknowledge: () => void;
}

export const DataSafetyModal: React.FC<DataSafetyModalProps> = ({open, onAcknowledge}) => {
  if (!open) return null;

  return (
    <Dialog
      labelledBy="data-safety-title"
      onClose={onAcknowledge}
      overlayClassName="bg-black/80"
      className="w-full max-w-md rounded-2xl border border-[#23303E] bg-[#111922] shadow-2xl overflow-hidden"
    >
      <div className="px-5 pt-5 pb-4 border-b border-[#23303E] flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl border border-[#D99B26]/40 bg-[#D99B26]/10 flex items-center justify-center shrink-0">
          <ShieldAlert className="w-5 h-5 text-[#D99B26]" />
        </div>
        <div>
          <p className="text-xs font-medium text-[#F3C669]">Data-Safety Notice</p>
          <h2 id="data-safety-title" className="font-display text-lg font-semibold text-[#F8FAFC]">
            Open-Source Training Only
          </h2>
        </div>
      </div>

      <div className="p-5 space-y-3">
        <p className="text-sm font-medium text-[#F8FAFC] leading-relaxed">{DATA_SAFETY_SHORT_NOTICE}</p>
        <p className="text-xs text-[#94A3B8] leading-relaxed">
          All scenarios and prompts are original practice material. Inputs containing classification or control markings
          are blocked automatically before reaching AI services, and AI scores are practice estimates—not official ILR
          ratings.
        </p>
      </div>

      <div className="px-5 py-4 border-t border-[#23303E] bg-[#0D141C]">
        <button
          type="button"
          onClick={onAcknowledge}
          className="w-full min-h-[52px] rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
        >
          I Understand — Continue
        </button>
      </div>
    </Dialog>
  );
};
