import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
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
import {buildChatThreadTitle, getDomainInfo, resolveActiveThreadForLanguage} from '../utils/ilrLogic';
import {clampSlangLevel, mergePickedUpItems} from '../utils/talkLogic';
import {requestTalkWrapUp} from '../services/api';
import type {TalkNotePayload} from '../hooks/useGeminiLive';
import type {SaveVocabFn} from '../hooks/useWordLookup';
import {createId} from '../utils/ids';
import {type TalkChatHandle, TalkChatScreen} from './talk/TalkChatScreen';
import {TalkSetupScreen} from './talk/TalkSetupScreen';
import {TalkWrapUpView} from './talk/TalkWrapUpView';

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

/**
 * Talk: partner & scene setup -> conversation -> wrap-up. This shell owns the threads, the setup
 * choices and the wrap-up; the conversation itself lives in TalkChatScreen.
 */
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

  const [wrapUpData, setWrapUpData] = useState<TalkWrapUpResponse | null>(null);
  const [wrapUpLoading, setWrapUpLoading] = useState(false);
  const [wrapUpError, setWrapUpError] = useState<string | null>(null);

  const chatRef = useRef<TalkChatHandle>(null);

  // "Work talk" opened from elsewhere (Today plan): apply it once per request token while rendering,
  // then tell the parent it was consumed.
  const [handledWorkTalkToken, setHandledWorkTalkToken] = useState<number | null>(null);
  if (workTalkRequest && workTalkRequest.token !== handledWorkTalkToken) {
    setHandledWorkTalkToken(workTalkRequest.token);
    if (config.workFocusEnabled) {
      setWorkTalk(true);
      setSceneId(WORK_TALK_SCENE_ID);
      setSelectedDomain(workTalkRequest.domain);
    }
    setScreenMode('setup');
  }
  useEffect(() => {
    if (workTalkRequest) onConsumeWorkTalkRequest?.();
  }, [workTalkRequest, onConsumeWorkTalkRequest]);

  // Switching language resumes that language's latest thread with its partner and settings.
  const [threadLanguage, setThreadLanguage] = useState(config.language);
  if (threadLanguage !== config.language) {
    setThreadLanguage(config.language);
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
    setWrapUpData(null);
    setScreenMode('setup');
  }

  // Turning Work focus OFF in Settings/MissionSheet while in Talk leaves Work talk immediately.
  if (!config.workFocusEnabled && workTalk) {
    setWorkTalk(false);
    if (sceneId === WORK_TALK_SCENE_ID) setSceneId(DEFAULT_SCENE_ID);
  }

  const selectedTutor = useMemo(() => {
    const t = getTutorById(selectedTutorId);
    if (t && t.language === config.language) return t;
    return getDefaultTutor(config.language, config.dialect);
  }, [selectedTutorId, config.language, config.dialect]);

  const effectiveWorkTalk = Boolean(config.workFocusEnabled && workTalk);

  // Latest values for async WebSocket / turn callbacks (updated after each render).
  const activeThreadIdRef = useRef(activeThreadId);
  const sessionMetaRef = useRef({
    tutorId: selectedTutor.id,
    dialectId: selectedTutor.dialectId,
    sceneId,
    workTalk: effectiveWorkTalk,
    domain: selectedDomain,
    slangLevel,
    correctionMode,
  });
  useLayoutEffect(() => {
    activeThreadIdRef.current = activeThreadId;
    sessionMetaRef.current = {
      tutorId: selectedTutor.id,
      dialectId: selectedTutor.dialectId,
      sceneId,
      workTalk: effectiveWorkTalk,
      domain: selectedDomain,
      slangLevel,
      correctionMode,
    };
  });

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
    chatRef.current?.endCall();
    const clearedId = activeThreadIdRef.current;
    activeThreadIdRef.current = '';
    setActiveThreadId('');
    if (clearedId) {
      onUpdateThreads((prev) => prev.filter((t) => t.id !== clearedId));
    }
    chatRef.current?.closeLookups();
    chatRef.current?.clearNotices();
    setWrapUpData(null);
    setWrapUpError(null);
  };

  const handleStartTalkingFromSetup = () => {
    chatRef.current?.clearNotices();
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
    chatRef.current?.endCall();
    setScreenMode('wrap_up');
    onWrapUpComplete?.();
    void runWrapUp();
  };

  const handleBackToSetup = () => {
    chatRef.current?.endCall();
    setScreenMode('setup');
  };

  const existingTurnCount = (activeThread?.messages ?? []).filter((m) => m && typeof m.id === 'string').length;
  const existingTutor = getTutorById(activeThread?.tutorId);

  return (
    <>
      <TalkChatScreen
        ref={chatRef}
        hidden={screenMode !== 'chat'}
        config={config}
        vocabItems={vocabItems}
        activeThread={activeThread}
        selectedTutor={selectedTutor}
        sceneId={sceneId}
        effectiveWorkTalk={effectiveWorkTalk}
        selectedDomain={selectedDomain}
        slangLevel={slangLevel}
        correctionMode={correctionMode}
        activeSceneLabel={activeSceneLabel}
        lookupConfig={lookupConfig}
        recordSavedTerm={recordSavedTerm}
        appendMessageToThread={appendMessageToThread}
        applyTalkNoteToThread={applyTalkNoteToThread}
        onSaveVocab={onSaveVocab}
        onNavigateTab={onNavigateTab}
        onOpenTabHelp={onOpenTabHelp}
        onBackToSetup={handleBackToSetup}
        onOpenWrapUp={handleOpenWrapUp}
      />

      {screenMode === 'setup' && (
        <TalkSetupScreen
          config={config}
          selectedTutor={selectedTutor}
          sceneId={sceneId}
          workTalk={effectiveWorkTalk}
          selectedDomain={selectedDomain}
          slangLevel={slangLevel}
          correctionMode={correctionMode}
          existingTurnCount={existingTurnCount}
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
      )}

      {screenMode === 'wrap_up' && (
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
      )}
    </>
  );
};
