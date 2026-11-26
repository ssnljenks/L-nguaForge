import React from 'react';
import {AlertCircle, ArrowLeft, Loader2, PhoneCall, RefreshCw, Timer} from 'lucide-react';
import type {IlrBaseLevel} from '../../data/ilrSpeakingLevels';
import type {MissionConfig, RoleplayScenarioPublic} from '../../types';
import {getDialectInfo, LANGUAGE_LABELS} from '../../utils/ilrLogic';
import {isTwistHintVisible, ROLEPLAY_TWIST_HINT} from '../../utils/opiRoleplay';

interface RoleplaySetupScreenProps {
  config: MissionConfig;
  level: IlrBaseLevel;
  scenario: RoleplayScenarioPublic | null;
  knownTwist?: {hiddenGoal: string; complication: string} | null;
  isLoadingScenario: boolean;
  isStartingCall: boolean;
  error: string | null;
  onChangeLevel: (level: IlrBaseLevel) => void;
  onRefreshScenario: () => void;
  onClearReplayTwist?: () => void;
  onBack: () => void;
  onStartCall: () => void;
}

const LEVEL_CHOICES: {level: IlrBaseLevel; title: string; subtitle: string}[] = [
  {level: 1, title: 'Level 1', subtitle: 'Everyday transaction'},
  {level: 2, title: 'Level 2', subtitle: 'Routine + complication'},
  {level: 3, title: 'Level 3', subtitle: 'Delicate persuasion'},
];

