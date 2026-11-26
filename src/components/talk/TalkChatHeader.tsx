import React from 'react';
import {ArrowLeft, HelpCircle, MessageSquarePlus, Sparkles} from 'lucide-react';
import type {TutorPersona} from '../../data/tutors';

interface TalkChatHeaderProps {
  selectedTutor: TutorPersona;
  activeSceneLabel: string;
  slangLabel: string;
  onBackToSetup: () => void;
  onOpenHowLocals: () => void;
  onOpenWrapUp: () => void;
  onOpenTabHelp: () => void;
}

/** Partner, scene and slang level, with Back, "How do locals say…", Wrap up and help. */
export const TalkChatHeader: React.FC<TalkChatHeaderProps> = ({
  selectedTutor,
  activeSceneLabel,
  slangLabel,
  onBackToSetup,
  onOpenHowLocals,
  onOpenWrapUp,
  onOpenTabHelp,
}) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#23303E]">
    <div className="flex items-start gap-2.5 min-w-0">
      <button
        type="button"
        onClick={onBackToSetup}
        aria-label="Back to partner & scene setup"
        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-[#23303E] bg-[#111922] text-[#CBD5E1] hover:text-white transition-colors shrink-0"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
      <div className="min-w-0">
        <h1 className="font-display text-lg sm:text-xl font-semibold tracking-tight text-[#F8FAFC] truncate">
          {selectedTutor.name} · {selectedTutor.city}
        </h1>
        <p className="text-xs text-[#94A3B8] truncate">
          {activeSceneLabel} · {slangLabel} · {selectedTutor.defaultRegister}
        </p>
      </div>
    </div>

    <div className="flex flex-wrap items-center gap-2 shrink-0">
      <button
        type="button"
        onClick={onOpenHowLocals}
        data-testid="how-do-locals-say-btn"
        className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-lg border border-[#2E4054] bg-[#111922] text-xs font-medium text-[#BAE6FD] hover:border-[#7DD3FC]/60 hover:text-white transition-colors whitespace-nowrap"
      >
        <MessageSquarePlus className="w-3.5 h-3.5 text-[#7DD3FC]" />
        <span>How do locals say…</span>
      </button>

      <button
        type="button"
        onClick={onOpenWrapUp}
        data-testid="talk-wrap-up-btn"
        className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-lg border border-[#D99B26]/55 bg-[#1B2531] text-xs font-semibold text-[#F3C669] hover:bg-[#223041] transition-colors whitespace-nowrap"
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span>Wrap up</span>
      </button>

      <button
        type="button"
        onClick={onOpenTabHelp}
        aria-label="How Talk works"
        className="hidden sm:inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border border-[#23303E] bg-[#111922] text-[#94A3B8] hover:text-white transition-colors"
      >
        <HelpCircle className="w-4 h-4" />
      </button>
    </div>
  </div>
);
