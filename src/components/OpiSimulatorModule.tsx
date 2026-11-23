import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  BookmarkPlus,
  Check,
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
  X,
} from 'lucide-react';
import type {MissionConfig, OpiMessage, OpiSession, ProbeLevel, VocabCategory, VocabItem} from '../types';
import {
  determineProbeLevel,
  formatSecondsClock,
  getDialectInfo,
  getDomainInfo,
  LANGUAGE_LABELS,
  tokenizeTranscript,
} from '../utils/ilrLogic';
import {
  type EnrichedTotResult,
  type EnrichedWordLookup,
  incrementApiSavedCount,
  lookupLocalWord,
  type LookupSource,
} from '../utils/localDictionary';
import {lookupContextualWord, requestOpiTurn, requestTotPhrase} from '../services/api';
import {useSpeechRecognition, useSpeechSynthesis} from '../hooks/useSpeech';
import {createId} from '../utils/ids';

interface OpiSimulatorModuleProps {
  config: MissionConfig;
  vocabItems: VocabItem[];
  onUpdateConfig: (patch: Partial<MissionConfig>) => void;
  onSaveVocab: (item: Omit<VocabItem, 'id' | 'createdAt' | 'mastery' | 'reviewCount'>) => void;
  onCompleteSession: (session: OpiSession) => void;
}

interface ActivePopoverState {
  messageId: string;
  word: string;
  contextSentence: string;
  loading: boolean;
  result?: EnrichedWordLookup;
  error?: string;
  saved?: boolean;
}