export const RoleplaySetupScreen: React.FC<RoleplaySetupScreenProps> = ({
  config,
  level,
  scenario,
  knownTwist,
  isLoadingScenario,
  isStartingCall,
  error,
  onChangeLevel,
  onRefreshScenario,
  onClearReplayTwist,
  onBack,
  onStartCall,
}) => {
  const dialectInfo = getDialectInfo(config.language, config.dialect);
  const showTwistHint = isTwistHintVisible(level);

  return (
    <div className="space-y-5 pb-28 md:pb-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#23303E]">
        <div className="space-y-1">
          <p className="text-xs font-medium text-[#94A3B8]">
            Civilian Role-play · {LANGUAGE_LABELS[config.language]} ({dialectInfo.short})
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[#F8FAFC]">
            ILR Situational Role-play
          </h1>
        </div>

        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 min-h-[44px] px-3.5 rounded-lg border border-[#23303E] bg-[#111922] text-xs font-medium text-[#CBD5E1] hover:text-white hover:border-[#35495E] transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-[#D99B26]" />
          <span>Back to Test prep</span>
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-[#F87171]/40 bg-red-950/30 px-4 py-3 text-sm text-red-200 flex items-center justify-between gap-3"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={onRefreshScenario}
            className="min-h-[36px] px-3 rounded-lg border border-[#F87171]/40 text-xs font-semibold text-white hover:bg-red-900/40 shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Level Picker 1 / 2 / 3 */}
      <section className="rounded-xl border border-[#23303E] bg-[#111922] p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">Select target level</span>
          <div className="inline-flex items-center gap-1.5 text-xs text-[#CBD5E1]">
            <Timer className="w-3.5 h-3.5 text-[#D99B26]" />
            <span className="font-mono tabular-nums">~4 min</span>
          </div>
        </div>

        <div role="radiogroup" aria-label="Role-play ILR level" className="grid grid-cols-3 gap-2">
          {LEVEL_CHOICES.map((choice) => {
            const active = level === choice.level;
            return (
              <button
                key={choice.level}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`roleplay-level-${choice.level}`}
                onClick={() => onChangeLevel(choice.level)}
                disabled={isStartingCall}
                className={`rounded-xl border px-3 py-3 min-h-[56px] text-left transition-colors ${
                  active
                    ? 'border-[#D99B26] bg-[#D99B26]/12 text-[#F8FAFC]'
                    : 'border-[#23303E] bg-[#0B1117] text-[#94A3B8] hover:text-[#F8FAFC] hover:border-[#35495E]'
                }`}
              >
                <span className={`block text-sm font-semibold ${active ? 'text-[#F3C669]' : 'text-[#F8FAFC]'}`}>
                  {choice.title}
                </span>
                <span className="block text-[11px] text-[#94A3B8] mt-0.5 leading-snug">{choice.subtitle}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Amber-bordered "Your situation" card in English */}
      <section
        data-testid="roleplay-situation-card"
        className="rounded-xl border-2 border-[#D99B26] bg-[#111922] p-5 sm:p-6 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold text-[#F3C669]">Your situation</h2>
          <button
            type="button"
            data-testid="roleplay-new-scenario-btn"
            onClick={onRefreshScenario}
            disabled={isLoadingScenario || isStartingCall}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-[#23303E] bg-[#0B1117] text-xs font-medium text-[#CBD5E1] hover:text-white hover:border-[#D99B26]/60 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#D99B26] ${isLoadingScenario ? 'animate-spin' : ''}`} />
            <span>New scenario</span>
          </button>
        </div>

        {isLoadingScenario && !scenario ? (
          <div role="status" className="flex items-center gap-3 py-6 text-sm text-[#94A3B8]">
            <Loader2 className="w-4 h-4 animate-spin text-[#D99B26]" />
            <span>Preparing Level {level} civilian scenario…</span>
          </div>
        ) : scenario ? (
          <div className="space-y-4">
            <p data-testid="roleplay-situation-text" className="text-sm sm:text-base text-[#F8FAFC] leading-relaxed">
              {scenario.situationEnglish}
            </p>

            <div className="rounded-lg border border-[#23303E] bg-[#0B1117] p-3.5 space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">Your goal</span>
              <p className="text-sm text-[#E6EDF3] leading-relaxed">{scenario.learnerGoal}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
              <div className="rounded-lg border border-[#23303E] bg-[#0B1117] px-3.5 py-2.5">
                <span className="block text-[#94A3B8]">Expected register</span>
                <span data-testid="roleplay-register-value" className="font-mono text-sm font-semibold text-[#7DD3FC]">
                  {scenario.register}
                </span>
              </div>

              <div className="rounded-lg border border-[#23303E] bg-[#0B1117] px-3.5 py-2.5">
                <span className="block text-[#94A3B8]">Other speaker</span>
                <span className="text-sm font-semibold text-[#F8FAFC]">{scenario.characterRole}</span>
              </div>

              <div className="rounded-lg border border-[#23303E] bg-[#0B1117] px-3.5 py-2.5">
                <span className="block text-[#94A3B8]">Estimated length</span>
                <span className="font-mono text-sm font-semibold text-[#F8FAFC]">~4 min</span>
              </div>
            </div>

            {/* Level 2–3 Twist Hint ONLY — never shown for Level 1 */}
            {showTwistHint && !knownTwist && (
              <p
                data-testid="roleplay-twist-hint"
                className="flex items-start gap-2 text-xs sm:text-sm text-[#CBD5E1] pt-1"
              >
                <AlertCircle className="w-4 h-4 text-[#D99B26] shrink-0 mt-0.5" />
                <span>{ROLEPLAY_TWIST_HINT}</span>
              </p>
            )}

            {/* Unlocked twist info ONLY when triggered via "Replay with the twist known" */}
            {knownTwist && (
              <div
                data-testid="roleplay-known-twist-banner"
                className="rounded-lg border border-[#7DD3FC]/40 bg-[#7DD3FC]/10 p-3.5 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[#7DD3FC]">Replaying with the twist known</span>
                  {onClearReplayTwist && (
                    <button
                      type="button"
                      onClick={onClearReplayTwist}
                      className="text-[11px] font-medium text-[#CBD5E1] underline hover:text-white"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <p className="text-[#E6EDF3]">
                  <span className="font-semibold text-[#F3C669]">Complication:</span> {knownTwist.complication}
                </p>
                <p className="text-[#E6EDF3]">
                  <span className="font-semibold text-[#7DD3FC]">Hidden goal:</span> {knownTwist.hiddenGoal}
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-[#94A3B8]">Select a level above to load an everyday scenario.</p>
        )}

        {/* Desktop Primary CTA */}
        <div className="hidden md:flex items-center justify-between gap-4 pt-4 border-t border-[#23303E]">
          <p className="text-xs text-[#94A3B8]">
            You speak first or reply right after their greeting. Audio stays on your device.
          </p>
          <button
            type="button"
            data-testid="roleplay-start-desktop"
            onClick={onStartCall}
            disabled={!scenario || isLoadingScenario || isStartingCall}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 min-h-[52px] rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <PhoneCall className="w-4 h-4" />
            <span>{isStartingCall ? 'Connecting…' : 'Start role-play'}</span>
          </button>
        </div>
      </section>

      {/* Mobile Sticky Thumb-Zone Primary CTA */}
      <div className="md:hidden fixed bottom-[60px] left-0 right-0 z-30 px-4 py-2.5 bg-[#0B1117]/95 backdrop-blur-md border-t border-[#23303E]">
        <button
          type="button"
          data-testid="roleplay-start-mobile"
          onClick={onStartCall}
          disabled={!scenario || isLoadingScenario || isStartingCall}
          className="w-full inline-flex items-center justify-center gap-2 min-h-[52px] px-5 rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] disabled:opacity-50 transition-colors"
        >
          <PhoneCall className="w-4 h-4" />
          <span>{isStartingCall ? 'Connecting…' : 'Start role-play'}</span>
        </button>
      </div>
    </div>
  );
};
