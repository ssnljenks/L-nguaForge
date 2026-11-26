import React from 'react';
import {Briefcase, HelpCircle, MessageCircle, RotateCcw} from 'lucide-react';
import {DEFAULT_SCENE_ID, getTutorsByLanguage, type TutorPersona, WORK_TALK_SCENE_ID} from '../../data/tutors';
import type {MilitaryDomain, MissionConfig, TalkCorrectionMode} from '../../types';
import {MILITARY_DOMAINS} from '../../utils/ilrLogic';
import {clampSlangLevel, getSlangLevelSpec, TALK_CORRECTION_OPTIONS} from '../../utils/talkLogic';

interface TalkSetupScreenProps {
  config: MissionConfig;
  selectedTutor: TutorPersona;
  sceneId: string;
  workTalk: boolean;
  selectedDomain: MilitaryDomain;
  slangLevel: number;
  correctionMode: TalkCorrectionMode;
  existingTurnCount: number;
  existingTutorName?: string;
  onSelectTutor: (tutor: TutorPersona) => void;
  onSelectScene: (sceneId: string, isWorkTalk: boolean) => void;
  onSelectDomain: (domain: MilitaryDomain) => void;
  onChangeSlangLevel: (level: number) => void;
  onChangeCorrectionMode: (mode: TalkCorrectionMode) => void;
  onStartTalking: () => void;
  onResumeExisting: () => void;
  onStartFresh: () => void;
  onOpenTabHelp: () => void;
}

