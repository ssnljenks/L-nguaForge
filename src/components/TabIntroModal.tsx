import React from 'react';
import {Check, Compass, FileText, Layers, MessageSquare, Mic, Sun, X} from 'lucide-react';
import type {ModuleTab} from '../types';
import {Dialog} from './shared/Dialog';

interface TabIntroModalProps {
  tab: ModuleTab | null;
  onDismiss: (tab: ModuleTab) => void;
  onOpenFullTour: () => void;
}

interface TabIntroSpec {
  eyebrow: string;
  title: string;
  summary: string;
  bullets: string[];
  cta: string;
  icon: React.FC<{className?: string}>;
}

const TAB_INTROS: Record<ModuleTab, TabIntroSpec> = {
  today: {
    eyebrow: 'Today Tab · Daily Plan',
    title: 'Your Daily ILR Training Hub',
    summary:
      'Track your Listening, Reading, and Speaking estimates against your ILR goals and walk through a focused 25-minute daily plan.',
    bullets: [
      'Tap the ILR profile card anytime to inspect your recurring errors and launch targeted 2-minute fixes.',
      'Follow the 3-step plan: FSRS Vocab warm-up, a Brief drill for your weaker receptive skill, and a Speaking drill.',
      'Adjust your ILR goals (default 3/3/3), Work focus, or optional exam date anytime in Settings.',
    ],
    cta: 'Start Today',
    icon: Sun,
  },
  talk: {
    eyebrow: 'Talk Tab · Local Conversation',
    title: 'Casual Practice with a Local Tutor',
    summary:
      'Pick a tutor from a real city, dial in how much local slang you want, and chat naturally by voice or text.',
    bullets: [
      'Choose a scene like an asado, taxi ride, or neighborhood café—never exam scores or grades.',
      'Dotted-underlined local expressions and subtle recast notes help you pick up authentic phrasing as you chat.',
      'Use "How do locals say…" mid-chat and "Wrap up" anytime to save new words, phrases, and patterns to Vocab.',
    ],
    cta: 'Start Talking',
    icon: MessageSquare,
  },
  test_prep: {
    eyebrow: 'Test Prep Tab · Simulated Evaluation',
    title: 'OPI Simulator, PREP Lab & Past Debriefs',
    summary:
      'Stress-test your ILR Level 2 to 2+/3 progression with adaptive OPI probes, 90-second PREP monologues, and consecutive interpretation.',
    bullets: [
      'OPI sessions open an automatic practice-estimate Debrief as soon as you finish.',
      'Open PREP & Interp Lab for timed 90-second monologues and note-chunking drills.',
      'Review past interviews and Natural 2+ Rewrites anytime under Past sessions.',
    ],
    cta: 'Enter Test Prep',
    icon: Mic,
  },
  brief: {
    eyebrow: 'Brief Tab · Authentic News & DLPT Drills',
    title: 'Authentic Open-Source Feed by ILR Level',
    summary:
      'Explore authentic radio broadcasts and news in Spanish and Portuguese rated from ILR Level 2 to 3+, matched to the DLPT range.',
    bullets: [
      'Filter by Listening or Reading, ILR level (2, 2+, 3, 3+), topic, and optional Work focus.',
      'Test your comprehension with 3-question DLPT drills, instant rationale, and practice estimates.',
      'Tap "Brief it back" to take any story directly into an Oral Proficiency Interview as Level 3 probe material.',
    ],
    cta: 'Explore Briefs',
    icon: FileText,
  },
  vocab: {
    eyebrow: 'Vocab Tab · Active Recall',
    title: 'Personal Vocab & Active Recall',
    summary:
      'Turn every word you struggled with during Talk or Test prep into active-recall drills instead of letting live practice slip away.',
    bullets: [
      'Filter saved words in your active language by category, search keywords, or mastery status.',
      'Drill terms in original sentences with AI or manual recall checks.',
      'Export your captured vocabulary as an Anki-ready CSV deck anytime.',
    ],
    cta: 'Open Vocab',
    icon: Layers,
  },
};

export const TabIntroModal: React.FC<TabIntroModalProps> = ({tab, onDismiss, onOpenFullTour}) => {
  if (!tab) return null;

  const spec = TAB_INTROS[tab];
  const Icon = spec.icon;

  return (
    <Dialog
      labelledBy="tab-intro-title"
      onClose={() => onDismiss(tab)}
      closeOnBackdrop
      overlayClassName="bg-black/70"
      className="w-full max-w-md rounded-2xl border border-[#23303E] bg-[#111922] shadow-2xl overflow-hidden"
    >
      <div className="px-5 pt-5 pb-4 border-b border-[#23303E] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg border border-[#D99B26]/40 bg-[#D99B26]/10 flex items-center justify-center shrink-0">
            <Icon className="w-4 h-4 text-[#D99B26]" />
          </div>
          <p className="text-xs font-medium text-[#F3C669] truncate">{spec.eyebrow}</p>
        </div>

        <button
          type="button"
          onClick={() => onDismiss(tab)}
          aria-label="Close tab introduction"
          className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#94A3B8] hover:text-white hover:bg-[#192533] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5 space-y-4">
        <div className="space-y-1.5">
          <h2 id="tab-intro-title" className="text-lg font-semibold tracking-tight text-[#F8FAFC]">
            {spec.title}
          </h2>
          <p className="text-sm text-[#CBD5E1] leading-relaxed">{spec.summary}</p>
        </div>

        <ul className="space-y-2 rounded-xl border border-[#23303E] bg-[#0B1117] p-3.5">
          {spec.bullets.map((line) => (
            <li key={line} className="flex items-start gap-2 text-xs text-[#94A3B8] leading-relaxed">
              <Check className="w-3.5 h-3.5 text-[#D99B26] shrink-0 mt-0.5" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="px-5 py-3.5 border-t border-[#23303E] bg-[#0D141C] flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            onDismiss(tab);
            onOpenFullTour();
          }}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#94A3B8] hover:text-[#F8FAFC] transition-colors"
        >
          <Compass className="w-3.5 h-3.5 text-[#D99B26]" />
          <span>Full App Tour</span>
        </button>

        <button
          type="button"
          onClick={() => onDismiss(tab)}
          className="px-4 py-2 min-h-[38px] rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] transition-colors"
        >
          {spec.cta}
        </button>
      </div>
    </Dialog>
  );
};
