import React, {useEffect, useRef, useState} from 'react';
import {HelpCircle, Keyboard, Loader2, Mic, MicOff, PhoneOff, RotateCcw, Send, Volume2} from 'lucide-react';
import {getFunctionSpec, type IlrFunctionKey} from '../../data/ilrSpeakingLevels';
import type {MissionConfig, OpiCallMode, OpiMessage, OpiPhase, OpiProbeLevel, OpiWorkingLevel} from '../../types';
import {formatSecondsClock, getDialectInfo, LANGUAGE_LABELS} from '../../utils/ilrLogic';
import {buildWaveformBars, formatPhaseLabel} from '../../utils/opiLogic';
import type {SaveVocabFn, useWordLookup} from '../../hooks/useWordLookup';
import {TappableText} from '../shared/TappableText';
import {WordLookupPopover} from '../shared/WordLookupPopover';
import {TotRetrievalHelper} from './TotRetrievalHelper';

export interface RoleplaySituationReminder {
  situationEnglish: string;
  learnerGoal: string;
  register: string;
  characterRole: string;
}

interface OpiCallScreenProps {
  config: MissionConfig;
  mode: OpiCallMode;
  targetFunctionKey?: IlrFunctionKey;
  workingLevel: OpiWorkingLevel;
  probeLevel: OpiProbeLevel;
  elapsedSeconds: number;
  phase: OpiPhase;
  messages: OpiMessage[];
  isThinking: boolean;
  isExaminerSpeaking: boolean;
  isListening: boolean;
  isMuted: boolean;
  micLevel: number;
  sttSupported: boolean;
  sttError: string | null;
  apiError: string | null;
  draftResponse: string;
  wordLookup: ReturnType<typeof useWordLookup>;
  callTitle?: string;
  speakerLabel?: string;
  situationReminder?: RoleplaySituationReminder;
  onChangeDraft: (value: string) => void;
  onSendResponse: (overrideText?: string) => void;
  onToggleMute: () => void;
  onRepeatExaminer: () => void;
  onEndCall: () => void;
  onSpeakText: (text: string) => void;
  onSaveVocab: SaveVocabFn;
}

