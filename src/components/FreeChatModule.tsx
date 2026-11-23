import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ArrowRight,
  BookmarkPlus,
  Captions,
  HelpCircle,
  Keyboard,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  RotateCcw,
  Send,
  Volume2,
} from 'lucide-react';
import type {ChatRegisterMode, FreeChatMessage, FreeChatThread, MissionConfig, ModuleTab, VocabItem} from '../types';
import {buildChatThreadTitle, getDialectInfo, LANGUAGE_LABELS, resolveActiveThreadForLanguage} from '../utils/ilrLogic';
import {sendFreeChatTurn} from '../services/api';
import {useGeminiLive, type GeminiLiveVoice} from '../hooks/useGeminiLive';
import {useSpeechSynthesis} from '../hooks/useSpeech';
import {type SaveVocabFn, useWordLookup} from '../hooks/useWordLookup';
import {createId} from '../utils/ids';
import {TappableText} from './shared/TappableText';
import {WordLookupPopover} from './shared/WordLookupPopover';
import {FlagWordDrawer} from './chat/FlagWordDrawer';
import {LiveVoiceOrb} from './chat/LiveVoiceOrb';

interface FreeChatModuleProps {
  config: MissionConfig;
  threads: FreeChatThread[];
  vocabItems: VocabItem[];
  onUpdateThreads: React.Dispatch<React.SetStateAction<FreeChatThread[]>>;
  onUpdateConfig: (patch: Partial<MissionConfig>) => void;
  onSaveVocab: SaveVocabFn;
  onNavigateTab: (tab: ModuleTab) => void;
  onOpenTabHelp: () => void;
}

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

  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;

  const transcriptPaneRef = useRef<HTMLDivElement | null>(null);
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
      id: createId(`live-${role}`),
      role,
      text: clean,
      timestamp: nowIso,
    };

    const currentId = activeThreadIdRef.current;
    if (!currentId) {
      const newId = createId('chat');
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

  const wordLookup = useWordLookup({config, vocabItems, onSaveVocab, onSaved: recordSavedTerm});

  const live = useGeminiLive({
    onTurnComplete: (role, text) => {
      appendMessageToThread(role, text);
    },
  });

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

  const handleToggleLiveCall = () => {
    setTextError(null);
    wordLookup.close();
    if (live.isLive) {
      live.endSession();
      return;
    }
    tts.stop();
    live.startSession({
      language: config.language,
      dialect: config.dialect,
      domain: config.domain,
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
    wordLookup.close();
    setTextError(null);
  };

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = textInput.trim();
    if (!clean || isSendingText) return;

    setTextInput('');
    setTextError(null);
    wordLookup.close();

    // If Live Voice session is active, inject directly into the live stream!
    if (live.isLive) {
      const sent = live.sendLiveText(clean);
      if (!sent) {
        setTextError('Still connecting live voice — try again in a second.');
        setTextInput(clean);
      }
      return;
    }

    const priorHistory = (activeThread?.messages ?? []).map((m) => ({
      role: m.role,
      text: typeof m.text === 'string' ? m.text : '',
    }));
    appendMessageToThread('user', clean);
    setShowTranscript(true);
    setIsSendingText(true);

    try {
      const res = await sendFreeChatTurn({
        language: config.language,
        dialect: config.dialect,
        domain: config.domain,
        registerMode,
        history: priorHistory,
        userMessage: clean,
      });
      const reply = typeof res?.replyText === 'string' ? res.replyText.trim() : '';
      if (!reply) {
        throw new Error('Partner reply was empty. Please try again.');
      }
      appendMessageToThread('assistant', reply);
    } catch (err) {
      setTextError(err instanceof Error ? err.message : 'Unable to reach conversation partner.');
    } finally {
      setIsSendingText(false);
    }
  };

  const messages = useMemo(
    () => (activeThread?.messages ?? []).filter((m) => m && typeof m.id === 'string'),
    [activeThread?.messages]
  );
  const savedCount = activeThread?.savedTerms.length ?? 0;
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
        <LiveVoiceOrb
          status={live.status}
          isLive={live.isLive}
          isMuted={live.isMuted}
          micLevel={live.micLevel}
          aiLevel={live.aiLevel}
        />

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
            <FlagWordDrawer
              config={config}
              fallbackContextSentence={activeThread?.messages[activeThread.messages.length - 1]?.text ?? ''}
              onSaveVocab={onSaveVocab}
              onSaved={recordSavedTerm}
              onClose={() => setShowFlagDrawer(false)}
            />
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
                          <TappableText
                            text={safeText}
                            activeWord={wordLookup.lookup?.messageId === msg.id ? wordLookup.lookup.word : undefined}
                            onWordTap={(word) => wordLookup.lookUpWord(msg.id, word, safeText)}
                            hoverClassName="hover:text-white"
                          />
                        ) : (
                          <p>{safeText}</p>
                        )}
                      </div>

                      {/* Tap-to-Save Word Popover */}
                      {isPartner && wordLookup.lookup?.messageId === msg.id && (
                        <WordLookupPopover
                          lookup={wordLookup.lookup}
                          onClose={wordLookup.close}
                          onRetry={wordLookup.retry}
                          onSave={wordLookup.save}
                          compact
                        />
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
