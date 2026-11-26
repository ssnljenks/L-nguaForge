import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  Captions,
  Check,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Keyboard,
  Loader2,
  MessageSquarePlus,
  Mic,
  MicOff,
  PhoneOff,
  Send,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import {DEFAULT_SCENE_ID, getDefaultTutor, getTutorById, type TutorPersona, WORK_TALK_SCENE_ID} from '../data/tutors';
import type {
  AppendErrorEventsFn,
  FreeChatMessage,
  FreeChatThread,
  MilitaryDomain,
  MissionConfig,
  ModuleTab,
  TalkCorrectionMode,
  TalkPickedUpItem,
  TalkWrapUpResponse,
  VocabItem,
} from '../types';
import {
  buildChatThreadTitle,
  getDialectInfo,
  getDomainInfo,
  LANGUAGE_LABELS,
  resolveActiveThreadForLanguage,
} from '../utils/ilrLogic';
import {
  buildRegionalCandidates,
  buildTalkVocabSaveInput,
  clampSlangLevel,
  getSlangLevelSpec,
  isTermInVocab,
  mergePickedUpItems,
  type RegionalTermCandidate,
} from '../utils/talkLogic';
import {requestTalkWrapUp, sendFreeChatTurn} from '../services/api';
import {type TalkNotePayload, useGeminiLive} from '../hooks/useGeminiLive';
import {useSpeechSynthesis} from '../hooks/useSpeech';
import {type SaveVocabFn, useWordLookup} from '../hooks/useWordLookup';
import {createId} from '../utils/ids';
import {WordLookupPopover} from './shared/WordLookupPopover';
import {FlagWordDrawer} from './chat/FlagWordDrawer';
import {LiveVoiceOrb} from './chat/LiveVoiceOrb';
import {TalkSetupScreen} from './talk/TalkSetupScreen';
import {ColloquialTranscriptText} from './talk/ColloquialTranscriptText';
import {HowDoLocalsSaySheet} from './talk/HowDoLocalsSaySheet';
import {TalkWrapUpView} from './talk/TalkWrapUpView';
import {CLASSIFICATION_REJECT_MESSAGE, detectClassificationMarking} from '../utils/classificationGuard';

export interface TalkWorkRequest {
  domain: MilitaryDomain;
  token: number;
}

interface FreeChatModuleProps {
  config: MissionConfig;
  threads: FreeChatThread[];
  vocabItems: VocabItem[];
  workTalkRequest?: TalkWorkRequest | null;
  onConsumeWorkTalkRequest?: () => void;
  onWrapUpComplete?: () => void;
  onUpdateThreads: React.Dispatch<React.SetStateAction<FreeChatThread[]>>;
  onUpdateConfig: (patch: Partial<MissionConfig>) => void;
  onSaveVocab: SaveVocabFn;
  onAppendErrorEvents?: AppendErrorEventsFn;
  onNavigateTab: (tab: ModuleTab) => void;
  onOpenTabHelp: () => void;
}

type TalkScreenMode = 'setup' | 'chat' | 'wrap_up';

interface ColloquialLookupState {
  messageId: string;
  candidate: RegionalTermCandidate;
  contextSentence: string;
}

