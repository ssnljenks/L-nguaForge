import React, {useEffect, useImperativeHandle, useMemo, useRef, useState} from 'react';
import {Captions, Keyboard, Loader2, Mic, MicOff, PhoneOff, Send, X} from 'lucide-react';
import {type TutorPersona, WORK_TALK_SCENE_ID} from '../../data/tutors';
import type {
  FreeChatThread,
  MilitaryDomain,
  MissionConfig,
  ModuleTab,
  TalkCorrectionMode,
  TalkPickedUpItem,
  VocabItem,
} from '../../types';
import {getDialectInfo, LANGUAGE_LABELS} from '../../utils/ilrLogic';
import {
  buildRegionalCandidates,
  buildTalkVocabSaveInput,
  getSlangLevelSpec,
  type RegionalTermCandidate,
} from '../../utils/talkLogic';
import {sendFreeChatTurn} from '../../services/api';
import {type TalkNotePayload, useGeminiLive} from '../../hooks/useGeminiLive';
import {useSpeechSynthesis} from '../../hooks/useSpeech';
import {type SaveVocabFn, useWordLookup} from '../../hooks/useWordLookup';
import {CLASSIFICATION_REJECT_MESSAGE, detectClassificationMarking} from '../../utils/classificationGuard';
import {LiveVoiceOrb} from '../chat/LiveVoiceOrb';
import {HowDoLocalsSaySheet} from './HowDoLocalsSaySheet';
import {PickedUpTray} from './PickedUpTray';
import {TalkChatHeader} from './TalkChatHeader';
import {type ColloquialLookupState, TalkTranscriptPanel} from './TalkTranscriptPanel';

/** What the Talk shell can do to the chat screen across stage changes. */
export interface TalkChatHandle {
  /** Ends a live call and stops text-to-speech. */
  endCall: () => void;
  /** Clears the recast tip and the text error. */
  clearNotices: () => void;
  /** Closes the word and local-phrase lookups. */
  closeLookups: () => void;
}

interface TalkChatScreenProps {
  ref?: React.Ref<TalkChatHandle>;
  /** The chat stays mounted (hidden) during setup and wrap-up so its UI state survives, as before. */
  hidden: boolean;
  config: MissionConfig;
  vocabItems: VocabItem[];
  activeThread: FreeChatThread | null | undefined;
  selectedTutor: TutorPersona;
  sceneId: string;
  effectiveWorkTalk: boolean;
  selectedDomain: MilitaryDomain;
  slangLevel: number;
  correctionMode: TalkCorrectionMode;
  activeSceneLabel: string;
  lookupConfig: MissionConfig;
  recordSavedTerm: (term: string) => void;
  appendMessageToThread: (
    role: 'user' | 'assistant',
    text: string,
    extra?: {recastNote?: string; pickedUp?: TalkPickedUpItem[]}
  ) => void;
  applyTalkNoteToThread: (note: TalkNotePayload) => void;
  onSaveVocab: SaveVocabFn;
  onNavigateTab: (tab: ModuleTab) => void;
  onOpenTabHelp: () => void;
  onBackToSetup: () => void;
  onOpenWrapUp: () => void;
}

