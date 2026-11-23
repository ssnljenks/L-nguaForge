import React, {useEffect} from 'react';
import {BookMarked, Check, Compass, FileBarChart2, MessageSquare, Mic, Timer, X} from 'lucide-react';
import type {ModuleTab} from '../types';

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
  chat: {
    eyebrow: 'Chat Tab · Home Base',
    title: 'Live Voice Conversation Partner',
    summary:
      'Practice natural back-and-forth speech in real time using Gemini Live—or switch to typing anytime you are in a quiet space.',
    bullets: [
      'Choose Casual, ILR 2+, or ILR 3 tone before starting a voice session.',
      'Tap any partner word in live captions (or use Flag a Word) to save it straight to your Vocab Vault.',
      'Built-in Spanish/Portuguese dictionaries handle common word lookups offline at zero API cost.',
    ],
    cta: 'Start Chatting',
    icon: MessageSquare,
  },
  opi: {
    eyebrow: 'OPI Tab · Simulated Evaluation',
    title: 'Live Voice OPI Simulator',
    summary:
      'Stress-test your ILR Level 2 to 2+/3 progression with an examiner that adapts dynamically between concrete baselines and abstract policy probes.',
    bullets: [
      'Starts at Level 2 concrete topics, then pushes into Level 3 hypotheticals requiring the subjunctive.',
      'Use the 5-Second Tip-of-the-Tongue Helper when stuck mid-thought to train active recall.',
      'Tap End & Run ILR Debrief afterward for a structured level audit.',
    ],
    cta: 'Enter OPI Room',
    icon: Mic,
  },
  debrief: {
    eyebrow: 'Debrief Tab · Post-Session Audit',
    title: 'ILR Performance Debrief',
    summary:
      'Review completed OPI interviews and 90-second monologues for register control, false friends, and concrete upgrades.',
    bullets: [
      'Generates side-by-side Natural 2+ Rewrites tailored to what you actually said.',
      'Audits grammar precision, register control, and subjunctive/conditional opportunities.',
      'Save upgraded phrasing directly into your Vocab Vault with one tap.',
    ],
    cta: 'View Debriefs',
    icon: FileBarChart2,
  },
  vault: {
    eyebrow: 'Vault Tab · Active Recall',
    title: 'Personal Vocab Vault',
    summary:
      'Turn every word you struggled with during Chat or OPI into active-recall drills instead of letting live practice slip away.',
    bullets: [
      'Filter saved words in your active language by category, search keywords, or mastery status.',
      'Drill terms in original sentences with AI or manual recall checks.',
      'Export your captured vocabulary as an Anki-ready CSV deck anytime.',
    ],
    cta: 'Open Vault',
    icon: BookMarked,
  },
  lab: {
    eyebrow: 'Lab Tab · Briefing & Interp Drills',
    title: '90s PREP & Consecutive Interp Lab',
    summary:
      'Train crisp 90-second policy monologues and consecutive interpretation note-chunking for high-stakes briefings.',
    bullets: [
      '90s PREP tracks Point → Reason → Example → Pivot on a live visual pacing timeline.',
      'Consecutive Interp pairs Blind Listen audio clips with a Rozan-style symbol scratchpad.',
      'Grades structural clarity, numerical fidelity, and diplomatic register.',
    ],
    cta: 'Open Lab',
    icon: Timer,
  },
};

export const TabIntroModal: React.FC<TabIntroModalProps> = ({tab, onDismiss, onOpenFullTour}) => {
  useEffect(() => {
    if (!tab) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss(tab);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [tab, onDismiss]);

  if (!tab) return null;

  const spec = TAB_INTROS[tab];
  const Icon = spec.icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tab-intro-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss(tab);
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-[#23303E] bg-[#111922] shadow-2xl overflow-hidden">
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
            {spec.bullets.map((line, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-[#94A3B8] leading-relaxed">
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
      </div>
    </div>
  );
};