export const OpiCallScreen: React.FC<OpiCallScreenProps> = ({
  config,
  mode,
  targetFunctionKey,
  workingLevel,
  probeLevel,
  elapsedSeconds,
  phase,
  messages,
  isThinking,
  isExaminerSpeaking,
  isListening,
  isMuted,
  micLevel,
  sttSupported,
  sttError,
  apiError,
  draftResponse,
  wordLookup,
  callTitle,
  speakerLabel,
  situationReminder,
  onChangeDraft,
  onSendResponse,
  onToggleMute,
  onRepeatExaminer,
  onEndCall,
  onSpeakText,
  onSaveVocab,
}) => {
  const dialectInfo = getDialectInfo(config.language, config.dialect);
  const [hintOpen, setHintOpen] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(!sttSupported);
  const [waveTick, setWaveTick] = useState(0);
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null);

  const isRoleplayScreen = Boolean(situationReminder);
  const effectiveSpeakerLabel = speakerLabel || 'Examiner';
  const isWaveActive = !isMuted && (isExaminerSpeaking || isListening || isThinking);
  const targetFnSpec = targetFunctionKey ? getFunctionSpec(targetFunctionKey) : undefined;
  const activeStepLevel = phase === 'probe' || phase === 'roleplay' ? probeLevel : workingLevel;

  useEffect(() => {
    if (!isWaveActive) return;
    const id = window.setInterval(() => {
      setWaveTick((t) => (t + 1) % 1000);
    }, 90);
    return () => window.clearInterval(id);
  }, [isWaveActive]);

  useEffect(() => {
    if (mode !== 'practice') return;
    const el = transcriptContainerRef.current;
    if (!el) return;
    const rafId = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [mode, messages, isThinking]);

  const effectiveAudioLevel = isExaminerSpeaking
    ? 0.58 + 0.25 * Math.abs(Math.sin(waveTick * 0.35))
    : isListening && !isMuted
      ? Math.max(0.28, micLevel)
      : isThinking
        ? 0.22
        : 0;

  const waveformBars = buildWaveformBars(effectiveAudioLevel, isWaveActive, waveTick, 20);

  let statusLine = 'Connecting call…';
  if (isThinking) {
    statusLine = `${effectiveSpeakerLabel} thinking…`;
  } else if (isExaminerSpeaking) {
    statusLine = `${effectiveSpeakerLabel} speaking…`;
  } else if (isMuted) {
    statusLine = 'Microphone muted';
  } else if (mode === 'practice' && phase === 'wind_down' && messages.length > 0) {
    statusLine = isListening ? 'Listening to you… · Wrapping up' : 'Wrapping up the call…';
  } else if (isListening) {
    statusLine = 'Listening to you…';
  } else {
    statusLine = 'Your turn to answer';
  }

  const orbRingClass = isExaminerSpeaking
    ? 'border-[#D99B26] shadow-[0_0_48px_rgba(217,155,38,0.22)]'
    : isListening && !isMuted
      ? 'border-[#7DD3FC] shadow-[0_0_42px_rgba(125,211,252,0.18)]'
      : 'border-[#23303E]';

  const barColorClass = isExaminerSpeaking ? 'bg-[#D99B26]' : isListening && !isMuted ? 'bg-[#7DD3FC]' : 'bg-[#475569]';

  return (
    <div
      data-testid="opi-call-screen"
      data-call-mode={mode}
      className="fixed inset-0 z-50 bg-[#0B1117] text-[#E6EDF3] flex flex-col overflow-hidden"
    >
      {/* Top Call Bar: Exam keeps phase/level hidden; Practice surfaces current phase & hint button cleanly without truncation */}
      <header className="px-4 sm:px-6 py-2.5 min-h-[60px] flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-[#1D2835] bg-[#0B1117]/95 shrink-0">
        <p className="min-w-0 text-xs sm:text-sm font-medium text-[#CBD5E1] truncate">
          {callTitle ?? (mode === 'exam' ? 'OPI Exam Call' : 'OPI Practice Call')} · {LANGUAGE_LABELS[config.language]}{' '}
          ({dialectInfo.short})
        </p>

        <div className="flex items-center gap-2 shrink-0">
          {mode === 'practice' && (
            <button
              type="button"
              data-testid="opi-hint-toggle"
              onClick={() => setHintOpen((o) => !o)}
              className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                hintOpen
                  ? 'border-[#D99B26] bg-[#D99B26]/15 text-[#F3C669]'
                  : 'border-[#23303E] bg-[#111922] text-[#CBD5E1] hover:text-white'
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5 text-[#D99B26]" />
              <span>Stuck? Hold for a hint</span>
            </button>
          )}

          <span
            data-testid="opi-elapsed-timer"
            aria-label="Elapsed call time"
            className="inline-flex items-center justify-center min-h-[40px] px-3 rounded-lg border border-[#23303E] bg-[#111922] font-mono text-sm font-semibold text-[#F8FAFC] tabular-nums"
          >
            {formatSecondsClock(elapsedSeconds)}
          </span>
        </div>

        {mode === 'practice' && !isRoleplayScreen && (
          <p data-testid="opi-practice-phase" className="w-full text-[11px] font-medium text-[#7DD3FC]">
            Phase: {formatPhaseLabel(phase)} · Level {activeStepLevel}
            {targetFnSpec ? ` · ${targetFnSpec.label}` : ''}
          </p>
        )}

        {situationReminder && (
          <div
            data-testid="roleplay-call-reminder"
            className="w-full rounded-lg border border-[#D99B26]/40 bg-[#111922] px-3 py-2 text-xs text-[#CBD5E1] space-y-0.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="font-semibold text-[#F3C669]">Speaking with: {situationReminder.characterRole}</span>
              <span className="font-mono text-[#7DD3FC]">Register: {situationReminder.register}</span>
            </div>
            <p className="text-xs text-[#E6EDF3] leading-snug">{situationReminder.learnerGoal}</p>
          </div>
        )}
      </header>

      {/* Main Call Stage */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-3 sm:py-4 flex flex-col">
        <div className="w-full max-w-2xl mx-auto flex-1 flex flex-col justify-between gap-3 sm:gap-4">
          {apiError && (
            <div
              role="alert"
              className="rounded-lg border border-[#F87171]/40 bg-red-950/30 px-4 py-2.5 text-xs sm:text-sm text-red-200"
            >
              {apiError}
            </div>
          )}

          {/* Practice-Only 5-Second Hint Drawer */}
          {mode === 'practice' && hintOpen && (
            <div data-testid="opi-practice-hint-drawer">
              <TotRetrievalHelper
                config={config}
                onSaveVocab={onSaveVocab}
                onSpeak={onSpeakText}
                onClose={() => setHintOpen(false)}
              />
            </div>
          )}

          {/* Central Examiner Orb + Live Waveform + Status Line */}
          <div
            className={`flex flex-col items-center justify-center text-center ${
              mode === 'exam' ? 'flex-1 py-8' : hintOpen ? 'py-1' : 'py-2.5'
            }`}
          >
            <div
              data-testid="examiner-orb"
              className={`relative rounded-full border-2 bg-[#111922] flex items-center justify-center transition-all duration-300 ${orbRingClass} ${
                mode === 'exam'
                  ? 'w-44 h-44 sm:w-52 sm:h-52'
                  : hintOpen
                    ? 'w-20 h-20 sm:w-28 sm:h-28'
                    : 'w-28 h-28 sm:w-32 sm:h-32'
              }`}
            >
              <div aria-hidden="true" className="flex items-center justify-center gap-[3px] h-14 px-4">
                {waveformBars.slice(0, mode === 'exam' ? 20 : 14).map((bar, idx) => (
                  <span
                    key={idx}
                    className={`w-[3px] rounded-full transition-all duration-100 ${barColorClass}`}
                    style={{height: `${Math.round(bar * (mode === 'exam' ? 56 : 38))}px`}}
                  />
                ))}
              </div>
            </div>

            <div className="mt-5 space-y-1.5">
              <p
                data-testid="call-status-line"
                aria-live="polite"
                className="font-display text-lg sm:text-xl font-semibold text-[#F8FAFC]"
              >
                {statusLine}
              </p>
              <p className="text-xs text-[#94A3B8]">
                {mode === 'exam'
                  ? 'Phone-call conditions · Speak naturally when ready'
                  : 'Tap any examiner word below to look up or save to Vocab'}
              </p>
            </div>

            {/* Subtle turn submission bar when user has spoken/typed draft or toggled keyboard */}
            {(draftResponse.trim() || showKeyboard) && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  onSendResponse();
                }}
                className="mt-5 w-full max-w-lg flex items-center gap-2"
              >
                <label htmlFor="opi-call-response-input" className="sr-only">
                  Your spoken or typed response
                </label>
                <input
                  id="opi-call-response-input"
                  type="text"
                  value={draftResponse}
                  onChange={(e) => onChangeDraft(e.target.value)}
                  placeholder={`Respond in ${LANGUAGE_LABELS[config.language]}…`}
                  className="flex-1 min-h-[48px] rounded-xl border border-[#23303E] bg-[#111922] px-4 py-2 text-sm text-[#E6EDF3] placeholder:text-[#64748B] focus:outline-none focus:border-[#D99B26]"
                />
                <button
                  type="submit"
                  disabled={!draftResponse.trim() || isThinking}
                  aria-label="Send response"
                  className="min-h-[48px] min-w-[48px] px-4 rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] disabled:opacity-40 transition-colors inline-flex items-center justify-center gap-1.5 shrink-0"
                >
                  <Send className="w-4 h-4" />
                  <span className="hidden sm:inline">Send</span>
                </button>
              </form>
            )}

            {sttError && <p className="mt-2 text-xs text-amber-300 max-w-md">{sttError}</p>}
          </div>

          {/* Practice-Only Live Interactive Transcript (Strictly omitted in Exam mode) */}
          {mode === 'practice' && (
            <section
              data-testid="opi-practice-transcript"
              aria-label="Live practice transcript"
              className="rounded-xl border border-[#23303E] bg-[#111922] flex flex-col flex-1 min-h-[168px] max-h-[340px]"
            >
              <div className="px-4 py-2.5 border-b border-[#23303E] flex items-center justify-between text-xs text-[#94A3B8]">
                <span>Live Transcript · Tap any examiner word to save</span>
                <span className="font-mono tabular-nums text-[#7D8FA3]">{messages.length} turns</span>
              </div>

              <div ref={transcriptContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg) => {
                  const isExaminer = msg.role === 'examiner';
                  return (
                    <div key={msg.id} className={`flex flex-col ${isExaminer ? 'items-start' : 'items-end'}`}>
                      <div className="flex items-center gap-2 text-xs text-[#7D8FA3] mb-1 px-1">
                        <span className="font-medium text-[#CBD5E1]">{isExaminer ? 'Examiner' : 'You'}</span>
                        {typeof msg.elapsedSeconds === 'number' && (
                          <span className="font-mono tabular-nums">{formatSecondsClock(msg.elapsedSeconds)}</span>
                        )}
                        {isExaminer && (
                          <button
                            type="button"
                            onClick={() => onSpeakText(msg.text)}
                            aria-label="Replay examiner turn"
                            className="inline-flex items-center justify-center min-h-[32px] min-w-[32px] text-[#94A3B8] hover:text-[#F3C669]"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div
                        className={`max-w-[92%] sm:max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                          isExaminer
                            ? 'bg-[#16202B] border border-[#253545] text-[#F1F5F9]'
                            : 'bg-[#1D2835] border border-[#2E4054] text-[#E6EDF3]'
                        }`}
                      >
                        {isExaminer ? (
                          <TappableText
                            text={msg.text}
                            activeWord={wordLookup.lookup?.messageId === msg.id ? wordLookup.lookup.word : undefined}
                            onWordTap={(word) => wordLookup.lookUpWord(msg.id, word, msg.text)}
                          />
                        ) : (
                          <p>{msg.text}</p>
                        )}
                      </div>

                      {isExaminer && wordLookup.lookup?.messageId === msg.id && (
                        <WordLookupPopover
                          lookup={wordLookup.lookup}
                          onClose={wordLookup.close}
                          onRetry={wordLookup.retry}
                          onSave={wordLookup.save}
                          loadingLabel="Looking up contextual register…"
                        />
                      )}
                    </div>
                  );
                })}

                {isThinking && (
                  <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D99B26]" />
                    <span>Examiner speaking next…</span>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Bottom Call Control Dock: 3 Round Buttons (Mute, End call, Repeat) + Optional Keyboard Fallback */}
      <footer className="px-4 sm:px-6 pt-4 pb-6 pb-safe border-t border-[#1D2835] bg-[#0D141C]/95 shrink-0">
        <div className="max-w-md mx-auto flex items-center justify-around gap-4">
          {/* 1. Mute */}
          <div className="flex flex-col items-center gap-1.5">
            <button
              type="button"
              data-testid="call-btn-mute"
              onClick={onToggleMute}
              aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
              aria-pressed={isMuted}
              className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full border flex items-center justify-center transition-colors ${
                isMuted
                  ? 'border-[#D99B26] bg-[#D99B26]/20 text-[#F3C669]'
                  : 'border-[#2E4054] bg-[#16202B] text-[#F8FAFC] hover:bg-[#1E2C3A]'
              }`}
            >
              {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>
            <span className="text-xs font-medium text-[#CBD5E1]">{isMuted ? 'Muted' : 'Mute'}</span>
          </div>

          {/* 2. End Call (Red) */}
          <div className="flex flex-col items-center gap-1.5">
            <button
              type="button"
              data-testid="call-btn-end"
              onClick={onEndCall}
              aria-label="End call"
              className="w-16 h-16 sm:w-[70px] sm:h-[70px] rounded-full bg-[#DC2626] hover:bg-[#EF4444] text-white flex items-center justify-center shadow-lg shadow-red-950/50 transition-colors"
            >
              <PhoneOff className="w-6 h-6 sm:w-7 sm:h-7" />
            </button>
            <span className="text-xs font-semibold text-[#F87171]">End call</span>
          </div>

          {/* 3. Repeat */}
          <div className="flex flex-col items-center gap-1.5">
            <button
              type="button"
              data-testid="call-btn-repeat"
              onClick={onRepeatExaminer}
              disabled={isThinking || messages.length === 0}
              aria-label="Ask examiner to repeat"
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-full border border-[#2E4054] bg-[#16202B] text-[#F8FAFC] hover:bg-[#1E2C3A] disabled:opacity-40 flex items-center justify-center transition-colors"
            >
              <RotateCcw className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
            <span className="text-xs font-medium text-[#CBD5E1]">Repeat</span>
          </div>
        </div>

        {/* Unobtrusive keyboard toggle if user wants to type without mic */}
        {sttSupported && (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={() => setShowKeyboard((s) => !s)}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg text-xs text-[#94A3B8] hover:text-[#E6EDF3] transition-colors"
            >
              <Keyboard className="w-3.5 h-3.5" />
              <span>{showKeyboard ? 'Hide keyboard input' : 'Type answer instead'}</span>
            </button>
          </div>
        )}
      </footer>
    </div>
  );
};
