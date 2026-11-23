import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ArrowRight,
  AudioLines,
  BookmarkPlus,
  Captions,
  Check,
  HelpCircle,
  Keyboard,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  RotateCcw,
  Send,
  Volume2,
  X,
} from 'lucide-react';
import type {
  ChatRegisterMode,
  FreeChatMessage,
  FreeChatThread,
  MissionConfig,
  ModuleTab,
  VocabCategory,
  VocabItem,
} from '../types';
import {
  buildChatThreadTitle,
  getDialectInfo,
  getDomainInfo,
  LANGUAGE_LABELS,
  normalizeVocabCategory,
  resolveActiveThreadForLanguage,
  tokenizeTranscript,
} from '../utils/ilrLogic';
import {
  type EnrichedTotResult,
  type EnrichedWordLookup,
  incrementApiSavedCount,
  lookupLocalWord,
  type LookupSource,
} from '../utils/localDictionary';
import {lookupContextualWord, requestTotPhrase, sendFreeChatTurn} from '../services/api';
import {useGeminiLive, type GeminiLiveVoice} from '../hooks/useGeminiLive';
import {useSpeechSynthesis} from '../hooks/useSpeech';

interface FreeChatModuleProps {
  config: MissionConfig;
  threads: FreeChatThread[];
  vocabItems: VocabItem[];
  onUpdateThreads: React.Dispatch<React.SetStateAction<FreeChatThread[]>>;
  onUpdateConfig: (patch: Partial<MissionConfig>) => void;
  onSaveVocab: (item: Omit<VocabItem, 'id' | 'createdAt' | 'mastery' | 'reviewCount'>) => void;
  onNavigateTab: (tab: ModuleTab) => void;
  onOpenTabHelp: () => void;
}

interface ActiveWordPopover {
  messageId: string;
  word: string;
  contextSentence: string;
  loading: boolean;
  result?: EnrichedWordLookup;
  error?: string;
  saved?: boolean;
}

const SOURCE_LABELS: Record<LookupSource, string> = {
  vault: 'In Vault · Offline',
  military_dict: 'Military Dict · Offline',
  dictionary: 'Local Dict · Offline',
  cache: 'Cached · Offline',
  ai: 'AI Context · Cached',
};

const VOICE_OPTIONS: {id: GeminiLiveVoice; label: string}[] = [
  {id: 'Zephyr', label: 'Zephyr'},
  {id: 'Puck', label: 'Puck'},
  {id: 'Kore', label: 'Kore'},
  {id: 'Fenrir', label: 'Fenrir'},
  {id: 'Charon', label: 'Charon'},
];

