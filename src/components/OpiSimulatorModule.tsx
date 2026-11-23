import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  Clock,
  FileBarChart2,
  HelpCircle,
  Loader2,
  Mic,
  MicOff,
  Play,
  RotateCcw,
  Send,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {MissionConfig, OpiMessage, OpiSession, ProbeLevel, VocabItem} from '../types';
import {
  determineProbeLevel,
  formatSecondsClock,
  getDialectInfo,
  getDomainInfo,
  LANGUAGE_LABELS,
} from '../utils/ilrLogic';
import {requestOpiTurn} from '../services/api';
import {useSpeechRecognition, useSpeechSynthesis} from '../hooks/useSpeech';
import {type SaveVocabFn, useWordLookup} from '../hooks/useWordLookup';
import {createId} from '../utils/ids';
import {TappableText} from './shared/TappableText';
import {WordLookupPopover} from './shared/WordLookupPopover';
import {TotRetrievalHelper} from './opi/TotRetrievalHelper';

interface OpiSimulatorModuleProps {
  config: MissionConfig;
  vocabItems: VocabItem[];
  onUpdateConfig: (patch: Partial<MissionConfig>) => void;
  onSaveVocab: SaveVocabFn;
  onCompleteSession: (session: OpiSession) => void;
}

export const OpiSimulatorModule: React.FC<OpiSimulatorModuleProps> = ({
  config,
  vocabItems,
  onUpdateConfig,
  onSaveVocab,
  onCompleteSession,
}) => {
  const dialectInfo = getDialectInfo(config.language, config.dialect);
  const domainInfo = getDomainInfo(config.domain);

  const [messages, setMessages] = useState<OpiMessage[]>([]);
  const [probeLevel, setProbeLevel] = useState<ProbeLevel>('level_2_baseline');
  const [probeReason, setProbeReason] = useState<string>('Level 2 concrete baseline warm-up (first 2 minutes).');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  // Wall-clock start of the running session (null when stopped); every (re)start sets a new value.
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [inputText, setInputText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [totOpen, setTotOpen] = useState(false);
  const wordLookup = useWordLookup({config, vocabItems, onSaveVocab});

  const transcriptContainerRef = useRef<HTMLDivElement | null>(null);
  const tts = useSpeechSynthesis();
  const stt = useSpeechRecognition();

  // Session elapsed timer, derived from the wall clock so background-tab throttling can't slow it.
  useEffect(() => {
    if (sessionStartedAt === null) return;
    const id = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - sessionStartedAt) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [sessionStartedAt]);

  // Auto-scroll only the internal transcript pane when messages exist
  useEffect(() => {
    const el = transcriptContainerRef.current;
    if (!el) return;
    if (messages.length === 0 && !isThinking) return;
    const rafId = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [messages, isThinking]);

  // Sync live speech recognition transcript into inputText
  useEffect(() => {
    if (stt.finalTranscript || stt.interimTranscript) {
      setInputText(`${stt.finalTranscript} ${stt.interimTranscript}`.trim());
    }
  }, [stt.finalTranscript, stt.interimTranscript]);

  const candidateTurns = useMemo(() => messages.filter((m) => m.role === 'candidate').length, [messages]);

  const speakIfEnabled = (text: string) => {
    if (!config.autoSpeakExaminer) return;
    tts.speak(text, {
      lang: dialectInfo.bcp47,
      rate: config.speechRate,
      voiceURI: config.voiceURI,
      onEnd: () => {
        if (config.handsFreeMode && stt.supported) {
          stt.resetTranscript();
          stt.startListening({lang: dialectInfo.bcp47, continuous: false});
        }
      },
    });
  };

  const handleStartOpi = async () => {
    tts.stop();
    stt.stopListening();
    stt.resetTranscript();
    setMessages([]);
    setElapsedSeconds(0);
    setSessionStartedAt(Date.now());
    setProbeLevel('level_2_baseline');
    setProbeReason('Opening Level 2 concrete baseline warm-up (first 2 minutes).');
    setApiError(null);
    wordLookup.close();
    setIsThinking(true);

    try {
      const turn = await requestOpiTurn({
        language: config.language,
        dialect: dialectInfo.id,
        domain: domainInfo.id,
        probeLevel: 'level_2_baseline',
        elapsedSeconds: 0,
        history: [],
        isOpening: true,
      });

      const openingMsg: OpiMessage = {
        id: createId('opi-ex'),
        role: 'examiner',
        text: turn.examinerText,
        timestamp: new Date().toISOString(),
        probeLevel: turn.probeLevel,
        probeReason: turn.probeReason,
      };
      setMessages([openingMsg]);
      setProbeLevel(turn.probeLevel);
      setProbeReason(turn.probeReason);
      speakIfEnabled(turn.examinerText);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Unable to start OPI interview.');
      setSessionStartedAt(null);
    } finally {
      setIsThinking(false);
    }
  };

  const handleSendResponse = async (overrideText?: string) => {
    const cleanText = (overrideText ?? inputText).trim();
    if (!cleanText || isThinking) return;

    stt.stopListening();
    stt.resetTranscript();
    tts.stop();
    setInputText('');
    setApiError(null);
    // Resume the clock from where it stopped if the session had been ended.
    if (sessionStartedAt === null) setSessionStartedAt(Date.now() - elapsedSeconds * 1000);

    const candidateMsg: OpiMessage = {
      id: createId('opi-cand'),
      role: 'candidate',
      text: cleanText,
      timestamp: new Date().toISOString(),
      probeLevel,
    };

    const nextMessages = [...messages, candidateMsg];
    setMessages(nextMessages);

    const nextCandidateCount = candidateTurns + 1;
    const probeDecision = determineProbeLevel({
      elapsedSeconds,
      candidateTurnCount: nextCandidateCount,
      lastCandidateText: cleanText,
    });

    setIsThinking(true);
    try {
      const turn = await requestOpiTurn({
        language: config.language,
        dialect: dialectInfo.id,
        domain: domainInfo.id,
        probeLevel: probeDecision.level,
        elapsedSeconds,
        history: nextMessages.map((m) => ({role: m.role, text: m.text})),
        userMessage: cleanText,
      });

      const examinerMsg: OpiMessage = {
        id: createId('opi-ex'),
        role: 'examiner',
        text: turn.examinerText,
        timestamp: new Date().toISOString(),
        probeLevel: turn.probeLevel,
        probeReason: turn.probeReason,
      };
      setMessages((prev) => [...prev, examinerMsg]);
      setProbeLevel(turn.probeLevel);
      setProbeReason(turn.probeReason || probeDecision.reason);
      speakIfEnabled(turn.examinerText);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Examiner turn failed.');
    } finally {
      setIsThinking(false);
    }
  };

  const handleToggleMic = () => {
    if (stt.isListening) {
      stt.stopListening();
    } else {
      tts.stop();
      stt.resetTranscript();
      stt.startListening({
        lang: dialectInfo.bcp47,
        continuous: true,
      });
    }
  };

  const handleEndAndDebrief = () => {
    tts.stop();
    stt.stopListening();
    setSessionStartedAt(null);
    const session: OpiSession = {
      id: createId('opi'),
      type: 'opi',
      language: config.language,
      dialect: config.dialect,
      domain: config.domain,
      startedAt: new Date().toISOString(),
      durationSeconds: Math.max(elapsedSeconds, messages.length * 25),
      messages,
    };
    onCompleteSession(session);
  };

  return (
    <div className="space-y-5">
      {/* Header + Probe Level Indicator */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-4 border-b border-[#23303E]">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#94A3B8]">
            <span>ILR OPI Examiner</span>
            <span aria-hidden="true">·</span>
            <span>
              {LANGUAGE_LABELS[config.language]} ({dialectInfo.short})
            </span>
            <span aria-hidden="true">·</span>
            <span>{domainInfo.shortLabel}</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#F8FAFC]">
              Live Voice OPI Simulator
            </h1>
            <span
              data-testid="probe-level-badge"
              className={`text-xs font-medium whitespace-nowrap ${
                probeLevel === 'level_3_probe' ? 'text-sky-300' : 'text-amber-300'
              }`}
            >
              Current Probe Level: {probeLevel === 'level_3_probe' ? 'Level 3 Probe' : 'Level 2 Baseline'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#23303E] bg-[#111922] font-mono text-sm text-[#E6EDF3] tabular-nums">
            <Clock className="w-3.5 h-3.5 text-[#94A3B8]" />
            {formatSecondsClock(elapsedSeconds)}
          </span>

          <button
            type="button"
            onClick={() => onUpdateConfig({autoSpeakExaminer: !config.autoSpeakExaminer})}
            className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg border border-[#23303E] bg-[#111922] text-xs font-medium text-[#CBD5E1] hover:text-white transition-colors whitespace-nowrap"
          >
            {config.autoSpeakExaminer ? (
              <Volume2 className="w-3.5 h-3.5 text-[#D99B26]" />
            ) : (
              <VolumeX className="w-3.5 h-3.5 text-[#64748B]" />
            )}
            <span>{config.autoSpeakExaminer ? 'Voice On' : 'Voice Muted'}</span>
          </button>

          <button
            type="button"
            onClick={() => setTotOpen((o) => !o)}
            className={`flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
              totOpen
                ? 'border-[#D99B26]/60 bg-[#D99B26]/15 text-[#F3C669]'
                : 'border-[#23303E] bg-[#111922] text-[#CBD5E1] hover:text-white'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>How do I say…? (5s TOT)</span>
          </button>

          {candidateTurns > 0 ? (
            <button
              type="button"
              onClick={handleEndAndDebrief}
              className="flex items-center gap-1.5 px-4 py-2 min-h-[40px] rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] transition-colors whitespace-nowrap"
            >
              <FileBarChart2 className="w-4 h-4" />
              <span>End &amp; Run ILR Debrief</span>
            </button>
          ) : messages.length > 0 ? (
            <button
              type="button"
              onClick={handleStartOpi}
              disabled={isThinking}
              className="flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-lg border border-[#2E4054] bg-[#16202B] text-xs font-medium text-[#E6EDF3] hover:bg-[#1E2C3A] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restart Interview</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Tip-of-the-Tongue 5-Second Active Retrieval Drawer (kept mounted so closing preserves its state) */}
      <div hidden={!totOpen}>
        <TotRetrievalHelper
          config={config}
          onSaveVocab={onSaveVocab}
          onSpeak={(text) =>
            tts.speak(text, {lang: dialectInfo.bcp47, rate: config.speechRate, voiceURI: config.voiceURI})
          }
          onClose={() => setTotOpen(false)}
        />
      </div>

      {apiError && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {apiError}
        </div>
      )}

      {/* Main Split: Transcript Stage + Examiner Probe Guidance */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Transcript Feed (8 cols) */}
        <div className="lg:col-span-8 rounded-xl border border-[#23303E] bg-[#111922] flex flex-col min-h-[460px] max-h-[640px]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#23303E] text-xs text-[#94A3B8]">
            <span>Interactive Transcript — Tap any examiner word for contextual meaning &amp; 1-tap vault save</span>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={handleStartOpi}
                className="inline-flex items-center gap-1 text-[#94A3B8] hover:text-white whitespace-nowrap ml-2"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            )}
          </div>

          <div ref={transcriptContainerRef} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-14 px-4 space-y-4">
                <div className="space-y-1.5 max-w-md">
                  <h2 className="text-lg font-semibold text-[#F8FAFC]">
                    Ready for {LANGUAGE_LABELS[config.language]} OPI Simulation
                  </h2>
                  <p className="text-sm text-[#94A3B8] leading-relaxed">
                    The examiner starts with a 2-minute Level 2 baseline on{' '}
                    <span className="text-[#E6EDF3]">{domainInfo.label}</span>, then probes into Level 3 abstract policy
                    and counterfactual subjunctive scenarios.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleStartOpi}
                  disabled={isThinking}
                  className="flex items-center gap-2 px-5 py-3 min-h-[46px] rounded-lg bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
                >
                  <Play className="w-4 h-4" />
                  <span>Begin Live OPI Session</span>
                </button>
              </div>
            ) : (
              messages.map((msg) => {
                const isExaminer = msg.role === 'examiner';
                return (
                  <div key={msg.id} className={`flex flex-col ${isExaminer ? 'items-start' : 'items-end'}`}>
                    <div className="flex items-center gap-2 text-xs text-[#7D8FA3] mb-1.5 px-1">
                      <span className="font-medium text-[#CBD5E1]">{isExaminer ? 'ILR Examiner' : 'You'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{msg.probeLevel === 'level_3_probe' ? 'Level 3 Probe' : 'Level 2 Baseline'}</span>
                      {isExaminer && (
                        <button
                          type="button"
                          onClick={() =>
                            tts.speak(msg.text, {
                              lang: dialectInfo.bcp47,
                              rate: config.speechRate,
                              voiceURI: config.voiceURI,
                            })
                          }
                          aria-label="Replay examiner message"
                          className="ml-1 inline-flex items-center gap-1 text-[#94A3B8] hover:text-[#F3C669]"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div
                      className={`max-w-[92%] sm:max-w-[85%] rounded-xl px-4 py-3 text-sm sm:text-[15px] leading-relaxed ${
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

                    {/* Compact Tap-to-Save Contextual Popover directly under tapped message */}
                    {isExaminer && wordLookup.lookup?.messageId === msg.id && (
                      <WordLookupPopover
                        lookup={wordLookup.lookup}
                        onClose={wordLookup.close}
                        onRetry={wordLookup.retry}
                        onSave={wordLookup.save}
                        loadingLabel="Analyzing contextual register…"
                      />
                    )}
                  </div>
                );
              })
            )}

            {isThinking && (
              <div className="flex items-center gap-2 text-xs text-[#94A3B8] px-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D99B26]" />
                <span>Examiner formulating next probe…</span>
              </div>
            )}
          </div>

          {/* Voice + Keyboard Input Dock */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendResponse();
            }}
            className="p-3.5 border-t border-[#23303E] bg-[#0D141C] rounded-b-xl space-y-2"
          >
            {stt.isListening && (
              <div className="flex items-center justify-between text-xs text-red-400 px-1">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
                  Listening in {dialectInfo.label}…
                </span>
                <span>Tap mic again when finished speaking</span>
              </div>
            )}
            {stt.error && <p className="text-xs text-amber-300 px-1">{stt.error}</p>}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleMic}
                aria-label={stt.isListening ? 'Stop voice dictation' : 'Start voice dictation'}
                className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border transition-colors shrink-0 ${
                  stt.isListening
                    ? 'border-red-500 bg-red-600 text-white'
                    : 'border-[#2E4054] bg-[#16202B] text-[#E6EDF3] hover:bg-[#1E2C3A]'
                }`}
              >
                {stt.isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>

              <label htmlFor="opi-response-input" className="sr-only">
                Your OPI spoken or typed response
              </label>
              <input
                id="opi-response-input"
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={`Speak with mic or type your ${LANGUAGE_LABELS[config.language]} response…`}
                className="flex-1 min-h-[44px] rounded-lg border border-[#23303E] bg-[#111922] px-3.5 py-2 text-sm text-[#E6EDF3] placeholder:text-[#64748B] focus:outline-none focus:border-[#D99B26]"
              />

              <button
                type="submit"
                disabled={!inputText.trim() || isThinking}
                aria-label="Send OPI response"
                className="min-h-[44px] px-4 rounded-lg bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] disabled:opacity-40 transition-colors flex items-center gap-1.5 shrink-0"
              >
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline">Send</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right 4 cols: Tactical Examiner State & Hands-Free Controls */}
        <aside className="lg:col-span-4 rounded-xl border border-[#23303E] bg-[#111922] p-5 space-y-5">
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold text-[#F8FAFC]">Examiner Probing Protocol</h2>
            <p className="text-xs text-[#94A3B8] leading-relaxed">{probeReason}</p>
          </div>

          <div className="grid grid-cols-2 gap-4 py-4 border-y border-[#23303E]">
            <div>
              <p className="text-xs text-[#7D8FA3]">Probe Stage</p>
              <p
                className={`mt-1 text-sm font-semibold ${
                  probeLevel === 'level_3_probe' ? 'text-sky-300' : 'text-amber-300'
                }`}
              >
                {probeLevel === 'level_3_probe' ? 'ILR 3 Abstract' : 'ILR 2 Baseline'}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#7D8FA3]">Your Turns</p>
              <p className="mt-1 font-mono text-sm font-semibold text-[#F8FAFC] tabular-nums">{candidateTurns}</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <label htmlFor="opi-hands-free" className="text-sm font-medium text-[#E6EDF3] cursor-pointer">
                  Hands-Free Auto-Listen
                </label>
                <p id="opi-hands-free-desc" className="text-xs text-[#94A3B8]">
                  Automatically open microphone right after the examiner finishes speaking.
                </p>
              </div>
              <input
                id="opi-hands-free"
                type="checkbox"
                aria-describedby="opi-hands-free-desc"
                checked={config.handsFreeMode}
                onChange={(e) => onUpdateConfig({handsFreeMode: e.target.checked})}
                className="mt-1 h-4 w-4 accent-[#D99B26] cursor-pointer"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-[#23303E] space-y-2">
            <h3 className="text-xs font-semibold text-[#CBD5E1]">Level 2+ / 3 Checklist</h3>
            <ul className="space-y-1.5 text-xs text-[#94A3B8] leading-relaxed">
              <li>• Lead with a clear thesis before giving operational examples.</li>
              <li>
                • Trigger imperfect subjunctive on hypotheticals (
                {config.language === 'es' ? 'si se redujera…' : 'caso houvesse…'}).
              </li>
              <li>
                • Use formal pivots (
                {config.language === 'es' ? 'no obstante, por consiguiente' : 'todavia, em contrapartida'}).
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
};
