import React from 'react';
import {Newspaper, PhoneCall, Sparkles, Timer} from 'lucide-react';
import type {BriefItem, MissionConfig, OpiCallMode, OpiFocusLevel, OpiTopicSource} from '../../types';
import {getDialectInfo, LANGUAGE_LABELS} from '../../utils/ilrLogic';

interface OpiSetupScreenProps {
  config: MissionConfig;
  mode: OpiCallMode;
  focusLevel: OpiFocusLevel;
  includeRoleplay: boolean;
  topicSource: OpiTopicSource;
  briefStory?: BriefItem | null;
  isStarting: boolean;
  error: string | null;
  onChangeMode: (mode: OpiCallMode) => void;
  onChangeFocusLevel: (level: OpiFocusLevel) => void;
  onChangeIncludeRoleplay: (include: boolean) => void;
  onChangeTopicSource: (source: OpiTopicSource) => void;
  onStartCall: () => void;
}

const FOCUS_OPTIONS: {value: OpiFocusLevel; label: string}[] = [
  {value: 'adaptive', label: 'Adaptive'},
  {value: 1, label: 'Level 1'},
  {value: 2, label: 'Level 2'},
  {value: 3, label: 'Level 3'},
];

export const OpiSetupScreen: React.FC<OpiSetupScreenProps> = ({
  config,
  mode,
  focusLevel,
  includeRoleplay,
  topicSource,
  briefStory,
  isStarting,
  error,
  onChangeMode,
  onChangeFocusLevel,
  onChangeIncludeRoleplay,
  onChangeTopicSource,
  onStartCall,
}) => {
  const dialectInfo = getDialectInfo(config.language, config.dialect);

  return (
    <div className="space-y-5">
      {/* Header — General ILR OPI (no military domain) */}
      <div className="space-y-1.5 pb-4 border-b border-[#23303E]">
        <p className="text-xs font-medium text-[#94A3B8]">
          General ILR Speaking · {LANGUAGE_LABELS[config.language]} ({dialectInfo.short})
        </p>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[#F8FAFC]">
          Oral Proficiency Interview
        </h1>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-[#F87171]/40 bg-red-950/30 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      {/* Main Setup Card */}
      <section
        data-testid="opi-setup-card"
        className="rounded-xl border border-[#23303E] bg-[#111922] p-5 sm:p-6 space-y-6"
      >
        {/* 1. Exam vs Practice Segmented Toggle */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">Call Conditions</span>
            <span className="text-xs text-[#7DD3FC] font-medium">
              {mode === 'exam' ? 'Authentic OPI' : 'Guided Practice'}
            </span>
          </div>

          <div
            role="tablist"
            aria-label="OPI call mode"
            className="grid grid-cols-2 p-1 rounded-xl bg-[#0B1117] border border-[#23303E]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'exam'}
              onClick={() => onChangeMode('exam')}
              className={`min-h-[44px] px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                mode === 'exam' ? 'bg-[#D99B26] text-[#0B1117]' : 'text-[#94A3B8] hover:text-[#F8FAFC]'
              }`}
            >
              Exam mode
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'practice'}
              onClick={() => onChangeMode('practice')}
              className={`min-h-[44px] px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                mode === 'practice' ? 'bg-[#D99B26] text-[#0B1117]' : 'text-[#94A3B8] hover:text-[#F8FAFC]'
              }`}
            >
              Practice mode
            </button>
          </div>

          <p data-testid="opi-mode-description" className="text-xs sm:text-sm text-[#CBD5E1] leading-relaxed">
            {mode === 'exam'
              ? 'Phone-call conditions, like the real OPI. No hints, no level badge, no live transcript.'
              : 'Guided call showing the current phase, Focus level controls, live transcript, and 5-second hints.'}
          </p>
        </div>

        {/* 2. Practice-Mode Only: Focus Level Selector */}
        {mode === 'practice' && (
          <div data-testid="opi-focus-level-group" className="pt-5 border-t border-[#23303E] space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">Focus level</span>
              <span className="text-xs text-[#7DD3FC]">
                {focusLevel === 'adaptive' ? 'Checks & probes adjust live' : `Focused on Level ${focusLevel}`}
              </span>
            </div>

            <div
              role="radiogroup"
              aria-label="Focus level"
              className="grid grid-cols-4 p-1 gap-1 rounded-xl bg-[#0B1117] border border-[#23303E]"
            >
              {FOCUS_OPTIONS.map((opt) => {
                const selected = focusLevel === opt.value;
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`focus-level-${opt.value}`}
                    onClick={() => onChangeFocusLevel(opt.value)}
                    className={`min-h-[44px] px-2 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
                      selected ? 'bg-[#7DD3FC] text-[#0B1117]' : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-[#94A3B8]">
              Adaptive confirms Level 2 and probes Level 3 (or drops to Level 1 on breakdowns); a fixed level runs
              checks and probes around that band.
            </p>
          </div>
        )}

        {/* 3. Topic Source Radio Group (No "My domain") */}
        <div className="pt-5 border-t border-[#23303E]">
          <fieldset className="space-y-2.5">
            <legend className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">Topic</legend>

            <div className="space-y-2">
              {/* Examiner's choice (Default) */}
              <label
                htmlFor="opi-topic-examiner"
                aria-label="Examiner's choice — General everyday and societal topics matched to your level"
                className={`flex items-start gap-3 rounded-xl border px-4 py-3 min-h-[52px] cursor-pointer transition-colors ${
                  topicSource === 'examiner_choice'
                    ? 'border-[#D99B26] bg-[#D99B26]/10'
                    : 'border-[#23303E] bg-[#0B1117] hover:border-[#35495E]'
                }`}
              >
                <input
                  id="opi-topic-examiner"
                  type="radio"
                  name="opi-topic-source"
                  value="examiner_choice"
                  checked={topicSource === 'examiner_choice'}
                  onChange={() => onChangeTopicSource('examiner_choice')}
                  className="mt-1 h-4 w-4 accent-[#D99B26] cursor-pointer"
                />
                <span className="flex-1 min-w-0 block">
                  <span className="flex items-center gap-2 text-sm font-semibold text-[#F8FAFC]">
                    <Sparkles className="w-3.5 h-3.5 text-[#7DD3FC] shrink-0" aria-hidden="true" />
                    Examiner&apos;s choice
                  </span>
                  <span className="block text-xs text-[#94A3B8] mt-0.5">
                    Everyday life, work, culture, society, economy &amp; sci/tech scaled to each ILR level
                  </span>
                </span>
              </label>

              {/* From today's brief */}
              <label
                htmlFor="opi-topic-brief"
                aria-label={
                  briefStory
                    ? `From today's brief: ${briefStory.title}`
                    : "From today's brief — Open-source story for Level 3 probe briefing"
                }
                className={`flex items-start gap-3 rounded-xl border px-4 py-3 min-h-[52px] cursor-pointer transition-colors ${
                  topicSource === 'brief'
                    ? 'border-[#D99B26] bg-[#D99B26]/10'
                    : 'border-[#23303E] bg-[#0B1117] hover:border-[#35495E]'
                }`}
              >
                <input
                  id="opi-topic-brief"
                  type="radio"
                  name="opi-topic-source"
                  value="brief"
                  checked={topicSource === 'brief'}
                  onChange={() => onChangeTopicSource('brief')}
                  className="mt-1 h-4 w-4 accent-[#D99B26] cursor-pointer"
                />
                <span className="flex-1 min-w-0 block">
                  <span className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-[#F8FAFC]">
                    <span className="inline-flex items-center gap-2">
                      <Newspaper className="w-3.5 h-3.5 text-[#7DD3FC] shrink-0" aria-hidden="true" />
                      From today&apos;s brief
                    </span>
                    {briefStory && (
                      <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#16202B] text-[#D99B26]">
                        Story selected
                      </span>
                    )}
                  </span>
                  {briefStory ? (
                    <span className="block text-xs text-[#CBD5E1] mt-1 line-clamp-1">
                      &ldquo;{briefStory.title}&rdquo; · {briefStory.sourceName}
                    </span>
                  ) : (
                    <span className="block text-xs text-[#94A3B8] mt-0.5">
                      Practice briefing today&apos;s top story as Level 3 probe material
                    </span>
                  )}
                </span>
              </label>
            </div>
          </fieldset>
        </div>

        {/* 4. What to expect · ~15–20 min (5 steps, Role-play toggleable) */}
        <div className="space-y-3 pt-5 border-t border-[#23303E]">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#CBD5E1]">
            <Timer className="w-3.5 h-3.5 text-[#D99B26]" />
            <span>What to expect · ~15–20 min</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            <div className="rounded-xl border border-[#23303E] bg-[#0B1117] p-3.5 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[#F8FAFC]">Warm-up</span>
                <span className="font-mono text-[11px] text-[#7D8FA3]">01</span>
              </div>
              <p className="text-xs text-[#94A3B8] leading-relaxed">
                Greetings &amp; easy personal questions (~2 min, unrated).
              </p>
            </div>

            <div className="rounded-xl border border-[#23303E] bg-[#0B1117] p-3.5 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[#F8FAFC]">Level checks</span>
                <span className="font-mono text-[11px] text-[#7D8FA3]">02</span>
              </div>
              <p className="text-xs text-[#94A3B8] leading-relaxed">
                Confirm steady baseline functions across concrete topics.
              </p>
            </div>

            <div className="rounded-xl border border-[#23303E] bg-[#0B1117] p-3.5 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[#F8FAFC]">Probes</span>
                <span className="font-mono text-[11px] text-[#7D8FA3]">03</span>
              </div>
              <p className="text-xs text-[#94A3B8] leading-relaxed">
                Opinions, counterfactual hypotheses &amp; abstract ideas one level up.
              </p>
            </div>

            {/* Role-play interactive toggle card */}
            <div
              className={`rounded-xl border p-3.5 space-y-1.5 transition-colors ${
                includeRoleplay ? 'border-[#D99B26]/50 bg-[#0B1117]' : 'border-[#23303E] bg-[#0B1117]/60 opacity-75'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[#F8FAFC]">Role-play</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={includeRoleplay}
                  aria-label="Include Role-play scenario in this interview"
                  data-testid="opi-roleplay-toggle"
                  onClick={() => onChangeIncludeRoleplay(!includeRoleplay)}
                  className="relative inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-full"
                >
                  {/* 44 px hit area around the visual track (REVIEW M-12). */}
                  <span
                    aria-hidden="true"
                    className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
                      includeRoleplay ? 'bg-[#D99B26] border-[#D99B26]' : 'bg-[#16202B] border-[#35495E]'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-[#0B1117] transition-transform ${
                        includeRoleplay ? 'translate-x-5' : 'translate-x-1 bg-[#94A3B8]'
                      }`}
                    />
                  </span>
                </button>
              </div>
              <p className="text-xs text-[#94A3B8] leading-relaxed">
                {includeRoleplay
                  ? 'Included: brief situational task at your probe level.'
                  : 'Skipped for this interview.'}
              </p>
            </div>

            <div className="rounded-xl border border-[#23303E] bg-[#0B1117] p-3.5 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[#F8FAFC]">Wind-down</span>
                <span className="font-mono text-[11px] text-[#7D8FA3]">05</span>
              </div>
              <p className="text-xs text-[#94A3B8] leading-relaxed">
                Closes at a comfortable level so you finish on a success.
              </p>
            </div>
          </div>
        </div>

        {/* Desktop Primary CTA */}
        <div className="hidden md:flex items-center justify-between gap-4 pt-4 border-t border-[#23303E]">
          <p className="text-xs text-[#94A3B8]">
            Mic audio stays on this device (last call only) for breakdown clip playback in Debrief.
          </p>
          <button
            type="button"
            data-testid="opi-start-call-desktop"
            onClick={onStartCall}
            disabled={isStarting}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 min-h-[52px] rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <PhoneCall className="w-4 h-4" />
            <span>{isStarting ? 'Connecting call…' : 'Start the call'}</span>
          </button>
        </div>
      </section>

      {/* Mobile Sticky Thumb-Zone Primary CTA */}
      <div className="md:hidden fixed bottom-[60px] left-0 right-0 z-30 px-4 py-2.5 bg-[#0B1117]/95 backdrop-blur-md border-t border-[#23303E]">
        <button
          type="button"
          data-testid="opi-primary-cta-mobile"
          onClick={onStartCall}
          disabled={isStarting}
          className="w-full inline-flex items-center justify-center gap-2 min-h-[52px] px-5 rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] disabled:opacity-50 transition-colors"
        >
          <PhoneCall className="w-4 h-4" />
          <span>{isStarting ? 'Connecting call…' : 'Start the call'}</span>
        </button>
      </div>
    </div>
  );
};