export const FreeChatModule: React.FC<FreeChatModuleProps> = ({
  config,
  threads,
  vocabItems,
  onUpdateThreads,
  onSaveVocab,
  onNavigateTab,
  onOpenTabHelp,
}) => {
  const dialectInfo = getDialectInfo(config.language, config.dialect);
  const domainInfo = getDomainInfo(config.domain);

  const [activeThreadId, setActiveThreadId] = useState<string>(
    () => threads.find((t) => t.language === config.language)?.id ?? ''
  );
  const [registerMode, setRegisterMode] = useState<ChatRegisterMode>('everyday');
  const [voiceName, setVoiceName] = useState<GeminiLiveVoice>('Zephyr');
  const [showTranscript, setShowTranscript] = useState(true);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [showFlagDrawer, setShowFlagDrawer] = useState(false);

  // Optional keyboard message input (works live over WebSocket OR offline-from-call via fast text API)
  const [textInput, setTextInput] = useState('');
  const [isSendingText, setIsSendingText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);

  // Tap-any-word lookup popover
  const [wordPopover, setWordPopover] = useState<ActiveWordPopover | null>(null);

  // Lightweight inline "Flag a word" drawer state
  const [flagMode, setFlagMode] = useState<'lookup' | 'direct'>('lookup');
  const [flagInput, setFlagInput] = useState('');
  const [flagDirectEnglish, setFlagDirectEnglish] = useState('');
  const [flagCategory, setFlagCategory] = useState<VocabCategory>('Regional Idioms');
  const [flagLoading, setFlagLoading] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [flagResult, setFlagResult] = useState<EnrichedTotResult | null>(null);
  const [flagSaved, setFlagSaved] = useState(false);

  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;

  const currentLanguageRef = useRef(config.language);
  currentLanguageRef.current = config.language;

  const threadsRef = useRef(threads);
  threadsRef.current = threads;

  const transcriptPaneRef = useRef<HTMLDivElement | null>(null);
  const wordPopoverRef = useRef<HTMLDivElement | null>(null);
  const tts = useSpeechSynthesis();

  const activeThread = useMemo(
    () => resolveActiveThreadForLanguage(threads, activeThreadId, config.language),
    [threads, activeThreadId, config.language]
  );

  const appendMessageToThread = (role: 'user' | 'assistant', text: string) => {
    const clean = text.trim();
    if (!clean) return;
    const nowIso = new Date().toISOString();
    const nextMsg: FreeChatMessage = {
      id: `live-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role,
      text: clean,
      timestamp: nowIso,
    };

    const currentId = activeThreadIdRef.current;
    if (!currentId) {
      const newId = `chat-${Date.now()}`;
      const newThread: FreeChatThread = {
        id: newId,
        title: buildChatThreadTitle(clean),
        language: config.language,
        dialect: config.dialect,
        registerMode,
        updatedAt: nowIso,
        messages: [nextMsg],
        savedTerms: [],
      };
      activeThreadIdRef.current = newId;
      setActiveThreadId(newId);
      onUpdateThreads((prev) => [newThread, ...prev].slice(0, 20));
      return;
    }

    onUpdateThreads((prev) => {
      const exists = prev.some((t) => t.id === currentId);
      if (!exists) {
        const recreated: FreeChatThread = {
          id: currentId,
          title: buildChatThreadTitle(clean),
          language: config.language,
          dialect: config.dialect,
          registerMode,
          updatedAt: nowIso,
          messages: [nextMsg],
          savedTerms: [],
        };
        return [recreated, ...prev].slice(0, 20);
      }
      return prev.map((t) =>
        t.id === currentId
          ? {
              ...t,
              updatedAt: nowIso,
              messages: [...t.messages, nextMsg],
            }
          : t
      );
    });
  };

  const recordSavedTerm = (term: string) => {
    const currentId = activeThreadIdRef.current;
    if (!currentId || !term.trim()) return;
    onUpdateThreads((prev) =>
      prev.map((t) => {
        if (t.id !== currentId) return t;
        if (t.savedTerms.some((x) => x.toLowerCase() === term.toLowerCase())) return t;
        return {...t, savedTerms: [term, ...t.savedTerms]};
      })
    );
  };

  const live = useGeminiLive({
    onTurnComplete: (role, text) => {
      appendMessageToThread(role, text);
    },
  });

  const liveRef = useRef(live);
  liveRef.current = live;
  const ttsRef = useRef(tts);
  ttsRef.current = tts;

  // Scroll only the internal transcript pane smoothly without stacking animations on rapid captions
  useEffect(() => {
    const el = transcriptPaneRef.current;
    if (!el) return;
    if ((activeThread?.messages.length ?? 0) === 0 && !live.liveUserTranscript && !live.livePartnerTranscript) {
      return;
    }
    const rafId = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [activeThread?.messages.length, live.liveUserTranscript, live.livePartnerTranscript, isSendingText]);

  // Keep newly opened word lookup popover fully visible inside the transcript pane
  useEffect(() => {
    if (!wordPopover) return;
    const rafId = window.requestAnimationFrame(() => {
      wordPopoverRef.current?.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [wordPopover?.messageId, wordPopover?.word, wordPopover?.loading]);

  // Enforce complete isolation whenever the user switches target language (ES <-> PT)
  const prevLangRef = useRef(config.language);
  useEffect(() => {
    if (prevLangRef.current !== config.language) {
      prevLangRef.current = config.language;
      if (liveRef.current.isLive) {
        liveRef.current.endSession();
      }
      ttsRef.current.stop();
      const nextThreadId = threadsRef.current.find((t) => t.language === config.language)?.id ?? '';
      activeThreadIdRef.current = nextThreadId;
      setActiveThreadId(nextThreadId);
      setWordPopover(null);
      setTextInput('');
      setTextError(null);
      setIsSendingText(false);
      setShowFlagDrawer(false);
      setFlagInput('');
      setFlagDirectEnglish('');
      setFlagResult(null);
      setFlagError(null);
      setFlagSaved(false);
    }
  }, [config.language]);

  const handleToggleLiveCall = () => {
    setTextError(null);
    setWordPopover(null);
    if (live.isLive) {
      live.endSession();
      return;
    }
    tts.stop();
    live.startSession({
      language: config.language,
      dialect: dialectInfo.id,
      domain: domainInfo.id,
      registerMode,
      voiceName,
    });
  };

  const handleResetChat = () => {
    if (live.isLive) {
      live.endSession();
    }
    tts.stop();
    const clearedId = activeThreadIdRef.current;
    activeThreadIdRef.current = '';
    setActiveThreadId('');
    if (clearedId) {
      onUpdateThreads((prev) => prev.filter((t) => t.id !== clearedId));
    }
    setWordPopover(null);
    setTextError(null);
  };

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = textInput.trim();
    if (!clean || isSendingText) return;

    setTextInput('');
    setTextError(null);
    setWordPopover(null);

    // If Live Voice session is active, inject directly into the live stream!
    if (live.isLive) {
      const sent = live.sendLiveText(clean);
      if (!sent) {
        setTextError('Still connecting live voice — try again in a second.');
        setTextInput(clean);
      }
      return;
    }

    const requestLang = config.language;
    const priorHistory = (activeThread?.messages ?? []).map((m) => ({
      role: m.role,
      text: typeof m.text === 'string' ? m.text : '',
    }));
    appendMessageToThread('user', clean);
    setShowTranscript(true);
    setIsSendingText(true);

    try {
      const res = await sendFreeChatTurn({
        language: requestLang,
        dialect: dialectInfo.id,
        domain: domainInfo.id,
        registerMode,
        history: priorHistory,
        userMessage: clean,
      });
      if (currentLanguageRef.current !== requestLang) return;
      const reply = typeof res?.replyText === 'string' ? res.replyText.trim() : '';
      if (!reply) {
        throw new Error('Partner reply was empty. Please try again.');
      }
      appendMessageToThread('assistant', reply);
    } catch (err) {
      if (currentLanguageRef.current !== requestLang) return;
      setTextError(err instanceof Error ? err.message : 'Unable to reach conversation partner.');
    } finally {
      if (currentLanguageRef.current === requestLang) {
        setIsSendingText(false);
      }
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
      if (!result.contextualMeaning?.trim()) {
        throw new Error('Could not retrieve the word meaning. Please tap Retry.');
      }
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
      category: normalizeVocabCategory(wordPopover.result.suggestedCategory),
      language: config.language,
      dialect: config.dialect,
      domain: config.domain,
    });
    recordSavedTerm(wordPopover.word);
    setWordPopover((prev) => (prev ? {...prev, saved: true} : null));
  };

  const handleFlagSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFlagError(null);
    setFlagSaved(false);

    if (flagMode === 'direct') {
      if (!flagInput.trim() || !flagDirectEnglish.trim()) {
        setFlagError('Enter both the word/phrase and its English meaning.');
        return;
      }
      const term = flagInput.trim();
      onSaveVocab({
        term,
        englishConcept: flagDirectEnglish.trim(),
        contextSentence:
          activeThread?.messages[activeThread.messages.length - 1]?.text ||
          `Saved during live ${LANGUAGE_LABELS[config.language]} conversation.`,
        registerTag: 'Live Voice Capture',
        category: flagCategory,
        language: config.language,
        dialect: config.dialect,
        domain: config.domain,
      });
      recordSavedTerm(term);
      setFlagInput('');
      setFlagDirectEnglish('');
      setFlagSaved(true);
      return;
    }

    if (!flagInput.trim()) {
      setFlagError('Type the English phrase you wanted to say.');
      return;
    }

    const requestLang = config.language;
    setFlagLoading(true);
    setFlagResult(null);
    try {
      const res = await requestTotPhrase({
        language: requestLang,
        dialect: dialectInfo.id,
        domain: domainInfo.id,
        englishQuery: flagInput.trim(),
      });
      if (currentLanguageRef.current !== requestLang) return;
      setFlagResult(res);
    } catch (err) {
      if (currentLanguageRef.current !== requestLang) return;
      setFlagError(err instanceof Error ? err.message : 'Could not translate phrase.');
    } finally {
      if (currentLanguageRef.current === requestLang) {
        setFlagLoading(false);
      }
    }
  };

  const handleSaveFlagResult = () => {
    if (!flagResult) return;
    onSaveVocab({
      term: flagResult.targetPhrase,
      englishConcept: flagInput.trim() || flagResult.registerNote,
      contextSentence: flagResult.exampleSentence,
      registerTag: flagResult.registerNote,
      category: normalizeVocabCategory(flagResult.category),
      language: config.language,
      dialect: config.dialect,
      domain: config.domain,
    });
    recordSavedTerm(flagResult.targetPhrase);
    setFlagSaved(true);
  };

  const messages = useMemo(
    () => (activeThread?.messages ?? []).filter((m) => m && typeof m.id === 'string'),
    [activeThread?.messages]
  );
  const tokenizedByMessageId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof tokenizeTranscript>>();
    for (const msg of messages) {
      if (msg.role === 'assistant') {
        const safeText = typeof msg.text === 'string' ? msg.text : '';
        map.set(msg.id, tokenizeTranscript(safeText));
      }
    }
    return map;
  }, [messages]);
  const savedCount = activeThread?.savedTerms.length ?? 0;
  const activeEnergy =
    live.status === 'speaking'
      ? Math.max(0.22, live.aiLevel)
      : live.status === 'listening' && !live.isMuted
        ? Math.max(0.08, live.micLevel)
        : 0;

  const statusHeadline =
    live.status === 'connecting'
      ? 'Connecting live audio…'
      : live.status === 'speaking'
        ? 'Partner speaking — interrupt anytime'
        : live.status === 'listening'
          ? live.isMuted
            ? 'Microphone muted'
            : 'Listening — speak naturally'
          : `Live ${LANGUAGE_LABELS[config.language]} Voice Partner`;

  const activeError = live.error || textError;

  // 5 reactive acoustic bars for the Gemini Live orb
  const barMultipliers = [0.55, 0.85, 1.0, 0.85, 0.55];

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Minimal Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#23303E]">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#F8FAFC]">Live Voice Chat</h1>
          <p className="text-xs text-[#94A3B8]">
            {LANGUAGE_LABELS[config.language]} · {dialectInfo.short} · Real-time back-and-forth speech
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            className="flex items-center p-0.5 rounded-lg bg-[#111922] border border-[#23303E]"
            role="group"
            aria-label="Conversation tone"
          >
            {(
              [
                {id: 'everyday', label: 'Casual'},
                {id: 'professional', label: 'ILR 2+'},
                {id: 'debate', label: 'ILR 3'},
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={live.isLive}
                onClick={() => setRegisterMode(opt.id)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap disabled:opacity-50 ${
                  registerMode === opt.id ? 'bg-[#1D2B3A] text-[#F8FAFC]' : 'text-[#8B9BB0] hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <label htmlFor="live-voice-select" className="sr-only">
            AI voice
          </label>
          <select
            id="live-voice-select"
            aria-label="AI voice"
            disabled={live.isLive}
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value as GeminiLiveVoice)}
            className="h-[34px] rounded-lg border border-[#23303E] bg-[#111922] px-2.5 text-xs text-[#CBD5E1] focus:outline-none focus:border-[#D99B26] disabled:opacity-50"
          >
            {VOICE_OPTIONS.map((v) => (
              <option key={v.id} value={v.id}>
                Voice: {v.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={onOpenTabHelp}
            className="hidden sm:inline-flex items-center gap-1.5 h-[34px] px-2.5 rounded-lg border border-[#23303E] bg-[#111922] text-xs font-medium text-[#CBD5E1] hover:text-white hover:border-[#35495E] transition-colors whitespace-nowrap"
          >
            <HelpCircle className="w-3.5 h-3.5 text-[#D99B26]" />
            <span>How it works</span>
          </button>
        </div>
      </div>

      {activeError && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {activeError}
        </div>
      )}

      {/* Main Gemini Live Voice Stage */}
      <section className="rounded-2xl border border-[#23303E] bg-[#111922] px-5 py-8 sm:py-10 flex flex-col items-center text-center space-y-6">
        {/* Reactive Voice Orb */}
        <div className="relative flex items-center justify-center w-36 h-36 sm:w-40 sm:h-40">
          {/* Outer reactive pulse ring */}
          <div
            aria-hidden="true"
            className={`absolute inset-0 rounded-full transition-all duration-150 ${
              live.status === 'speaking'
                ? 'bg-sky-400/12 border border-sky-400/40'
                : live.status === 'listening' && !live.isMuted
                  ? 'bg-[#D99B26]/12 border border-[#D99B26]/45'
                  : live.status === 'connecting'
                    ? 'bg-[#D99B26]/10 border border-[#D99B26]/30 animate-pulse'
                    : 'bg-[#16202B]/70 border border-[#23303E]'
            }`}
            style={{
              transform: `scale(${1 + activeEnergy * 0.22})`,
            }}
          />

          {/* Inner orb core */}
          <div
            className={`relative z-10 w-24 h-24 sm:w-28 sm:h-28 rounded-full flex items-center justify-center border transition-colors ${
              live.status === 'speaking'
                ? 'bg-[#0F1E2E] border-sky-400/60'
                : live.status === 'listening' && !live.isMuted
                  ? 'bg-[#1A1812] border-[#D99B26]/70'
                  : 'bg-[#0D141C] border-[#2A394A]'
            }`}
          >
            {live.status === 'connecting' ? (
              <Loader2 className="w-8 h-8 text-[#D99B26] animate-spin" />
            ) : live.isLive ? (
              <div className="flex items-center gap-1.5 h-10" aria-hidden="true">
                {barMultipliers.map((mult, idx) => {
                  const heightPx = live.isMuted ? 6 : Math.max(8, Math.round((0.18 + activeEnergy * mult) * 38));
                  return (
                    <span
                      key={idx}
                      className={`w-1.5 rounded-full transition-all duration-100 ${
                        live.status === 'speaking' ? 'bg-sky-400' : live.isMuted ? 'bg-[#475569]' : 'bg-[#D99B26]'
                      }`}
                      style={{height: `${heightPx}px`}}
                    />
                  );
                })}
              </div>
            ) : (
              <AudioLines className="w-9 h-9 text-[#D99B26]" />
            )}
          </div>
        </div>

        {/* Live Status Copy */}
        <div className="space-y-1 max-w-md">
          <p className="text-base sm:text-lg font-semibold text-[#F8FAFC]">{statusHeadline}</p>
          <p className="text-xs sm:text-sm text-[#94A3B8] leading-relaxed">
            {live.isLive
              ? 'Just talk out loud like a phone call. Tap any word in the live captions below to save it to your Vocab Vault.'
              : `Hold a real-time spoken conversation in ${LANGUAGE_LABELS[config.language]} (${dialectInfo.label}) with instant voice replies and natural barge-in.`}
          </p>
        </div>

        {/* Gemini Live Control Dock */}
        {!live.isLive ? (
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleToggleLiveCall}
              className="inline-flex items-center gap-2.5 px-6 py-3 min-h-[48px] rounded-full bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
            >
              <Mic className="w-4 h-4" />
              <span>Start Live Voice</span>
            </button>

            <button
              type="button"
              onClick={() => setShowKeyboard((prev) => !prev)}
              aria-label="Toggle text input"
              className={`inline-flex items-center gap-2 px-4 py-3 min-h-[48px] rounded-full border text-xs font-medium transition-colors ${
                showKeyboard
                  ? 'border-[#D99B26]/60 bg-[#1A2430] text-[#F8FAFC]'
                  : 'border-[#2E4054] bg-[#0D141C] text-[#CBD5E1] hover:text-white'
              }`}
            >
              <Keyboard className="w-4 h-4" />
              <span>Type instead</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-4 pt-1">
            <button
              type="button"
              onClick={live.toggleMute}
              aria-label={live.isMuted ? 'Unmute microphone' : 'Mute microphone'}
              className={`w-14 h-14 rounded-full flex items-center justify-center border transition-colors ${
                live.isMuted
                  ? 'border-amber-500/60 bg-amber-500/20 text-amber-300'
                  : 'border-[#2E4054] bg-[#16202B] text-[#F8FAFC] hover:bg-[#1E2C3A]'
              }`}
            >
              {live.isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

            <button
              type="button"
              onClick={() => setShowTranscript((prev) => !prev)}
              aria-label={showTranscript ? 'Hide live captions' : 'Show live captions'}
              className={`w-12 h-12 rounded-full flex items-center justify-center border transition-colors ${
                showTranscript
                  ? 'border-[#D99B26]/60 bg-[#1B2531] text-[#F3C669]'
                  : 'border-[#2E4054] bg-[#16202B] text-[#94A3B8] hover:text-white'
              }`}
            >
              <Captions className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => setShowKeyboard((prev) => !prev)}
              aria-label="Toggle keyboard input"
              className={`w-12 h-12 rounded-full flex items-center justify-center border transition-colors ${
                showKeyboard
                  ? 'border-[#D99B26]/60 bg-[#1B2531] text-[#F3C669]'
                  : 'border-[#2E4054] bg-[#16202B] text-[#94A3B8] hover:text-white'
              }`}
            >
              <Keyboard className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={handleToggleLiveCall}
              aria-label="End live voice conversation"
              className="w-14 h-14 rounded-full flex items-center justify-center bg-red-600 text-white hover:bg-red-500 transition-colors"
            >
              <PhoneOff className="w-5 h-5" />
            </button>
          </div>
        )}
      </section>

      {/* Optional Compact Text Composer (shown only when user clicks Type instead / Keyboard) */}
      {showKeyboard && (
        <form
          onSubmit={handleSendText}
          className="flex items-center gap-2 rounded-xl border border-[#23303E] bg-[#111922] p-2.5"
        >
          <label htmlFor="live-chat-text-input" className="sr-only">
            Type a message
          </label>
          <input
            id="live-chat-text-input"
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder={
              live.isLive
                ? `Send text into live ${LANGUAGE_LABELS[config.language]} call…`
                : `Write in ${LANGUAGE_LABELS[config.language]}…`
            }
            className="flex-1 min-h-[42px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3.5 py-2 text-sm text-[#E6EDF3] placeholder:text-[#64748B] focus:outline-none focus:border-[#D99B26]"
          />
          <button
            type="submit"
            disabled={!textInput.trim() || isSendingText}
            aria-label="Send message"
            className="min-h-[42px] px-4 rounded-lg bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] disabled:opacity-40 transition-colors flex items-center gap-1.5 shrink-0"
          >
            {isSendingText ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            <span className="hidden sm:inline">Send</span>
          </button>
        </form>
      )}

      {/* Lightweight Live Captions + Tap-to-Save Vocab Bar */}
      {showTranscript && (
        <section className="rounded-xl border border-[#23303E] bg-[#111922] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#23303E] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
              <span className="font-medium text-[#CBD5E1]">Live Transcript</span>
              <span>·</span>
              <span>Tap any AI word to save</span>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowFlagDrawer((prev) => !prev)}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#F3C669] hover:underline whitespace-nowrap"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                <span>{showFlagDrawer ? 'Hide Flag Tool' : 'Flag a Word'}</span>
              </button>

              {savedCount > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigateTab('vault')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 hover:underline whitespace-nowrap tabular-nums"
                >
                  <span>{savedCount} in Vault</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}

              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={handleResetChat}
                  aria-label="Start fresh conversation"
                  className="inline-flex items-center gap-1 text-xs text-[#7D8FA3] hover:text-white whitespace-nowrap"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              )}
            </div>
          </div>

          {/* Collapsible Inline "Flag a Word You Struggled With" Drawer */}
          {showFlagDrawer && (
            <div className="p-4 border-b border-[#23303E] bg-[#0D141C] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center p-0.5 rounded-lg bg-[#111922] border border-[#23303E]">
                  <button
                    type="button"
                    onClick={() => {
                      setFlagMode('lookup');
                      setFlagError(null);
                    }}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      flagMode === 'lookup' ? 'bg-[#1D2B3A] text-white' : 'text-[#8B9BB0]'
                    }`}
                  >
                    How do I say…?
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFlagMode('direct');
                      setFlagResult(null);
                      setFlagError(null);
                    }}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      flagMode === 'direct' ? 'bg-[#1D2B3A] text-white' : 'text-[#8B9BB0]'
                    }`}
                  >
                    Save Directly
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFlagDrawer(false)}
                  aria-label="Close flag word drawer"
                  className="p-1 text-[#94A3B8] hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleFlagSubmit} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <input
                  type="text"
                  value={flagInput}
                  onChange={(e) => {
                    setFlagInput(e.target.value);
                    setFlagSaved(false);
                  }}
                  placeholder={
                    flagMode === 'lookup'
                      ? 'English phrase you got stuck on…'
                      : `${LANGUAGE_LABELS[config.language]} word or phrase`
                  }
                  className={`${
                    flagMode === 'direct' ? 'sm:col-span-4' : 'sm:col-span-9'
                  } min-h-[40px] rounded-lg border border-[#23303E] bg-[#111922] px-3 py-2 text-xs text-[#E6EDF3] placeholder:text-[#64748B] focus:outline-none focus:border-[#D99B26]`}
                />

                {flagMode === 'direct' && (
                  <>
                    <input
                      type="text"
                      value={flagDirectEnglish}
                      onChange={(e) => setFlagDirectEnglish(e.target.value)}
                      placeholder="English meaning"
                      className="sm:col-span-4 min-h-[40px] rounded-lg border border-[#23303E] bg-[#111922] px-3 py-2 text-xs text-[#E6EDF3] placeholder:text-[#64748B] focus:outline-none focus:border-[#D99B26]"
                    />
                    <select
                      aria-label="Vault category"
                      value={flagCategory}
                      onChange={(e) => setFlagCategory(e.target.value as VocabCategory)}
                      className="sm:col-span-2 min-h-[40px] rounded-lg border border-[#23303E] bg-[#111922] px-2 text-xs text-[#E6EDF3]"
                    >
                      <option value="Regional Idioms">Idioms</option>
                      <option value="High-Register Connectors">Connectors</option>
                      <option value="Operational/Military Terms">Operational</option>
                      <option value="False Friends">False Friends</option>
                    </select>
                  </>
                )}

                <button
                  type="submit"
                  disabled={flagLoading}
                  className={`${
                    flagMode === 'direct' ? 'sm:col-span-2' : 'sm:col-span-3'
                  } min-h-[40px] rounded-lg bg-[#16202B] border border-[#2E4054] text-xs font-semibold text-[#F8FAFC] hover:bg-[#1E2C3A] disabled:opacity-50 flex items-center justify-center gap-1.5`}
                >
                  {flagLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D99B26]" /> : null}
                  <span>{flagMode === 'lookup' ? 'Look Up' : 'Save'}</span>
                </button>
              </form>

              {flagError && <p className="text-xs text-red-300">{flagError}</p>}
              {flagSaved && flagMode === 'direct' && <p className="text-xs text-emerald-400">Saved to Vocab Vault.</p>}

              {flagResult && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-[#23303E]">
                  <div className="space-y-0.5">
                    <p className="text-[11px] text-[#7D8FA3]">
                      {flagResult.source === 'dictionary'
                        ? 'Instant Dictionary (0 API)'
                        : flagResult.source === 'cache'
                          ? 'Cached (0 API)'
                          : 'AI Suggestion'}
                    </p>
                    <p className="text-sm font-semibold text-[#F3C669]">{flagResult.targetPhrase}</p>
                    <p className="text-xs text-[#94A3B8]">{flagResult.exampleSentence}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveFlagResult}
                    disabled={flagSaved}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] disabled:opacity-70 shrink-0"
                  >
                    {flagSaved ? <Check className="w-3.5 h-3.5" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
                    <span>{flagSaved ? 'Saved' : 'Save to Vault'}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Transcript Scroll Area */}
          <div ref={transcriptPaneRef} className="max-h-[340px] overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && !live.liveUserTranscript && !live.livePartnerTranscript ? (
              <p className="text-xs text-[#7D8FA3] text-center py-6">
                Live captions will appear here as you speak. Tap any partner word at any time to save it to your Vocab
                Vault.
              </p>
            ) : (
              <>
                {messages.map((msg) => {
                  const isPartner = msg.role === 'assistant';
                  const safeText = typeof msg.text === 'string' ? msg.text : '';
                  const tokens = isPartner ? (tokenizedByMessageId.get(msg.id) ?? []) : [];
                  return (
                    <div key={msg.id} className={`flex flex-col ${isPartner ? 'items-start' : 'items-end'}`}>
                      <div className="flex items-center gap-2 text-[11px] text-[#7D8FA3] mb-1 px-1">
                        <span>{isPartner ? `Partner (${voiceName})` : 'You'}</span>
                        {isPartner && safeText && !live.isLive && (
                          <button
                            type="button"
                            onClick={() =>
                              tts.speak(safeText, {
                                lang: dialectInfo.bcp47,
                                rate: config.speechRate,
                                voiceURI: config.voiceURI,
                              })
                            }
                            aria-label="Replay partner message"
                            className="text-[#94A3B8] hover:text-[#F3C669]"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div
                        className={`max-w-[90%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                          isPartner
                            ? 'bg-[#16202B] border border-[#253545] text-[#F1F5F9]'
                            : 'bg-[#1D2835] border border-[#2E4054] text-[#E6EDF3]'
                        }`}
                      >
                        {isPartner ? (
                          <p>
                            {tokens.map((tok, idx) =>
                              tok.isWord ? (
                                <button
                                  key={`${msg.id}-${idx}`}
                                  type="button"
                                  onClick={() => handleWordClick(msg.id, tok.cleanWord, safeText)}
                                  className={`inline rounded px-0.5 transition-colors hover:bg-[#D99B26]/25 hover:text-white ${
                                    wordPopover?.messageId === msg.id && wordPopover?.word === tok.cleanWord
                                      ? 'bg-[#D99B26]/30 text-[#F3C669] underline decoration-[#D99B26]'
                                      : ''
                                  }`}
                                >
                                  {tok.text}
                                </button>
                              ) : (
                                <span key={`${msg.id}-${idx}`}>{tok.text}</span>
                              )
                            )}
                          </p>
                        ) : (
                          <p>{safeText}</p>
                        )}
                      </div>

                      {/* Tap-to-Save Word Popover */}
                      {isPartner && wordPopover?.messageId === msg.id && (
                        <div
                          ref={wordPopoverRef}
                          role="region"
                          aria-label={`Word lookup for ${wordPopover.word}`}
                          className="mt-2 w-full max-w-sm rounded-xl border border-[#D99B26]/45 bg-[#0D141C] p-3.5 space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-[#F8FAFC]">{wordPopover.word}</p>
                              {wordPopover.result &&
                                [
                                  SOURCE_LABELS[wordPopover.result.source],
                                  wordPopover.result.registerTag,
                                  wordPopover.result.suggestedCategory,
                                ].filter(Boolean).length > 0 && (
                                  <p className="text-[11px] text-[#94A3B8]">
                                    {[
                                      SOURCE_LABELS[wordPopover.result.source],
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
                              aria-label="Close word lookup"
                              className="p-1 text-[#94A3B8] hover:text-white"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          {wordPopover.loading && (
                            <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D99B26]" />
                              <span>Looking up meaning…</span>
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
                              <p className="text-sm font-medium text-[#E6EDF3]">
                                {wordPopover.result.contextualMeaning}
                              </p>
                              {wordPopover.result.grammarNote && (
                                <p className="text-xs text-[#94A3B8]">{wordPopover.result.grammarNote}</p>
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
                                    className="text-[11px] font-medium text-[#94A3B8] hover:text-[#F3C669] hover:underline"
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
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] disabled:opacity-70"
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
                })}

                {/* Live Streaming Captions (In-Progress Turn) */}
                {live.liveUserTranscript && (
                  <div className="flex flex-col items-end">
                    <span className="text-[11px] text-[#7D8FA3] mb-1 px-1">You (speaking…)</span>
                    <div className="max-w-[90%] rounded-xl px-3.5 py-2.5 text-sm bg-[#1D2835]/70 border border-[#D99B26]/35 text-[#E6EDF3]">
                      {live.liveUserTranscript}
                    </div>
                  </div>
                )}

                {live.livePartnerTranscript && (
                  <div className="flex flex-col items-start">
                    <span className="text-[11px] text-[#7D8FA3] mb-1 px-1">Partner (speaking…)</span>
                    <div className="max-w-[90%] rounded-xl px-3.5 py-2.5 text-sm bg-[#16202B]/80 border border-sky-400/35 text-[#F1F5F9]">
                      {live.livePartnerTranscript}
                    </div>
                  </div>
                )}

                {isSendingText && (
                  <div className="flex items-center gap-2 text-xs text-[#94A3B8] px-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D99B26]" />
                    <span>Replying…</span>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
};
