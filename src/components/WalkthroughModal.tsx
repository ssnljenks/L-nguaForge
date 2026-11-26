import React, {useState} from 'react';
import {ArrowRight, Check, DatabaseZap, Layers, MessageSquare, Mic, Newspaper, Timer, X} from 'lucide-react';
import type {ModuleTab} from '../types';
import {Dialog} from './shared/Dialog';

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
    eyebrow: 'Talk · Local Tutors',
    title: 'Casual Voice & Text Chat with Regional Tutors',
    description:
      'Pick a tutor from Buenos Aires, Medellín, San Juan, Mexico City, Rio, Salvador, or Lisbon—choose an everyday scene and chat naturally.',
    highlights: [
      'Dial slang from textbook (0) to full street (4) and choose Recast as I go, At the end only, or Off.',
      'Ask "How do locals say…" anytime, or tap dotted-underlined local expressions in captions.',
      'Tap "Wrap up" when finished to save new words, phrases, and patterns straight into Vocab.',
    ],
    targetTab: 'talk',
    targetLabel: 'Open Talk',
    icon: MessageSquare,
  },
  {
    id: 'vocab-capture',
    eyebrow: 'Vocab · Offline-First Lookups',
    title: 'Tap Words & Save Vocabulary Offline First',
    description:
      'Tap any partner word or open Flag a Word to save phrases straight into your Vocab without breaking conversation flow.',
    highlights: [
      'Your Vocab, built-in ES/PT core dictionaries, and local cache answer common lookups in 0 ms.',
      'Only unfamiliar or sentence-specific idioms call AI, and every answer is cached locally afterward.',
      'Export your captured vocabulary as an Anki-ready CSV deck anytime.',
    ],
    targetTab: 'vocab',
    targetLabel: 'Open Vocab',
    icon: Layers,
  },
  {
    id: 'opi-pipeline',
    eyebrow: 'Test Prep · ILR 2 → 2+/3',
    title: 'Live Voice OPI & Automatic Debrief',
    description:
      'Run an adaptive OPI practice interview under Test prep; your practice-estimate Debrief opens automatically when you finish.',
    highlights: [
      'Live Voice OPI starts at Level 2 baseline, then probes into Level 3 abstract policy and counterfactuals.',
      '5-Second Tip-of-the-Tongue Helper trains active recall when you pause mid-thought.',
      'Past sessions stay accessible right inside Test prep with Natural 2+ Rewrites.',
    ],
    targetTab: 'test_prep',
    targetLabel: 'Open Test Prep',
    icon: Mic,
  },
  {
    id: 'lab-drills',
    eyebrow: 'Test Prep · PREP & Interp Lab',
    title: '90-Second PREP & Consecutive Interp',
    description: 'Sharpen high-register briefing delivery and consecutive note-chunking inside Test prep.',
    highlights: [
      'PREP Monologue tracks Point → Reason → Example → Pivot on a live 90-second pacing bar.',
      'Consecutive Interp pairs Blind Listen audio clips with a Rozan-style symbol scratchpad.',
      'All AI scores are practice estimates built from original, open-source scenarios.',
    ],
    targetTab: 'test_prep',
    targetLabel: 'Go to Test Prep',
    icon: Timer,
  },
  {
    id: 'brief-feed',
    eyebrow: 'Brief · Authentic News & DLPT Drills',
    title: 'Authentic Open-Source Feed by ILR Level',
    description:
      'Practice listening to broadcasts and reading news rated across ILR Levels 2 to 3+, with instant DLPT multiple-choice drills.',
    highlights: [
      'Segmented Listening & Reading feeds from Latin America, Spain, and Portugal.',
      'Test comprehension with 3-question DLPT drills, instant rationales, and practice estimates.',
      'Tap "Brief it back" to take any story straight into an Oral Proficiency Interview as Level 3 probe material.',
    ],
    targetTab: 'brief',
    targetLabel: 'Open Briefs',
    icon: Newspaper,
  },
];

export const WalkthroughModal: React.FC<WalkthroughModalProps> = ({open, onClose, onNavigateTab, apiSavedCount}) => {
  const [stepIndex, setStepIndex] = useState(0);

  if (!open) return null;

  const step = TOUR_STEPS[stepIndex] ?? TOUR_STEPS[0];
  const Icon = step.icon;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  return (
    <Dialog
      labelledBy="walkthrough-title"
      onClose={onClose}
      closeOnBackdrop
      className="w-full max-w-xl rounded-2xl border border-[#23303E] bg-[#111922] shadow-2xl overflow-hidden"
    >
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
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-[#94A3B8] hover:text-white hover:bg-[#192533] transition-colors"
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

          <button
            type="button"
            onClick={() => {
              onNavigateTab(step.targetTab);
              onClose();
            }}
            className="inline-flex items-center gap-1 min-h-[44px] text-xs font-medium text-[#F3C669] hover:underline"
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{step.targetLabel}</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Footer Navigation */}
      <div className="px-5 sm:px-6 py-4 border-t border-[#23303E] bg-[#0D141C] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {!isFirst ? (
            <button
              type="button"
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              className="px-3.5 py-2 min-h-[44px] rounded-lg border border-[#23303E] bg-[#111922] text-xs font-medium text-[#CBD5E1] hover:text-white transition-colors"
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 min-h-[44px] rounded-lg text-xs font-medium text-[#94A3B8] hover:text-white transition-colors"
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
              className="px-3 py-2 min-h-[44px] rounded-lg text-xs font-medium text-[#94A3B8] hover:text-white transition-colors"
            >
              Skip
            </button>
          )}

          {isLast ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-5 py-2 min-h-[52px] rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] transition-colors"
            >
              <span>Start Practicing</span>
              <Check className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStepIndex((i) => Math.min(TOUR_STEPS.length - 1, i + 1))}
              className="inline-flex items-center gap-1.5 px-5 py-2 min-h-[52px] rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] transition-colors"
            >
              <span>Next</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
};
