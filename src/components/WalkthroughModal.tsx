import React, {useEffect, useState} from 'react';
import {ArrowRight, BookMarked, Check, DatabaseZap, MessageSquare, Mic, Timer, X} from 'lucide-react';
import type {ModuleTab} from '../types';

interface WalkthroughModalProps {
  open: boolean;
  onClose: () => void;
  onNavigateTab: (tab: ModuleTab) => void;
  apiSavedCount: number;
}

interface TourStep {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  highlights: string[];
  targetTab: ModuleTab;
  targetLabel: string;
  icon: React.FC<{className?: string}>;
}

const TOUR_STEPS: TourStep[] = [
  {
    id: 'live-chat',
    eyebrow: 'Home Base · Gemini Live',
    title: 'Real-Time Back-and-Forth Voice Chat',
    description:
      'Start every session right here on the home dashboard. Tap Start Live Voice for a natural, interruptible conversation in your chosen Spanish or Portuguese dialect.',
    highlights: [
      'Choose Casual, ILR 2+, or ILR 3 tone before starting.',
      'Switch to Type instead anytime you are in a quiet room.',
      'Live captions transcribe both sides so you can review or replay turns.',
    ],
    targetTab: 'chat',
    targetLabel: 'Stay on Live Voice Chat',
    icon: MessageSquare,
  },
  {
    id: 'vocab-capture',
    eyebrow: 'Zero-API Lookups · Quota Saver',
    title: 'Tap Words & Save Vocabulary Offline First',
    description:
      'Never waste study time or live conversation momentum looking up common words. Tap any partner word or open Flag a Word to save phrases straight into your Vocab Vault.',
    highlights: [
      'Your Vocab Vault, built-in ES/PT core dictionaries, and local cache answer common lookups in 0 ms with zero API calls.',
      'Only unfamiliar or sentence-specific idioms call AI, and every answer is cached locally afterward.',
      'Full AI quota stays reserved for live voice and real-time speech.',
    ],
    targetTab: 'vault',
    targetLabel: 'Open Vocab Vault',
    icon: DatabaseZap,
  },
  {
    id: 'opi-pipeline',
    eyebrow: 'ILR 2 → 2+/3 Pipeline',
    title: 'Live Voice OPI & ILR Debrief',
    description:
      'When you are ready for formal evaluation drills, run an adaptive OPI interview and review it in the ILR Debrief.',
    highlights: [
      'Live Voice OPI: Examiner starts at Level 2 baseline, then probes into Level 3 abstract policy and counterfactuals.',
      '5-Second Tip-of-the-Tongue Helper: Active recall prompt when you pause mid-thought.',
      'ILR Debrief: Grades completed transcripts for discourse cohesion and provides Natural 2+ Rewrites.',
    ],
    targetTab: 'opi',
    targetLabel: 'Try Live Voice OPI',
    icon: Mic,
  },
  {
    id: 'lab-vault',
    eyebrow: 'Targeted Drills & Retention',
    title: '90-Second PREP, Interp Lab & Active Recall',
    description: 'Sharpen high-register briefing delivery and lock in words you struggled with during conversation.',
    highlights: [
      'PREP Monologue: Visual 90s pacing timeline (Point → Reason → Example → Pivot) with structural grading.',
      'Consecutive Interp: Blind-listen delegation clips with Rozan-style chunking scratchpad.',
      'Vocab Vault: Active-recall sentence drills and 1-click Anki CSV export.',
    ],
    targetTab: 'lab',
    targetLabel: 'Explore PREP & Interp Lab',
    icon: Timer,
  },
];

export const WalkthroughModal: React.FC<WalkthroughModalProps> = ({open, onClose, onNavigateTab, apiSavedCount}) => {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setStepIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const step = TOUR_STEPS[stepIndex] ?? TOUR_STEPS[0];
  const Icon = step.icon;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="walkthrough-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl rounded-2xl border border-[#23303E] bg-[#111922] shadow-2xl overflow-hidden">
        {/* Top Progress Header */}
        <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-[#23303E] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg border border-[#D99B26]/40 bg-[#D99B26]/10 flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4 text-[#D99B26]" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-[#F3C669] truncate">{step.eyebrow}</p>
              <p className="text-xs text-[#7D8FA3] font-mono tabular-nums">
                Step {stepIndex + 1} of {TOUR_STEPS.length}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close walkthrough"
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-[#94A3B8] hover:text-white hover:bg-[#192533] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step Progress Strip */}
        <div className="grid grid-cols-4 gap-1 px-5 sm:px-6 pt-4" aria-hidden="true">
          {TOUR_STEPS.map((s, idx) => (
            <div
              key={s.id}
              className={`h-1 rounded-full transition-colors ${idx <= stepIndex ? 'bg-[#D99B26]' : 'bg-[#23303E]'}`}
            />
          ))}
        </div>

        {/* Main Content */}
        <div className="p-5 sm:p-6 space-y-4">
          <div className="space-y-2">
            <h2 id="walkthrough-title" className="text-xl font-semibold tracking-tight text-[#F8FAFC]">
              {step.title}
            </h2>
            <p className="text-sm text-[#CBD5E1] leading-relaxed">{step.description}</p>
          </div>

          <ul className="space-y-2.5 rounded-xl border border-[#23303E] bg-[#0B1117] p-4">
            {step.highlights.map((bullet) => (
              <li key={bullet} className="flex items-start gap-2.5 text-xs sm:text-sm text-[#94A3B8] leading-relaxed">
                <Check className="w-4 h-4 text-[#D99B26] shrink-0 mt-0.5" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#7D8FA3]">
            <span className="inline-flex items-center gap-1.5">
              <DatabaseZap className="w-3.5 h-3.5 text-[#7D8FA3]" />
              <span>
                API calls saved locally so far:{' '}
                <strong className="font-mono text-[#E6EDF3] tabular-nums">{apiSavedCount}</strong>
              </span>
            </span>

            {step.targetTab !== 'chat' && (
              <button
                type="button"
                onClick={() => {
                  onNavigateTab(step.targetTab);
                  onClose();
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#F3C669] hover:underline"
              >
                <BookMarked className="w-3.5 h-3.5" />
                <span>{step.targetLabel}</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Footer Navigation */}
        <div className="px-5 sm:px-6 py-4 border-t border-[#23303E] bg-[#0D141C] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {!isFirst ? (
              <button
                type="button"
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                className="px-3.5 py-2 min-h-[40px] rounded-lg border border-[#23303E] bg-[#111922] text-xs font-medium text-[#CBD5E1] hover:text-white transition-colors"
              >
                Back
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 min-h-[40px] rounded-lg text-xs font-medium text-[#94A3B8] hover:text-white transition-colors"
              >
                Skip Tour
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 min-h-[40px] rounded-lg text-xs font-medium text-[#94A3B8] hover:text-white transition-colors"
              >
                Skip
              </button>
            )}

            {isLast ? (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 px-5 py-2 min-h-[40px] rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] transition-colors"
              >
                <span>Start Practicing</span>
                <Check className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setStepIndex((i) => Math.min(TOUR_STEPS.length - 1, i + 1))}
                className="inline-flex items-center gap-1.5 px-5 py-2 min-h-[40px] rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] transition-colors"
              >
                <span>Next</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