export const TalkSetupScreen: React.FC<TalkSetupScreenProps> = ({
  config,
  selectedTutor,
  sceneId,
  workTalk,
  selectedDomain,
  slangLevel,
  correctionMode,
  existingTurnCount,
  existingTutorName,
  onSelectTutor,
  onSelectScene,
  onSelectDomain,
  onChangeSlangLevel,
  onChangeCorrectionMode,
  onStartTalking,
  onResumeExisting,
  onStartFresh,
  onOpenTabHelp,
}) => {
  const tutors = getTutorsByLanguage(config.language);
  const clampedSlang = clampSlangLevel(slangLevel);
  const slangSpec = getSlangLevelSpec(clampedSlang);
  const showWorkChip = config.workFocusEnabled;
  const activeWorkTalk = showWorkChip && workTalk;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-28 md:pb-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 pb-4 border-b border-[#23303E]">
        <div className="space-y-1">
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[#F8FAFC]">Talk</h1>
          <p className="text-sm text-[#94A3B8]">
            Pick a local partner, set how street or casual you want the chat, and talk like you&apos;re really there.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenTabHelp}
          className="hidden sm:inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-[#23303E] bg-[#111922] text-xs font-medium text-[#CBD5E1] hover:text-white hover:border-[#35495E] transition-colors shrink-0 whitespace-nowrap"
        >
          <HelpCircle className="w-3.5 h-3.5 text-[#D99B26]" />
          <span>How it works</span>
        </button>
      </div>

      {/* Resume existing chat option if there is an active conversation */}
      {existingTurnCount > 0 && (
        <section
          aria-label="Active conversation"
          className="rounded-xl border border-[#2E4054] bg-[#111922] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-[#F8FAFC]">
              Conversation in progress{existingTutorName ? ` with ${existingTutorName}` : ''}
            </p>
            <p className="text-xs text-[#94A3B8]">
              <span className="font-mono tabular-nums">{existingTurnCount}</span>{' '}
              {existingTurnCount === 1 ? 'message' : 'messages'} saved locally.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onResumeExisting}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg border border-[#D99B26]/60 bg-[#1B2531] text-xs font-semibold text-[#F3C669] hover:bg-[#223041] transition-colors"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>Keep talking</span>
            </button>
            <button
              type="button"
              onClick={onStartFresh}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-[#23303E] text-xs font-medium text-[#94A3B8] hover:text-white transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          </div>
        </section>
      )}

      {/* 1. Local Tutor Picker */}
      <section className="space-y-3" aria-labelledby="talk-tutor-heading">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="talk-tutor-heading" className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
            Choose a local partner
          </h2>
          <span className="text-xs text-[#7D8FA3]">
            {selectedTutor.name} · {selectedTutor.city}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {tutors.map((tutor) => {
            const selected = tutor.id === selectedTutor.id;
            return (
              <button
                key={tutor.id}
                type="button"
                onClick={() => onSelectTutor(tutor)}
                aria-pressed={selected}
                data-testid={`tutor-card-${tutor.id}`}
                className={`text-left rounded-xl border p-4 min-h-[44px] transition-colors space-y-2.5 ${
                  selected
                    ? 'border-[#D99B26] bg-[#16202B]'
                    : 'border-[#23303E] bg-[#111922] hover:border-[#35495E] hover:bg-[#141E29]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-semibold text-[#F8FAFC]">
                      {tutor.name} <span className="text-sm font-normal text-[#94A3B8]">· {tutor.city}</span>
                    </p>
                    <p className="text-xs text-[#7DD3FC]">
                      {tutor.regionTag} · {tutor.defaultRegister}
                    </p>
                  </div>
                  {selected && <span className="text-[11px] font-semibold text-[#F3C669] shrink-0">Selected</span>}
                </div>

                <p className="text-xs text-[#CBD5E1] leading-relaxed">{tutor.bio}</p>

                <ul className="space-y-1 text-xs text-[#94A3B8]">
                  {tutor.signatureFeatures.slice(0, 2).map((feat) => (
                    <li key={feat} className="truncate">
                      · {feat}
                    </li>
                  ))}
                </ul>

                <p className="text-[11px] text-[#7D8FA3] truncate pt-0.5 border-t border-[#1D2835]">
                  Says:{' '}
                  {tutor.slangExamples
                    .slice(0, 3)
                    .map((s) => s.term)
                    .join(', ')}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* 2. Scene Chips (+ conditional Work talk) */}
      <section
        className="space-y-3 rounded-xl border border-[#23303E] bg-[#111922] p-4 sm:p-5"
        aria-labelledby="talk-scene-heading"
      >
        <div className="space-y-0.5">
          <h2 id="talk-scene-heading" className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
            Setting the scene
          </h2>
          <p className="text-xs text-[#7D8FA3]">
            Pick a place in {selectedTutor.city} or keep it open with &ldquo;Just chatting&rdquo;.
          </p>
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Conversation scene">
          {selectedTutor.scenes.map((scene) => {
            const active = !activeWorkTalk && (sceneId === scene.id || (!sceneId && scene.id === DEFAULT_SCENE_ID));
            return (
              <button
                key={scene.id}
                type="button"
                onClick={() => onSelectScene(scene.id, false)}
                aria-pressed={active}
                className={`min-h-[44px] px-3.5 py-2 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'border-[#D99B26] bg-[#1B2531] text-[#F8FAFC] font-semibold'
                    : 'border-[#23303E] bg-[#0D141C] text-[#CBD5E1] hover:border-[#35495E] hover:text-white'
                }`}
              >
                {scene.label}
              </button>
            );
          })}

          {showWorkChip && (
            <button
              type="button"
              data-testid="talk-work-chip"
              onClick={() => onSelectScene(WORK_TALK_SCENE_ID, true)}
              aria-pressed={activeWorkTalk}
              className={`inline-flex items-center gap-1.5 min-h-[44px] px-3.5 py-2 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                activeWorkTalk
                  ? 'border-[#7DD3FC] bg-[#142333] text-[#BAE6FD] font-semibold'
                  : 'border-[#23303E] bg-[#0D141C] text-[#CBD5E1] hover:border-[#35495E] hover:text-white'
              }`}
            >
              <Briefcase className="w-3.5 h-3.5" />
              <span>Work talk</span>
            </button>
          )}
        </div>

        {activeWorkTalk && (
          <div className="pt-3 mt-1 border-t border-[#1D2835] space-y-2.5" data-testid="work-talk-domain-picker">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-[#BAE6FD]">Work focus area (saved phrases get tagged here)</p>
              <span className="text-[11px] text-[#7D8FA3]">Professional register</span>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Work talk focus domain">
              {MILITARY_DOMAINS.map((dom) => {
                const isSelected = selectedDomain === dom.id;
                return (
                  <button
                    key={dom.id}
                    type="button"
                    onClick={() => onSelectDomain(dom.id)}
                    aria-pressed={isSelected}
                    className={`min-h-[44px] px-3 py-2 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                      isSelected
                        ? 'border-[#D99B26] bg-[#1B2531] text-[#F3C669] font-semibold'
                        : 'border-[#23303E] bg-[#0B1117] text-[#94A3B8] hover:text-white'
                    }`}
                  >
                    {dom.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* 3. Slang Dial (0-4) + Corrections Mode */}
      <section className="rounded-xl border border-[#23303E] bg-[#111922] p-4 sm:p-5 space-y-5">
        <div className="space-y-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <label
              htmlFor="talk-slang-slider"
              className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]"
            >
              How local &amp; casual
            </label>
            <span className="text-xs font-semibold text-[#F3C669] font-mono tabular-nums">
              {slangSpec.level}/4 · {slangSpec.label}
            </span>
          </div>

          <input
            id="talk-slang-slider"
            type="range"
            min={0}
            max={4}
            step={1}
            value={clampedSlang}
            onChange={(e) => onChangeSlangLevel(Number(e.target.value))}
            aria-valuetext={`${slangSpec.level} out of 4: ${slangSpec.label}`}
            className="w-full h-11 accent-[#D99B26] cursor-pointer"
          />

          <div className="flex items-center justify-between text-[11px] text-[#7D8FA3]">
            <span>0 · Textbook</span>
            <span>2 · Everyday</span>
            <span>4 · Street</span>
          </div>
          <p className="text-xs text-[#CBD5E1]">{slangSpec.shortDesc}.</p>
        </div>

        <div className="pt-4 border-t border-[#1D2835] space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">Corrections</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="group" aria-label="Corrections preference">
            {TALK_CORRECTION_OPTIONS.map((opt) => {
              const active = correctionMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onChangeCorrectionMode(opt.id)}
                  aria-pressed={active}
                  className={`min-h-[48px] px-3 py-2.5 rounded-lg border text-left transition-colors ${
                    active
                      ? 'border-[#D99B26] bg-[#1B2531] text-[#F8FAFC]'
                      : 'border-[#23303E] bg-[#0D141C] text-[#94A3B8] hover:text-white'
                  }`}
                >
                  <span className="block text-xs font-semibold">{opt.label}</span>
                  <span className="block text-[11px] text-[#7D8FA3] mt-0.5 leading-snug">{opt.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Desktop Primary CTA */}
      <div className="hidden md:flex items-center justify-end pt-1">
        <button
          type="button"
          onClick={onStartTalking}
          data-testid="talk-start-setup-desktop"
          className="inline-flex items-center justify-center gap-2 min-h-[52px] px-7 rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
        >
          <MessageCircle className="w-4 h-4" />
          <span>Start talking with {selectedTutor.name}</span>
        </button>
      </div>

      {/* Mobile Sticky Thumb-Zone CTA */}
      <div className="md:hidden fixed bottom-[60px] left-0 right-0 z-30 px-4 py-2.5 bg-[#0B1117]/95 backdrop-blur-md border-t border-[#23303E]">
        <button
          type="button"
          onClick={onStartTalking}
          data-testid="talk-start-setup-mobile"
          className="w-full inline-flex items-center justify-center gap-2 min-h-[52px] px-5 rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
        >
          <MessageCircle className="w-4 h-4" />
          <span>Start talking with {selectedTutor.name}</span>
        </button>
      </div>
    </div>
  );
};