export const FreeChatModule: React.FC<FreeChatModuleProps> = ({
  config,
  threads,
  vocabItems,
  workTalkRequest,
  onConsumeWorkTalkRequest,
  onWrapUpComplete,
  onUpdateThreads,
  onUpdateConfig,
  onSaveVocab,
  onAppendErrorEvents,
  onNavigateTab,
  onOpenTabHelp,
}) => {
  const [activeThreadId, setActiveThreadId] = useState<string>(
    () => threads.find((t) => t.language === config.language)?.id ?? ''
  );

  const activeThread = useMemo(
    () => resolveActiveThreadForLanguage(threads, activeThreadId, config.language),
    [threads, activeThreadId, config.language]
  );

  // Setup selections (synced cleanly when switching language or resuming an active thread)
  const [selectedTutorId, setSelectedTutorId] = useState<string>(() => {
    const initialTutor = getTutorById(activeThread?.tutorId);
    if (initialTutor && initialTutor.language === config.language) return initialTutor.id;
    return getDefaultTutor(config.language, config.dialect).id;
  });
  const [sceneId, setSceneId] = useState<string>(() =>
    workTalkRequest && config.workFocusEnabled ? WORK_TALK_SCENE_ID : (activeThread?.sceneId ?? DEFAULT_SCENE_ID)
  );
  const [workTalk, setWorkTalk] = useState<boolean>(() =>
    Boolean(config.workFocusEnabled && (workTalkRequest || activeThread?.workTalk))
  );
  const [selectedDomain, setSelectedDomain] = useState<MilitaryDomain>(
    () => workTalkRequest?.domain ?? activeThread?.domain ?? config.domain
  );
  const [slangLevel, setSlangLevel] = useState<number>(() => clampSlangLevel(activeThread?.slangLevel ?? 2));
  const [correctionMode, setCorrectionMode] = useState<TalkCorrectionMode>(
    () => activeThread?.correctionMode ?? 'recast'
  );

  const [screenMode, setScreenMode] = useState<TalkScreenMode>('setup');

  useEffect(() => {
    if (!workTalkRequest) return;
    if (config.workFocusEnabled) {
      setWorkTalk(true);
      setSceneId(WORK_TALK_SCENE_ID);
      setSelectedDomain(workTalkRequest.domain);
    }
    setScreenMode('setup');
    onConsumeWorkTalkRequest?.();
  }, [workTalkRequest, config.workFocusEnabled, onConsumeWorkTalkRequest]);
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

  const [wrapUpData, setWrapUpData] = useState<TalkWrapUpResponse | null>(null);
  const [wrapUpLoading, setWrapUpLoading] = useState(false);
  const [wrapUpError, setWrapUpError] = useState<string | null>(null);

  // Refs used inside async WebSocket / turn callbacks to avoid stale closures
  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;

  const selectedTutor = useMemo(() => {
    const t = getTutorById(selectedTutorId);
    if (t && t.language === config.language) return t;
    return getDefaultTutor(config.language, config.dialect);
  }, [selectedTutorId, config.language, config.dialect]);

  const effectiveWorkTalk = Boolean(config.workFocusEnabled && workTalk);

  const sessionMetaRef = useRef({
    tutorId: selectedTutor.id,
    dialectId: selectedTutor.dialectId,
    sceneId,
    workTalk: effectiveWorkTalk,
    domain: selectedDomain,
    slangLevel,
    correctionMode,
  });
  sessionMetaRef.current = {
    tutorId: selectedTutor.id,
    dialectId: selectedTutor.dialectId,
    sceneId,
    workTalk: effectiveWorkTalk,
    domain: selectedDomain,
    slangLevel,
    correctionMode,
  };

  const prevLangRef = useRef(config.language);
  useEffect(() => {
    if (prevLangRef.current !== config.language) {
      prevLangRef.current = config.language;
      const matchingThread = threads.find((t) => t.language === config.language);
      setActiveThreadId(matchingThread?.id ?? '');
      const matchingTutor = getTutorById(matchingThread?.tutorId);
      const nextTutor =
        matchingTutor && matchingTutor.language === config.language
          ? matchingTutor
          : getDefaultTutor(config.language, config.dialect);
      setSelectedTutorId(nextTutor.id);
      setSceneId(matchingThread?.sceneId ?? DEFAULT_SCENE_ID);
      setWorkTalk(Boolean(config.workFocusEnabled && matchingThread?.workTalk));
      setSelectedDomain(matchingThread?.domain ?? config.domain);
      setSlangLevel(clampSlangLevel(matchingThread?.slangLevel ?? 2));
      setCorrectionMode(matchingThread?.correctionMode ?? 'recast');
      setLatestRecastNote(null);
      setColloquialLookup(null);
      setWrapUpData(null);
      setScreenMode('setup');
    }
  }, [config.language, config.dialect, config.domain, config.workFocusEnabled, threads]);

  // If user toggles Work focus OFF in Settings/MissionSheet while in Talk, exit Work talk immediately
  useEffect(() => {
    if (!config.workFocusEnabled && workTalk) {
      setWorkTalk(false);
      if (sceneId === WORK_TALK_SCENE_ID) {
        setSceneId(DEFAULT_SCENE_ID);
      }
    }
  }, [config.workFocusEnabled, workTalk, sceneId]);

  const transcriptPaneRef = useRef<HTMLDivElement | null>(null);
  const tts = useSpeechSynthesis();

  const dialectInfo = getDialectInfo(config.language, selectedTutor.dialectId);
  const voiceName = config.liveVoice;
  const slangSpec = getSlangLevelSpec(slangLevel);

  const activeSceneLabel = useMemo(() => {
    if (effectiveWorkTalk) {
      return `Work talk · ${getDomainInfo(selectedDomain).shortLabel}`;
    }
    return selectedTutor.scenes.find((s) => s.id === sceneId)?.label ?? 'Just chatting';
  }, [effectiveWorkTalk, selectedDomain, selectedTutor.scenes, sceneId]);

  const lookupConfig = useMemo<MissionConfig>(
    () => ({
      ...config,
      dialect: selectedTutor.dialectId,
      domain: selectedDomain,
    }),
    [config, selectedTutor.dialectId, selectedDomain]
  );

  const recordSavedTerm = useCallback(
    (term: string) => {
      const currentId = activeThreadIdRef.current;
      if (!currentId || !term.trim()) return;
      onUpdateThreads((prev) =>
        prev.map((t) => {
          if (t.id !== currentId) return t;
          if (t.savedTerms.some((x) => x.toLowerCase() === term.toLowerCase())) return t;
          return {...t, savedTerms: [term, ...t.savedTerms]};
        })
      );
    },
    [onUpdateThreads]
  );

  const wordLookup = useWordLookup({
    config: lookupConfig,
    vocabItems,
    onSaveVocab,
    onSaved: recordSavedTerm,
    vocabSource: 'talk',
    regionTag: selectedTutor.regionTag,
    omitDomain: !effectiveWorkTalk,
  });

  const appendMessageToThread = useCallback(
    (role: 'user' | 'assistant', text: string, extra?: {recastNote?: string; pickedUp?: TalkPickedUpItem[]}) => {
      const clean = text.trim();
      if (!clean) return;
      const meta = sessionMetaRef.current;
      const nowIso = new Date().toISOString();
      const nextMsg: FreeChatMessage = {
        id: createId(`talk-${role}`),
        role,
        text: clean,
        timestamp: nowIso,
        ...(extra?.recastNote ? {recastNote: extra.recastNote} : {}),
        ...(extra?.pickedUp && extra.pickedUp.length > 0 ? {pickedUp: extra.pickedUp} : {}),
      };

      const incomingPickedUp = extra?.pickedUp ?? [];
      const currentId = activeThreadIdRef.current;

      const buildFreshThread = (id: string): FreeChatThread => ({
        id,
        title: buildChatThreadTitle(clean),
        language: config.language,
        dialect: meta.dialectId,
        registerMode: meta.workTalk ? 'professional' : 'everyday',
        updatedAt: nowIso,
        messages: [nextMsg],
        savedTerms: [],
        tutorId: meta.tutorId,
        sceneId: meta.sceneId,
        workTalk: meta.workTalk,
        ...(meta.workTalk ? {domain: meta.domain} : {}),
        slangLevel: meta.slangLevel,
        correctionMode: meta.correctionMode,
        pickedUp: incomingPickedUp,
        recastNotes: extra?.recastNote ? [extra.recastNote] : [],
      });

      if (!currentId) {
        const newId = createId('talk');
        activeThreadIdRef.current = newId;
        setActiveThreadId(newId);
        onUpdateThreads((prev) => [buildFreshThread(newId), ...prev].slice(0, 20));
        return;
      }

      onUpdateThreads((prev) => {
        const exists = prev.some((t) => t.id === currentId);
        if (!exists) {
          return [buildFreshThread(currentId), ...prev].slice(0, 20);
        }
        return prev.map((t) => {
          if (t.id !== currentId) return t;
          const nextPicked =
            incomingPickedUp.length > 0 ? mergePickedUpItems(t.pickedUp ?? [], incomingPickedUp) : (t.pickedUp ?? []);
          const nextNotes = extra?.recastNote ? [...(t.recastNotes ?? []), extra.recastNote] : (t.recastNotes ?? []);
          return {
            ...t,
            dialect: meta.dialectId,
            registerMode: meta.workTalk ? 'professional' : 'everyday',
            updatedAt: nowIso,
            tutorId: meta.tutorId,
            sceneId: meta.sceneId,
            workTalk: meta.workTalk,
            domain: meta.workTalk ? meta.domain : undefined,
            slangLevel: meta.slangLevel,
            correctionMode: meta.correctionMode,
            messages: [...t.messages, nextMsg],
            pickedUp: nextPicked,
            recastNotes: nextNotes,
          };
        });
      });
    },
    [config.language, onUpdateThreads]
  );

  const applyTalkNoteToThread = useCallback(
    (note: TalkNotePayload) => {
      if (note.recastNote && sessionMetaRef.current.correctionMode === 'recast') {
        setLatestRecastNote(note.recastNote);
      }
      const currentId = activeThreadIdRef.current;
      if (!currentId) return;
      onUpdateThreads((prev) =>
        prev.map((t) => {
          if (t.id !== currentId) return t;
          const nextPicked =
            note.pickedUp.length > 0 ? mergePickedUpItems(t.pickedUp ?? [], note.pickedUp) : t.pickedUp;
          const nextNotes = note.recastNote ? [...(t.recastNotes ?? []), note.recastNote] : t.recastNotes;
          const lastIdx = t.messages.length - 1;
          const updatedMessages =
            lastIdx >= 0 && t.messages[lastIdx]?.role === 'assistant'
              ? t.messages.map((m, idx) =>
                  idx === lastIdx
                    ? {
                        ...m,
                        ...(note.recastNote ? {recastNote: note.recastNote} : {}),
                        ...(note.pickedUp.length > 0 ? {pickedUp: note.pickedUp} : {}),
                      }
                    : m
                )
              : t.messages;
          return {
            ...t,
            messages: updatedMessages,
            pickedUp: nextPicked,
            recastNotes: nextNotes,
          };
        })
      );
    },
    [onUpdateThreads]
  );

  const live = useGeminiLive({
    onTurnComplete: (role, text) => {
      appendMessageToThread(role, text);
    },
    onTalkNote: applyTalkNoteToThread,
  });

  // Scroll transcript pane cleanly
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

  const handleSelectTutor = (tutor: TutorPersona) => {
    setSelectedTutorId(tutor.id);
    if (config.dialect !== tutor.dialectId) {
      onUpdateConfig({dialect: tutor.dialectId});
    }
    if (!workTalk && !tutor.scenes.some((s) => s.id === sceneId)) {
      setSceneId(DEFAULT_SCENE_ID);
    }
  };

  const handleSelectScene = (nextSceneId: string, isWork: boolean) => {
    setSceneId(nextSceneId);
    setWorkTalk(isWork);
  };

  const handleResetChat = () => {
    if (live.isLive) live.endSession();
    tts.stop();
    const clearedId = activeThreadIdRef.current;
    activeThreadIdRef.current = '';
    setActiveThreadId('');
    if (clearedId) {
      onUpdateThreads((prev) => prev.filter((t) => t.id !== clearedId));
    }
    wordLookup.close();
    setColloquialLookup(null);
    setLatestRecastNote(null);
    setWrapUpData(null);
    setWrapUpError(null);
    setTextError(null);
  };

  const handleStartTalkingFromSetup = () => {
    setTextError(null);
    setLatestRecastNote(null);
    setWrapUpData(null);
    setWrapUpError(null);

    // If changing tutor/scene from an earlier thread with a different partner, start a fresh thread cleanly
    if (
      activeThread &&
      (activeThread.tutorId !== selectedTutor.id ||
        Boolean(activeThread.workTalk) !== effectiveWorkTalk ||
        (effectiveWorkTalk && activeThread.domain !== selectedDomain))
    ) {
      activeThreadIdRef.current = '';
      setActiveThreadId('');
    }
    setScreenMode('chat');
  };

  const handleResumeExisting = () => {
    if (activeThread) {
      const existingTutor = getTutorById(activeThread.tutorId);
      if (existingTutor && existingTutor.language === config.language) {
        setSelectedTutorId(existingTutor.id);
        if (config.dialect !== existingTutor.dialectId) {
          onUpdateConfig({dialect: existingTutor.dialectId});
        }
      }
      setSceneId(activeThread.sceneId ?? DEFAULT_SCENE_ID);
      setWorkTalk(Boolean(config.workFocusEnabled && activeThread.workTalk));
      if (activeThread.domain) setSelectedDomain(activeThread.domain);
      setSlangLevel(clampSlangLevel(activeThread.slangLevel ?? 2));
      setCorrectionMode(activeThread.correctionMode ?? 'recast');
    }
    setScreenMode('chat');
  };

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

    if (live.isLive) {
      // Same guard the server applies to typed live text (REVIEW H-4); keep the draft so it can be edited.
      if (detectClassificationMarking(clean)) {
        setTextError(CLASSIFICATION_REJECT_MESSAGE);
        setTextInput(clean);
        return;
      }
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

  const runWrapUp = useCallback(async () => {
    const threadMessages = (activeThread?.messages ?? []).map((m) => ({
      role: m.role,
      text: typeof m.text === 'string' ? m.text : '',
    }));

    if (threadMessages.length === 0) {
      setWrapUpData({
        summary: `You haven't chatted with ${selectedTutor.name} yet — say hello first and wrap up anytime to save expressions.`,
        endNotes: [],
        items: [],
      });
      setWrapUpLoading(false);
      setWrapUpError(null);
      return;
    }

    setWrapUpLoading(true);
    setWrapUpError(null);
    try {
      const res = await requestTalkWrapUp({
        language: config.language,
        dialect: selectedTutor.dialectId,
        tutorId: selectedTutor.id,
        sceneId: effectiveWorkTalk ? WORK_TALK_SCENE_ID : sceneId,
        workTalk: effectiveWorkTalk,
        ...(effectiveWorkTalk ? {domain: selectedDomain} : {}),
        slangLevel,
        correctionMode,
        messages: threadMessages,
      });
      setWrapUpData(res);
      if (res.errors && res.errors.length > 0) {
        onAppendErrorEvents?.(
          res.errors.map((errItem) => ({
            key: errItem.key,
            source: 'talk',
            sessionId: activeThread?.id ?? `talk-${selectedTutor.id}`,
            wrong: errItem.wrong,
            fix: errItem.fix,
            quote: errItem.quote,
            language: config.language,
          }))
        );
      }
    } catch (err) {
      setWrapUpError(err instanceof Error ? err.message : 'Unable to summarize this conversation.');
    } finally {
      setWrapUpLoading(false);
    }
  }, [
    activeThread?.id,
    activeThread?.messages,
    config.language,
    selectedTutor.dialectId,
    selectedTutor.id,
    selectedTutor.name,
    effectiveWorkTalk,
    sceneId,
    selectedDomain,
    slangLevel,
    correctionMode,
    onAppendErrorEvents,
  ]);

  const handleOpenWrapUp = () => {
    if (live.isLive) {
      live.endSession();
    }
    tts.stop();
    setScreenMode('wrap_up');
    onWrapUpComplete?.();
    void runWrapUp();
  };

  const handleBackToSetup = () => {
    if (live.isLive) {
      live.endSession();
    }
    tts.stop();
    setScreenMode('setup');
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

  const existingTutor = getTutorById(activeThread?.tutorId);

  if (screenMode === 'setup') {
    return (
      <TalkSetupScreen
        config={config}
        selectedTutor={selectedTutor}
        sceneId={sceneId}
        workTalk={effectiveWorkTalk}
        selectedDomain={selectedDomain}
        slangLevel={slangLevel}
        correctionMode={correctionMode}
        existingTurnCount={messages.length}
        existingTutorName={existingTutor?.name}
        onSelectTutor={handleSelectTutor}
        onSelectScene={handleSelectScene}
        onSelectDomain={setSelectedDomain}
        onChangeSlangLevel={setSlangLevel}
        onChangeCorrectionMode={setCorrectionMode}
        onStartTalking={handleStartTalkingFromSetup}
        onResumeExisting={handleResumeExisting}
        onStartFresh={handleResetChat}
        onOpenTabHelp={onOpenTabHelp}
      />
    );
  }

  if (screenMode === 'wrap_up') {
    return (
      <TalkWrapUpView
        tutor={selectedTutor}
        sceneLabel={activeSceneLabel}
        workTalk={effectiveWorkTalk}
        domain={selectedDomain}
        vocabItems={vocabItems}
        wrapUp={wrapUpData}
        isLoading={wrapUpLoading}
        error={wrapUpError}
        onRetry={() => void runWrapUp()}
        onSaveVocab={onSaveVocab}
        onSavedTerm={recordSavedTerm}
        onKeepTalking={() => setScreenMode('chat')}
        onStartFresh={() => {
          handleResetChat();
          setScreenMode('setup');
        }}
        onGoToVocab={() => onNavigateTab('vocab')}
      />
    );
  }

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
    <div className="max-w-3xl mx-auto space-y-4 pb-28 md:pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#23303E]">
        <div className="flex items-start gap-2.5 min-w-0">
          <button
            type="button"
            onClick={handleBackToSetup}
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
              {activeSceneLabel} · {slangSpec.label} · {selectedTutor.defaultRegister}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowHowLocals(true)}
            data-testid="how-do-locals-say-btn"
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-lg border border-[#2E4054] bg-[#111922] text-xs font-medium text-[#BAE6FD] hover:border-[#7DD3FC]/60 hover:text-white transition-colors whitespace-nowrap"
          >
            <MessageSquarePlus className="w-3.5 h-3.5 text-[#7DD3FC]" />
            <span>How do locals say…</span>
          </button>

          <button
            type="button"
            onClick={handleOpenWrapUp}
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
        <section
          className="rounded-xl border border-[#23303E] bg-[#111922] overflow-hidden"
          data-testid="picked-up-bar"
        >
          <button
            type="button"
            onClick={() => setShowPickedUpTray((prev) => !prev)}
            aria-expanded={showPickedUpTray}
            className="w-full min-h-[44px] px-4 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-[#141E29] transition-colors"
          >
            <span className="text-xs text-[#E6EDF3] truncate">
              <span className="font-semibold text-[#7DD3FC]">Picked up:</span> {pickedUpPreviewText}
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-[#94A3B8] shrink-0">
              <span className="font-mono tabular-nums">{threadPickedUp.length}</span>
              {showPickedUpTray ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </span>
          </button>

          {showPickedUpTray && (
            <div className="border-t border-[#1D2835] divide-y divide-[#1D2835]">
              {threadPickedUp.map((item) => {
                const alreadySaved = isTermInVocab(item.term, config.language, vocabItems);
                return (
                  <div key={item.term} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#F8FAFC]">
                        {item.term} <span className="text-xs font-normal text-[#94A3B8]">· {item.meaning}</span>
                      </p>
                      <p className="text-[11px] text-[#7D8FA3]">{item.regionTag}</p>
                    </div>
                    <button
                      type="button"
                      disabled={alreadySaved}
                      onClick={() =>
                        handleSaveColloquial(item, item.example ?? `${selectedTutor.name} used ${item.term}`)
                      }
                      className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg text-xs font-semibold shrink-0 transition-colors ${
                        alreadySaved
                          ? 'border border-emerald-500/35 bg-emerald-950/25 text-emerald-300 cursor-default'
                          : 'bg-[#D99B26] text-[#0B1117] hover:bg-[#E5AE42]'
                      }`}
                    >
                      {alreadySaved ? <Check className="w-3.5 h-3.5" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
                      <span>{alreadySaved ? 'In Vocab' : 'Save'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
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
              aria-label="Toggle text input"
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
        <section
          data-testid="talk-transcript-panel"
          className="rounded-xl border border-[#23303E] bg-[#111922] overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-[#23303E] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
              <span className="font-medium text-[#CBD5E1]">Conversation</span>
              <span>·</span>
              <span>
                Tap{' '}
                <span className="text-[#BAE6FD] underline decoration-dotted decoration-[#7DD3FC]">local phrases</span>{' '}
                or any word to save
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowFlagDrawer((prev) => !prev)}
                className="inline-flex items-center gap-1 min-h-[44px] text-xs font-medium text-[#F3C669] hover:underline whitespace-nowrap"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                <span>{showFlagDrawer ? 'Hide Note Tool' : 'Save a Phrase'}</span>
              </button>

              {savedCount > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigateTab('vocab')}
                  className="inline-flex items-center gap-1 min-h-[44px] text-xs font-medium text-emerald-400 hover:underline whitespace-nowrap tabular-nums"
                >
                  <span>{savedCount} in Vocab</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {showFlagDrawer && (
            <FlagWordDrawer
              config={lookupConfig}
              fallbackContextSentence={activeThread?.messages[activeThread.messages.length - 1]?.text ?? ''}
              onSaveVocab={onSaveVocab}
              onSaved={recordSavedTerm}
              onClose={() => setShowFlagDrawer(false)}
            />
          )}

          <div ref={transcriptPaneRef} className="max-h-[360px] overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && !live.liveUserTranscript && !live.livePartnerTranscript ? (
              <p className="text-xs text-[#7D8FA3] text-center py-6">
                Listening… captions will appear here as you and {selectedTutor.name} talk.
              </p>
            ) : (
              <>
                {messages.map((msg) => {
                  const isPartner = msg.role === 'assistant';
                  const safeText = typeof msg.text === 'string' ? msg.text : '';
                  const msgCandidates =
                    msg.pickedUp && msg.pickedUp.length > 0
                      ? buildRegionalCandidates(selectedTutor, [msg.pickedUp, threadPickedUp])
                      : regionalCandidates;

                  const colloquialOpen = colloquialLookup?.messageId === msg.id ? colloquialLookup : null;
                  const colloquialAlreadySaved = colloquialOpen
                    ? isTermInVocab(colloquialOpen.candidate.term, config.language, vocabItems)
                    : false;

                  return (
                    <div key={msg.id} className={`flex flex-col ${isPartner ? 'items-start' : 'items-end'}`}>
                      <div className="flex items-center gap-2 text-[11px] text-[#7D8FA3] mb-1 px-1">
                        <span>{isPartner ? selectedTutor.name : 'You'}</span>
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
                            aria-label={`Replay ${selectedTutor.name} message`}
                            className="text-[#94A3B8] hover:text-[#F3C669] p-1"
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
                        <ColloquialTranscriptText
                          text={safeText}
                          candidates={isPartner ? msgCandidates : []}
                          activeWord={wordLookup.lookup?.messageId === msg.id ? wordLookup.lookup.word : undefined}
                          isPartner={isPartner}
                          onWordTap={(word) => {
                            setColloquialLookup(null);
                            void wordLookup.lookUpWord(msg.id, word, safeText);
                          }}
                          onColloquialTap={(candidate) => {
                            wordLookup.close();
                            setColloquialLookup({
                              messageId: msg.id,
                              candidate,
                              contextSentence: safeText,
                            });
                          }}
                        />
                      </div>

                      {/* Inline Colloquial Expression Card (from dotted-underline tap) */}
                      {isPartner && colloquialOpen && (
                        <div
                          role="region"
                          aria-label={`Local expression: ${colloquialOpen.candidate.term}`}
                          className="mt-2.5 w-full max-w-sm rounded-xl border border-[#7DD3FC]/45 bg-[#0D141C] p-3.5 space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-[#F8FAFC]">{colloquialOpen.candidate.term}</p>
                              <p className="text-[11px] text-[#7DD3FC]">{colloquialOpen.candidate.regionTag}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setColloquialLookup(null)}
                              aria-label="Close local expression card"
                              className="p-1 text-[#94A3B8] hover:text-white"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          <p className="text-sm text-[#E6EDF3]">{colloquialOpen.candidate.meaning}</p>
                          <div className="flex justify-end">
                            <button
                              type="button"
                              disabled={colloquialAlreadySaved}
                              onClick={() =>
                                handleSaveColloquial(colloquialOpen.candidate, colloquialOpen.contextSentence)
                              }
                              className={`inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-lg text-xs font-semibold transition-colors ${
                                colloquialAlreadySaved
                                  ? 'border border-emerald-500/35 bg-emerald-950/25 text-emerald-300 cursor-default'
                                  : 'bg-[#D99B26] text-[#0B1117] hover:bg-[#E5AE42]'
                              }`}
                            >
                              {colloquialAlreadySaved ? (
                                <Check className="w-3.5 h-3.5" />
                              ) : (
                                <BookmarkPlus className="w-3.5 h-3.5" />
                              )}
                              <span>{colloquialAlreadySaved ? 'Already in Vocab' : 'Save to Vocab'}</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Standard Single-Word Lookup Popover */}
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
                    <span className="text-[11px] text-[#7D8FA3] mb-1 px-1">{selectedTutor.name} (speaking…)</span>
                    <div className="max-w-[90%] rounded-xl px-3.5 py-2.5 text-sm bg-[#16202B]/80 border border-sky-400/35 text-[#F1F5F9]">
                      {live.livePartnerTranscript}
                    </div>
                  </div>
                )}

                {isSendingText && (
                  <div className="flex items-center gap-2 text-xs text-[#94A3B8] px-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D99B26]" />
                    <span>{selectedTutor.name} is replying…</span>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
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