const OPI_SOURCE_LABELS: Record<LookupSource, string> = {
  vault: 'In Vault · Offline',
  military_dict: 'Military Dict · Offline',
  dictionary: 'Local Dict · Offline',
  cache: 'Cached · Offline',
  ai: 'AI Context · Cached',
};

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
  const [sessionActive, setSessionActive] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Tap-to-save popover state
  const [wordPopover, setWordPopover] = useState<ActivePopoverState | null>(null);

  // 5-Second Tip-of-the-Tongue Helper state
  const [totOpen, setTotOpen] = useState(false);
  const [totQuery, setTotQuery] = useState('');
  const [totCountdown, setTotCountdown] = useState<number>(0);
  const [totLoading, setTotLoading] = useState(false);
  const [totPendingResult, setTotPendingResult] = useState<EnrichedTotResult | null>(null);
  const [totRevealed, setTotRevealed] = useState<EnrichedTotResult | null>(null);
  const [totError, setTotError] = useState<string | null>(null);
  const [totSaved, setTotSaved] = useState(false);

  const transcriptContainerRef = useRef<HTMLDivElement | null>(null);
  const wordPopoverRef = useRef<HTMLDivElement | null>(null);
  const currentLanguageRef = useRef(config.language);
  currentLanguageRef.current = config.language;
  const prevLangRef = useRef(config.language);
  const tts = useSpeechSynthesis();
  const stt = useSpeechRecognition();

  // Reset OPI transcript and active state completely when switching target language
  useEffect(() => {
    if (prevLangRef.current !== config.language) {
      prevLangRef.current = config.language;
      tts.stop();
      stt.stopListening();
      stt.resetTranscript();
      setMessages([]);
      setSessionActive(false);
      setElapsedSeconds(0);
      setProbeLevel('level_2_baseline');
      setProbeReason('Level 2 concrete baseline warm-up (first 2 minutes).');
      setInputText('');
      setIsThinking(false);
      setApiError(null);
      setWordPopover(null);
      setTotOpen(false);
      setTotQuery('');
      setTotCountdown(0);
      setTotLoading(false);
      setTotPendingResult(null);
      setTotRevealed(null);
      setTotError(null);
      setTotSaved(false);
    }
  }, [config.language, tts, stt]);

  // Session elapsed timer
  useEffect(() => {
    if (!sessionActive) return;
    const id = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [sessionActive]);

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

  // Keep newly opened word lookup popover fully visible inside the OPI transcript pane
  useEffect(() => {
    if (!wordPopover) return;
    const rafId = window.requestAnimationFrame(() => {
      wordPopoverRef.current?.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [wordPopover?.messageId, wordPopover?.word, wordPopover?.loading]);

  // Sync live speech recognition transcript into inputText
  useEffect(() => {
    if (stt.finalTranscript || stt.interimTranscript) {
      setInputText(`${stt.finalTranscript} ${stt.interimTranscript}`.trim());
    }
  }, [stt.finalTranscript, stt.interimTranscript]);

  // 5-Second Tip-of-the-Tongue active retrieval countdown
  useEffect(() => {
    if (totCountdown <= 0) return;
    const timer = window.setTimeout(() => {
      const next = totCountdown - 1;
      setTotCountdown(next);
      if (next === 0 && totPendingResult) {
        setTotRevealed(totPendingResult);
        setTotPendingResult(null);
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [totCountdown, totPendingResult]);

  // If API arrives after countdown already reached 0, reveal immediately
  useEffect(() => {
    if (totCountdown === 0 && totPendingResult && !totRevealed) {
      setTotRevealed(totPendingResult);
      setTotPendingResult(null);
    }
  }, [totCountdown, totPendingResult, totRevealed]);

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
    setProbeLevel('level_2_baseline');
    setProbeReason('Opening Level 2 concrete baseline warm-up (first 2 minutes).');
    setSessionActive(true);
    setApiError(null);
    setWordPopover(null);
    setIsThinking(true);

    const requestLang = config.language;
    try {
      const turn = await requestOpiTurn({
        language: requestLang,
        dialect: dialectInfo.id,
        domain: domainInfo.id,
        probeLevel: 'level_2_baseline',
        elapsedSeconds: 0,
        history: [],
        isOpening: true,
      });
      if (currentLanguageRef.current !== requestLang) return;

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
      if (currentLanguageRef.current !== requestLang) return;
      setApiError(err instanceof Error ? err.message : 'Unable to start OPI interview.');
      setSessionActive(false);
    } finally {
      if (currentLanguageRef.current === requestLang) {
        setIsThinking(false);
      }
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
    if (!sessionActive) setSessionActive(true);

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

    const requestLang = config.language;
    setIsThinking(true);
    try {
      const turn = await requestOpiTurn({
        language: requestLang,
        dialect: dialectInfo.id,
        domain: domainInfo.id,
        probeLevel: probeDecision.level,
        elapsedSeconds,
        history: nextMessages.map((m) => ({role: m.role, text: m.text})),
        userMessage: cleanText,
      });
      if (currentLanguageRef.current !== requestLang) return;

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
      if (currentLanguageRef.current !== requestLang) return;
      setApiError(err instanceof Error ? err.message : 'Examiner turn failed.');
    } finally {
      if (currentLanguageRef.current === requestLang) {
        setIsThinking(false);
      }
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

  const handleWordClick = async (messageId: string, cleanWord: string, contextSentence: string, forceAi = false) => {
    if (!cleanWord) return;
    const requestLang = config.language;

    // Instant synchronous resolution from Vault, Offline Military Dict, Core Dict, or localStorage LRU cache
    if (!forceAi) {
      const localHit = lookupLocalWord(requestLang, cleanWord, vocabItems);
      if (localHit) {
        incrementApiSavedCount();
        setWordPopover({
          messageId,
          word: cleanWord,
          contextSentence,
          loading: false,
          result: localHit,
          saved: localHit.source === 'vault',
        });
        return;
      }
    }

    setWordPopover({
      messageId,
      word: cleanWord,
      contextSentence,
      loading: true,
    });

    try {
      const result = await lookupContextualWord({
        language: requestLang,
        dialect: dialectInfo.id,
        word: cleanWord,
        contextSentence,
        vocabItems,
        forceAi,
      });
      if (currentLanguageRef.current !== requestLang) return;
      setWordPopover({
        messageId,
        word: cleanWord,
        contextSentence,
        loading: false,
        result,
        saved: false,
      });
    } catch (err) {
      if (currentLanguageRef.current !== requestLang) return;
      setWordPopover({
        messageId,
        word: cleanWord,
        contextSentence,
        loading: false,
        error: err instanceof Error ? err.message : 'Lookup failed.',
      });
    }
  };

  const handleSavePopoverWord = () => {
    if (!wordPopover?.result) return;
    onSaveVocab({
      term: wordPopover.word,
      englishConcept: wordPopover.result.contextualMeaning,
      contextSentence: wordPopover.contextSentence,
      registerTag: wordPopover.result.registerTag,
      category: wordPopover.result.suggestedCategory as VocabCategory,
      language: config.language,
      dialect: config.dialect,
      domain: config.domain,
    });
    setWordPopover((prev) => (prev ? {...prev, saved: true} : null));
  };

  const handleStartTot = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = totQuery.trim();
    if (!q) return;

    setTotError(null);
    setTotRevealed(null);
    setTotPendingResult(null);
    setTotSaved(false);
    setTotCountdown(5);
    setTotLoading(true);

    try {
      const result = await requestTotPhrase({
        language: config.language,
        dialect: dialectInfo.id,
        domain: domainInfo.id,
        englishQuery: q,
      });
      setTotPendingResult(result);
    } catch (err) {
      setTotError(err instanceof Error ? err.message : 'Unable to retrieve high-register phrase.');
      setTotCountdown(0);
    } finally {
      setTotLoading(false);
    }
  };

  const handleRevealTotEarly = () => {
    setTotCountdown(0);
    if (totPendingResult) {
      setTotRevealed(totPendingResult);
      setTotPendingResult(null);
    }
  };

  const handleSaveTot = () => {
    if (!totRevealed) return;
    onSaveVocab({
      term: totRevealed.targetPhrase,
      englishConcept: totQuery.trim(),
      contextSentence: totRevealed.exampleSentence,
      registerTag: totRevealed.registerNote,
      category: totRevealed.category,
      language: config.language,
      dialect: config.dialect,
      domain: config.domain,
    });
    setTotSaved(true);
  };

  const handleEndAndDebrief = () => {
    tts.stop();
    stt.stopListening();
    setSessionActive(false);
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

      {/* Tip-of-the-Tongue 5-Second Active Retrieval Drawer */}
      {totOpen && (
        <section
          aria-label="5-Second Tip-of-the-Tongue Helper"
          className="rounded-xl border border-[#D99B26]/35 bg-[#131A22] p-4 sm:p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-[#F8FAFC]">5-Second Tip-of-the-Tongue Retrieval Helper</h2>
              <p className="text-xs text-[#94A3B8] mt-0.5">
                Enter what you want to say in English. Hold for the 5-second active recall window to retrieve it from
                memory before reveal.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setTotOpen(false)}
              aria-label="Close Tip-of-the-Tongue helper"
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#94A3B8] hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleStartTot} className="flex flex-col sm:flex-row gap-2.5">
            <label htmlFor="tot-query-input" className="sr-only">
              English phrase to express
            </label>
            <input
              id="tot-query-input"
              type="text"
              value={totQuery}
              onChange={(e) => setTotQuery(e.target.value)}
              placeholder='e.g., "provided that maritime assets arrive on time" or "joint staff talks"'
              className="flex-1 min-h-[42px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3.5 py-2 text-sm text-[#E6EDF3] placeholder:text-[#64748B] focus:outline-none focus:border-[#D99B26]"
            />
            <button
              type="submit"
              disabled={!totQuery.trim() || totLoading}
              className="px-4 py-2 min-h-[42px] rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              Start 5s Recall
            </button>
          </form>

          {totCountdown > 0 && (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-[#23303E] bg-[#0B1117] px-4 py-3">
              <div className="flex items-center gap-3">
                <span
                  data-testid="tot-countdown"
                  className="font-mono text-2xl font-bold text-[#D99B26] tabular-nums w-8 text-center"
                >
                  {totCountdown}
                </span>
                <div>
                  <p className="text-sm font-medium text-[#F8FAFC]">
                    Active Retrieval Window — Try saying it aloud first
                  </p>
                  <p className="text-xs text-[#94A3B8]">
                    Retrieving before seeing the answer strengthens ILR 2+ lexical access.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleRevealTotEarly}
                disabled={totLoading && !totPendingResult}
                className="px-3 py-1.5 rounded-lg border border-[#2E4054] text-xs font-medium text-[#CBD5E1] hover:text-white whitespace-nowrap"
              >
                Reveal Now
              </button>
            </div>
          )}

          {totCountdown === 0 && totLoading && (
            <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
              <Loader2 className="w-4 h-4 animate-spin text-[#D99B26]" />
              <span>Fetching high-register {LANGUAGE_LABELS[config.language]} expression…</span>
            </div>
          )}

          {totError && <p className="text-xs text-red-300">{totError}</p>}

          {totRevealed && totCountdown === 0 && (
            <div className="rounded-lg border border-[#23303E] bg-[#0B1117] p-4 space-y-2.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-[#94A3B8]">
                    {[
                      totRevealed.source === 'dictionary'
                        ? 'Instant Dictionary (0 API)'
                        : totRevealed.source === 'cache'
                          ? 'Cached (0 API)'
                          : 'Target High-Register Phrase',
                      totRevealed.category,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <p className="text-lg font-semibold text-[#F8FAFC] mt-0.5">{totRevealed.targetPhrase}</p>
                  {totRevealed.alternativeFormal && (
                    <p className="text-xs text-[#94A3B8] mt-0.5">
                      Alternative: <span className="text-[#CBD5E1]">{totRevealed.alternativeFormal}</span>
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      tts.speak(totRevealed.targetPhrase, {
                        lang: dialectInfo.bcp47,
                        rate: config.speechRate,
                        voiceURI: config.voiceURI,
                      })
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#23303E] text-xs text-[#CBD5E1] hover:text-white"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Listen</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveTot}
                    disabled={totSaved}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] disabled:opacity-70"
                  >
                    {totSaved ? <Check className="w-3.5 h-3.5" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
                    <span>{totSaved ? 'Saved to Vault' : 'Save to Vocab Vault'}</span>
                  </button>
                </div>
              </div>
              <p className="text-xs text-[#94A3B8]">{totRevealed.registerNote}</p>
              <p className="text-sm text-[#CBD5E1] italic">&ldquo;{totRevealed.exampleSentence}&rdquo;</p>
            </div>
          )}
        </section>
      )}

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
                const tokens = isExaminer ? tokenizeTranscript(msg.text) : [];
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
                        <p>
                          {tokens.map((tok, i) =>
                            tok.isWord ? (
                              <button
                                key={`${msg.id}-${i}`}
                                type="button"
                                onClick={() => handleWordClick(msg.id, tok.cleanWord, msg.text)}
                                className={`inline rounded px-0.5 transition-colors hover:bg-[#D99B26]/25 hover:text-[#F8FAFC] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#D99B26] ${
                                  wordPopover?.messageId === msg.id && wordPopover?.word === tok.cleanWord
                                    ? 'bg-[#D99B26]/30 text-[#F3C669] underline decoration-[#D99B26]'
                                    : ''
                                }`}
                              >
                                {tok.text}
                              </button>
                            ) : (
                              <span key={`${msg.id}-${i}`}>{tok.text}</span>
                            )
                          )}
                        </p>
                      ) : (
                        <p>{msg.text}</p>
                      )}
                    </div>

                    {/* Compact Tap-to-Save Contextual Popover directly under tapped message */}
                    {isExaminer && wordPopover?.messageId === msg.id && (
                      <div
                        ref={wordPopoverRef}
                        role="region"
                        aria-label={`Word lookup for ${wordPopover.word}`}
                        className="mt-2.5 w-full max-w-md rounded-xl border border-[#D99B26]/45 bg-[#0D141C] p-3.5 shadow-lg space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-[#F8FAFC]">{wordPopover.word}</p>
                            {wordPopover.result &&
                              [
                                OPI_SOURCE_LABELS[wordPopover.result.source],
                                wordPopover.result.registerTag,
                                wordPopover.result.suggestedCategory,
                              ].filter(Boolean).length > 0 && (
                                <p className="text-xs text-[#94A3B8]">
                                  {[
                                    OPI_SOURCE_LABELS[wordPopover.result.source],
                                    wordPopover.result.registerTag,
                                    wordPopover.result.suggestedCategory,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </p>
                              )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setWordPopover(null)}
                            aria-label="Close word popover"
                            className="p-1 text-[#94A3B8] hover:text-white"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        {wordPopover.loading && (
                          <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D99B26]" />
                            <span>Analyzing contextual register…</span>
                          </div>
                        )}

                        {wordPopover.error && (
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-red-300">{wordPopover.error}</p>
                            <button
                              type="button"
                              onClick={() =>
                                handleWordClick(wordPopover.messageId, wordPopover.word, wordPopover.contextSentence)
                              }
                              className="px-2.5 py-1 rounded-md border border-[#2E4054] bg-[#16202B] text-xs font-medium text-[#F8FAFC] hover:bg-[#1E2C3A] shrink-0"
                            >
                              Retry
                            </button>
                          </div>
                        )}

                        {wordPopover.result && (
                          <>
                            <p className="text-sm text-[#E6EDF3] font-medium">{wordPopover.result.contextualMeaning}</p>
                            {wordPopover.result.grammarNote && (
                              <p className="text-xs text-[#94A3B8] leading-relaxed">{wordPopover.result.grammarNote}</p>
                            )}
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                              {wordPopover.result.source !== 'ai' ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleWordClick(
                                      wordPopover.messageId,
                                      wordPopover.word,
                                      wordPopover.contextSentence,
                                      true
                                    )
                                  }
                                  className="text-xs font-medium text-[#94A3B8] hover:text-[#F3C669] hover:underline"
                                >
                                  Ask AI for sentence context
                                </button>
                              ) : (
                                <span />
                              )}
                              <button
                                type="button"
                                onClick={handleSavePopoverWord}
                                disabled={wordPopover.saved}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] disabled:opacity-70 transition-colors"
                              >
                                {wordPopover.saved ? (
                                  <Check className="w-3.5 h-3.5" />
                                ) : (
                                  <BookmarkPlus className="w-3.5 h-3.5" />
                                )}
                                <span>{wordPopover.saved ? 'Saved to Vault' : 'Save to Vocab Vault'}</span>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
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
            <label className="flex items-start justify-between gap-3 cursor-pointer">
              <div>
                <p className="text-sm font-medium text-[#E6EDF3]">Hands-Free Auto-Listen</p>
                <p className="text-xs text-[#94A3B8]">
                  Automatically open microphone right after the examiner finishes speaking.
                </p>
              </div>
              <input
                type="checkbox"
                checked={config.handsFreeMode}
                onChange={(e) => onUpdateConfig({handsFreeMode: e.target.checked})}
                className="mt-1 h-4 w-4 accent-[#D99B26]"
              />
            </label>
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