/** Run stage of Talk: live voice or typed conversation with the tutor. */
export const TalkChatScreen: React.FC<TalkChatScreenProps> = ({
  ref,
  hidden,
  config,
  vocabItems,
  activeThread,
  selectedTutor,
  sceneId,
  effectiveWorkTalk,
  selectedDomain,
  slangLevel,
  correctionMode,
  activeSceneLabel,
  lookupConfig,
  recordSavedTerm,
  appendMessageToThread,
  applyTalkNoteToThread,
  onSaveVocab,
  onNavigateTab,
  onOpenTabHelp,
  onBackToSetup,
  onOpenWrapUp,
}) => {
  const [showTranscript, setShowTranscript] = useState(true);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [showFlagDrawer, setShowFlagDrawer] = useState(false);
  const [showHowLocals, setShowHowLocals] = useState(false);
  const [showPickedUpTray, setShowPickedUpTray] = useState(false);

  const [latestRecastNote, setLatestRecastNote] = useState<string | null>(null);
  const [colloquialLookup, setColloquialLookup] = useState<ColloquialLookupState | null>(null);

  const [textInput, setTextInput] = useState('');
  const [isSendingText, setIsSendingText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);

  // Switching language drops the previous language's tip and open local-phrase card.
  const [lookupLanguage, setLookupLanguage] = useState(config.language);
  if (lookupLanguage !== config.language) {
    setLookupLanguage(config.language);
    setLatestRecastNote(null);
    setColloquialLookup(null);
  }

  const transcriptPaneRef = useRef<HTMLDivElement | null>(null);
  const tts = useSpeechSynthesis();

  const dialectInfo = getDialectInfo(config.language, selectedTutor.dialectId);
  const voiceName = config.liveVoice;
  const slangSpec = getSlangLevelSpec(slangLevel);

  const wordLookup = useWordLookup({
    config: lookupConfig,
    vocabItems,
    onSaveVocab,
    onSaved: recordSavedTerm,
    vocabSource: 'talk',
    regionTag: selectedTutor.regionTag,
    omitDomain: !effectiveWorkTalk,
  });

  const live = useGeminiLive({
    onTurnComplete: (role, text) => {
      appendMessageToThread(role, text);
    },
    onTalkNote: (note) => {
      if (note.recastNote && correctionMode === 'recast') {
        setLatestRecastNote(note.recastNote);
      }
      applyTalkNoteToThread(note);
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      endCall: () => {
        if (live.isLive) live.endSession();
        tts.stop();
      },
      clearNotices: () => {
        setLatestRecastNote(null);
        setTextError(null);
      },
      closeLookups: () => {
        wordLookup.close();
        setColloquialLookup(null);
      },
    }),
    [live, tts, wordLookup]
  );

  const messageCount = activeThread?.messages.length ?? 0;
  // Scroll transcript pane cleanly
  useEffect(() => {
    const el = transcriptPaneRef.current;
    if (!el) return;
    if (messageCount === 0 && !live.liveUserTranscript && !live.livePartnerTranscript && !isSendingText) {
      return;
    }
    const rafId = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [messageCount, live.liveUserTranscript, live.livePartnerTranscript, isSendingText]);

  const handleToggleLiveCall = () => {
    setTextError(null);
    wordLookup.close();
    setColloquialLookup(null);
    if (live.isLive) {
      live.endSession();
      return;
    }
    tts.stop();
    live.startSession({
      language: config.language,
      dialect: selectedTutor.dialectId,
      ...(effectiveWorkTalk ? {domain: selectedDomain} : {}),
      voiceName,
      tutorId: selectedTutor.id,
      sceneId: effectiveWorkTalk ? WORK_TALK_SCENE_ID : sceneId,
      workTalk: effectiveWorkTalk,
      slangLevel,
      correctionMode,
    });
  };

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = textInput.trim();
    if (!clean || isSendingText) return;

    setTextInput('');
    setTextError(null);
    wordLookup.close();
    setColloquialLookup(null);

    // Same guard the server applies (REVIEW H-4), checked before the line joins the conversation: a
    // rejected line kept in the thread would be resent as history and get every later turn rejected.
    // The draft stays so it can be edited.
    if (detectClassificationMarking(clean)) {
      setTextError(CLASSIFICATION_REJECT_MESSAGE);
      setTextInput(clean);
      return;
    }

    if (live.isLive) {
      const sent = live.sendLiveText(clean);
      if (!sent) {
        setTextError('Still connecting live audio — try again in a second.');
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
        dialect: selectedTutor.dialectId,
        ...(effectiveWorkTalk ? {domain: selectedDomain} : {}),
        tutorId: selectedTutor.id,
        sceneId: effectiveWorkTalk ? WORK_TALK_SCENE_ID : sceneId,
        workTalk: effectiveWorkTalk,
        slangLevel,
        correctionMode,
        history: priorHistory,
        userMessage: clean,
      });
      const reply = typeof res?.replyText === 'string' ? res.replyText.trim() : '';
      if (!reply) {
        throw new Error(`${selectedTutor.name} didn’t come through clearly. Please try again.`);
      }
      const recastNote =
        correctionMode === 'recast' && typeof res.recastNote === 'string' && res.recastNote.trim()
          ? res.recastNote.trim()
          : undefined;
      const pickedUp = Array.isArray(res.pickedUp) ? res.pickedUp : [];
      if (recastNote) setLatestRecastNote(recastNote);

      appendMessageToThread('assistant', reply, {recastNote, pickedUp});
    } catch (err) {
      setTextError(err instanceof Error ? err.message : `Unable to reach ${selectedTutor.name}.`);
    } finally {
      setIsSendingText(false);
    }
  };

  const messages = useMemo(
    () => (activeThread?.messages ?? []).filter((m) => m && typeof m.id === 'string'),
    [activeThread?.messages]
  );

  const threadPickedUp = useMemo(() => activeThread?.pickedUp ?? [], [activeThread?.pickedUp]);

  const regionalCandidates = useMemo(
    () => buildRegionalCandidates(selectedTutor, [threadPickedUp]),
    [selectedTutor, threadPickedUp]
  );

  const pickedUpPreviewText = useMemo(() => {
    if (threadPickedUp.length === 0) return '';
    return threadPickedUp
      .slice(-3)
      .map((i) => i.term)
      .join(' · ');
  }, [threadPickedUp]);

  const savedCount = activeThread?.savedTerms.length ?? 0;
  const hasSessionActivity =
    live.isLive ||
    messages.length > 0 ||
    isSendingText ||
    showFlagDrawer ||
    Boolean(live.liveUserTranscript) ||
    Boolean(live.livePartnerTranscript);

  const statusHeadline =
    live.status === 'connecting'
      ? `Connecting to ${selectedTutor.name}…`
      : live.status === 'speaking'
        ? `${selectedTutor.name} is speaking — jump in anytime`
        : live.status === 'listening'
          ? live.isMuted
            ? 'Microphone muted'
            : `Listening — chat naturally with ${selectedTutor.name}`
          : `Talking with ${selectedTutor.name} · ${selectedTutor.city}`;

  const activeError = live.error || textError;

  const handleSaveColloquial = (item: TalkPickedUpItem | RegionalTermCandidate, exampleSentence: string) => {
    onSaveVocab(
      buildTalkVocabSaveInput({
        term: item.term,
        meaning: item.meaning,
        exampleSentence,
        language: config.language,
        dialect: selectedTutor.dialectId,
        tutorId: selectedTutor.id,
        regionTag: item.regionTag,
        kind: 'kind' in item ? item.kind : undefined,
        workTalk: effectiveWorkTalk,
        domain: effectiveWorkTalk ? selectedDomain : undefined,
      })
    );
    recordSavedTerm(item.term);
  };

  return (
    <div hidden={hidden} className="max-w-3xl mx-auto space-y-4 pb-28 md:pb-8">
      <TalkChatHeader
        selectedTutor={selectedTutor}
        activeSceneLabel={activeSceneLabel}
        slangLabel={slangSpec.label}
        onBackToSetup={onBackToSetup}
        onOpenHowLocals={() => setShowHowLocals(true)}
        onOpenWrapUp={onOpenWrapUp}
        onOpenTabHelp={onOpenTabHelp}
      />

      {/* Subtle Recast Side-Note Banner */}
      {correctionMode === 'recast' && latestRecastNote && (
        <div
          role="status"
          data-testid="talk-recast-note"
          className="rounded-xl border border-[#7DD3FC]/35 bg-[#111D29] px-4 py-3 flex items-start justify-between gap-3"
        >
          <p className="text-xs sm:text-sm text-[#BAE6FD] leading-relaxed">{latestRecastNote}</p>
          <button
            type="button"
            onClick={() => setLatestRecastNote(null)}
            aria-label="Dismiss tip"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md text-[#7DD3FC] hover:text-white shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Picked Up Chip + Expandable Tray */}
      {threadPickedUp.length > 0 && (
        <PickedUpTray
          threadPickedUp={threadPickedUp}
          pickedUpPreviewText={pickedUpPreviewText}
          showPickedUpTray={showPickedUpTray}
          onToggleTray={() => setShowPickedUpTray((prev) => !prev)}
          language={config.language}
          vocabItems={vocabItems}
          tutorName={selectedTutor.name}
          onSave={handleSaveColloquial}
        />
      )}

      {activeError && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {activeError}
        </div>
      )}

      {/* Main Live Voice Stage */}
      <section className="rounded-2xl border border-[#23303E] bg-[#111922] px-5 py-6 sm:py-8 flex flex-col items-center text-center space-y-4">
        <LiveVoiceOrb
          status={live.status}
          isLive={live.isLive}
          isMuted={live.isMuted}
          micLevel={live.micLevel}
          aiLevel={live.aiLevel}
        />

        <div className="space-y-1 max-w-md">
          <p className="text-base sm:text-lg font-semibold text-[#F8FAFC]">{statusHeadline}</p>
          <p className="text-xs sm:text-sm text-[#94A3B8] leading-relaxed">
            {live.isLive
              ? 'Speak out loud naturally. Dotted-underlined phrases are local expressions — tap any word to save it.'
              : `Chat in real time with ${selectedTutor.name} in ${LANGUAGE_LABELS[config.language]} (${dialectInfo.label}), or switch on typing below.`}
          </p>
        </div>

        {!live.isLive ? (
          <div className="hidden md:flex flex-wrap items-center justify-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleToggleLiveCall}
              className="inline-flex items-center gap-2.5 px-6 py-3 min-h-[52px] rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
            >
              <Mic className="w-4 h-4" />
              <span>Start Live Voice</span>
            </button>

            <button
              type="button"
              onClick={() => setShowKeyboard((prev) => !prev)}
              aria-pressed={showKeyboard}
              className={`inline-flex items-center gap-2 px-4 py-3 min-h-[52px] rounded-xl border text-xs font-medium transition-colors ${
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

      {/* Optional Compact Text Composer */}
      {showKeyboard && (
        <form
          onSubmit={handleSendText}
          className="flex items-center gap-2 rounded-xl border border-[#23303E] bg-[#111922] p-2.5"
        >
          <label htmlFor="live-chat-text-input" className="sr-only">
            Type a message to {selectedTutor.name}
          </label>
          <input
            id="live-chat-text-input"
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder={
              live.isLive
                ? `Send text into live chat with ${selectedTutor.name}…`
                : `Say something to ${selectedTutor.name} in ${LANGUAGE_LABELS[config.language]}…`
            }
            className="flex-1 min-h-[44px] rounded-lg border border-[#23303E] bg-[#0B1117] px-3.5 py-2 text-sm text-[#E6EDF3] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#D99B26]"
          />
          <button
            type="submit"
            disabled={!textInput.trim() || isSendingText}
            aria-label="Send message"
            className="min-h-[52px] px-4 rounded-lg bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] disabled:opacity-40 transition-colors flex items-center gap-1.5 shrink-0"
          >
            {isSendingText ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            <span className="hidden sm:inline">Send</span>
          </button>
        </form>
      )}

      {/* Transcript + Colloquial Dotted-Underline Highlights + Word Lookup */}
      {showTranscript && hasSessionActivity && (
        <TalkTranscriptPanel
          config={config}
          lookupConfig={lookupConfig}
          selectedTutor={selectedTutor}
          dialectInfo={dialectInfo}
          messages={messages}
          threadPickedUp={threadPickedUp}
          regionalCandidates={regionalCandidates}
          live={live}
          isSendingText={isSendingText}
          tts={tts}
          wordLookup={wordLookup}
          colloquialLookup={colloquialLookup}
          setColloquialLookup={setColloquialLookup}
          vocabItems={vocabItems}
          onSaveVocab={onSaveVocab}
          recordSavedTerm={recordSavedTerm}
          handleSaveColloquial={handleSaveColloquial}
          showFlagDrawer={showFlagDrawer}
          onToggleFlagDrawer={() => setShowFlagDrawer((prev) => !prev)}
          onCloseFlagDrawer={() => setShowFlagDrawer(false)}
          savedCount={savedCount}
          onGoToVocab={() => onNavigateTab('vocab')}
          transcriptPaneRef={transcriptPaneRef}
        />
      )}

      {/* Mobile Sticky Thumb-Zone Primary Action Dock */}
      {!live.isLive && (
        <div className="md:hidden fixed bottom-[60px] left-0 right-0 z-30 px-4 py-2.5 bg-[#0B1117]/95 backdrop-blur-md border-t border-[#23303E] flex items-center gap-2">
          <button
            type="button"
            data-testid="talk-primary-cta-mobile"
            onClick={handleToggleLiveCall}
            className="flex-1 inline-flex items-center justify-center gap-2 min-h-[52px] px-4 rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
          >
            <Mic className="w-4 h-4" />
            <span>Start Live Voice</span>
          </button>

          <button
            type="button"
            onClick={() => setShowKeyboard((prev) => !prev)}
            aria-label="Toggle text input"
            aria-pressed={showKeyboard}
            className={`min-h-[52px] min-w-[52px] flex items-center justify-center rounded-xl border transition-colors ${
              showKeyboard
                ? 'border-[#D99B26]/60 bg-[#1A2430] text-[#F3C669]'
                : 'border-[#2E4054] bg-[#111922] text-[#CBD5E1]'
            }`}
          >
            <Keyboard className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* "How do locals say..." Sheet Dialog */}
      {showHowLocals && (
        <HowDoLocalsSaySheet
          tutor={selectedTutor}
          slangLevel={slangLevel}
          workTalk={effectiveWorkTalk}
          domain={selectedDomain}
          speechRate={config.speechRate}
          voiceURI={config.voiceURI}
          vocabItems={vocabItems}
          onSaveVocab={onSaveVocab}
          onSavedTerm={recordSavedTerm}
          onClose={() => setShowHowLocals(false)}
        />
      )}
    </div>
  );
};
