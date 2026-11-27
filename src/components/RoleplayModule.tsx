import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {IlrBaseLevel} from '../data/ilrSpeakingLevels';
import type {MissionConfig, OpiMessage, OpiSession, RoleplayScenarioPublic, TurnAssessment, VocabItem} from '../types';
import {getDialectInfo} from '../utils/ilrLogic';
import {ROLEPLAY_DURATION_SECONDS} from '../utils/opiRoleplay';
import {saveLastOpiAudio} from '../utils/opiAudioStore';
import {fetchRoleplayScenario, requestRoleplayTurn} from '../services/api';
import {ApiRequestError} from '../services/http';
import {useSpeechRecognition, useSpeechSynthesis} from '../hooks/useSpeech';
import {useCallAudio} from '../hooks/useCallAudio';
import {type SaveVocabFn, useWordLookup} from '../hooks/useWordLookup';
import {createId} from '../utils/ids';
import {OpiCallScreen} from './opi/OpiCallScreen';
import {RoleplaySetupScreen} from './opi/RoleplaySetupScreen';

export interface RoleplayReplayRequest {
  scenario: RoleplayScenarioPublic;
  hiddenGoal: string;
  complication: string;
  token: number;
}

interface RoleplayModuleProps {
  config: MissionConfig;
  vocabItems: VocabItem[];
  initialLevel?: IlrBaseLevel;
  replayRequest?: RoleplayReplayRequest | null;
  onConsumeReplay?: () => void;
  onBackToTestPrep: () => void;
  onCallActiveChange?: (active: boolean) => void;
  onSaveVocab: SaveVocabFn;
  onCompleteSession: (session: OpiSession) => void;
}

export const RoleplayModule: React.FC<RoleplayModuleProps> = ({
  config,
  vocabItems,
  initialLevel = 2,
  replayRequest,
  onConsumeReplay,
  onBackToTestPrep,
  onCallActiveChange,
  onSaveVocab,
  onCompleteSession,
}) => {
  const dialectInfo = getDialectInfo(config.language, config.dialect);

  const [level, setLevel] = useState<IlrBaseLevel>(replayRequest?.scenario.level ?? initialLevel);
  const [scenario, setScenario] = useState<RoleplayScenarioPublic | null>(replayRequest?.scenario ?? null);
  const [knownTwist, setKnownTwist] = useState<{hiddenGoal: string; complication: string} | null>(
    replayRequest ? {hiddenGoal: replayRequest.hiddenGoal, complication: replayRequest.complication} : null
  );
  const [isLoadingScenario, setIsLoadingScenario] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  // Active call state (reuses OpiCallScreen)
  const [callActive, setCallActive] = useState(false);
  const [messages, setMessages] = useState<OpiMessage[]>([]);
  const [assessments, setAssessments] = useState<TurnAssessment[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [complicationIntroduced, setComplicationIntroduced] = useState(false);
  const [draftResponse, setDraftResponse] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);

  const wordLookup = useWordLookup({config, vocabItems, onSaveVocab, vocabSource: 'opi', omitDomain: true});
  const tts = useSpeechSynthesis();
  const stt = useSpeechRecognition();
  const callAudio = useCallAudio();

  const callActiveRef = useRef(false);
  const isMutedRef = useRef(false);
  const messagesRef = useRef<OpiMessage[]>([]);
  const assessmentsRef = useRef<TurnAssessment[]>([]);
  const elapsedRef = useRef(0);
  const complicationRef = useRef(false);
  const consumedReplayTokenRef = useRef<number | null>(null);
  const loadSeqRef = useRef(0);

  useEffect(() => {
    callActiveRef.current = callActive;
    onCallActiveChange?.(callActive);
  }, [callActive, onCallActiveChange]);

  useEffect(() => {
    return () => {
      onCallActiveChange?.(false);
    };
  }, [onCallActiveChange]);

  useEffect(() => {
    isMutedRef.current = callAudio.isMuted;
  }, [callAudio.isMuted]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    assessmentsRef.current = assessments;
  }, [assessments]);

  useEffect(() => {
    elapsedRef.current = elapsedSeconds;
  }, [elapsedSeconds]);

  useEffect(() => {
    complicationRef.current = complicationIntroduced;
  }, [complicationIntroduced]);

  // Apply explicit replay request cleanly when triggered from Debrief
  useEffect(() => {
    if (!replayRequest) return;
    if (consumedReplayTokenRef.current === replayRequest.token) return;
    consumedReplayTokenRef.current = replayRequest.token;
    setLevel(replayRequest.scenario.level);
    setScenario(replayRequest.scenario);
    setKnownTwist({hiddenGoal: replayRequest.hiddenGoal, complication: replayRequest.complication});
    setSetupError(null);
    onConsumeReplay?.();
  }, [replayRequest, onConsumeReplay]);

  const loadScenarioForLevel = useCallback(
    async (targetLevel: IlrBaseLevel) => {
      const seq = ++loadSeqRef.current;
      setIsLoadingScenario(true);
      setSetupError(null);
      try {
        const fetched = await fetchRoleplayScenario({
          language: config.language,
          dialect: dialectInfo.id,
          level: targetLevel,
        });
        if (seq !== loadSeqRef.current) return;
        setScenario(fetched);
      } catch (err) {
        if (seq !== loadSeqRef.current) return;
        setSetupError(err instanceof Error ? err.message : 'Unable to generate role-play scenario.');
      } finally {
        if (seq === loadSeqRef.current) setIsLoadingScenario(false);
      }
    },
    [config.language, dialectInfo.id]
  );

  // Load a scenario automatically whenever there is no active replay/scenario matching language/dialect/level
  useEffect(() => {
    if (callActive) return;
    if (
      scenario &&
      scenario.language === config.language &&
      scenario.dialect === dialectInfo.id &&
      scenario.level === level
    ) {
      return;
    }
    setKnownTwist(null);
    void loadScenarioForLevel(level);
  }, [callActive, config.language, dialectInfo.id, level, scenario, loadScenarioForLevel]);

  // Wall-clock elapsed timer while call is active
  useEffect(() => {
    if (sessionStartedAt === null || !callActive) return;
    const id = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - sessionStartedAt) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [sessionStartedAt, callActive]);

  useEffect(() => {
    if (!callActive) return;
    const combined = `${stt.finalTranscript} ${stt.interimTranscript}`.trim();
    if (combined) {
      setDraftResponse(combined);
    }
  }, [callActive, stt.finalTranscript, stt.interimTranscript]);

  const candidateTurns = useMemo(() => messages.filter((m) => m.role === 'candidate').length, [messages]);

  const startListeningIfUnmuted = useCallback(() => {
    if (!callActiveRef.current || isMutedRef.current || !stt.supported) return;
    stt.resetTranscript();
    stt.startListening({lang: dialectInfo.bcp47, continuous: true});
  }, [dialectInfo.bcp47, stt]);

  const speakCharacterTurn = useCallback(
    (text: string) => {
      if (!config.autoSpeakExaminer) {
        startListeningIfUnmuted();
        return;
      }
      tts.speak(text, {
        lang: dialectInfo.bcp47,
        rate: config.speechRate,
        voiceURI: config.voiceURI,
        onEnd: () => {
          startListeningIfUnmuted();
        },
      });
    },
    [config.autoSpeakExaminer, config.speechRate, config.voiceURI, dialectInfo.bcp47, startListeningIfUnmuted, tts]
  );

  const handleChangeLevel = (nextLevel: IlrBaseLevel) => {
    setLevel(nextLevel);
    setKnownTwist(null);
    setScenario(null);
  };

  const handleRefreshScenario = () => {
    setKnownTwist(null);
    void loadScenarioForLevel(level);
  };

  const handleStartCall = async () => {
    if (!scenario || isThinking) return;

    tts.stop();
    stt.stopListening();
    stt.resetTranscript();
    wordLookup.close();
    callAudio.setMuted(false);

    setMessages([]);
    setAssessments([]);
    assessmentsRef.current = [];
    setComplicationIntroduced(false);
    complicationRef.current = false;
    setDraftResponse('');
    setElapsedSeconds(0);
    setCallError(null);
    setSessionStartedAt(Date.now());
    setCallActive(true);
    setIsThinking(true);

    void callAudio.startCapture();

    try {
      const openTurn = await requestRoleplayTurn({
        scenarioId: scenario.scenarioId,
        scenarioToken: scenario.scenarioToken,
        language: config.language,
        dialect: dialectInfo.id,
        level: scenario.level,
        situationEnglish: scenario.situationEnglish,
        learnerGoal: scenario.learnerGoal,
        register: scenario.register,
        characterRole: scenario.characterRole,
        candidateTurnCount: 0,
        elapsedSeconds: 0,
        complicationIntroduced: false,
        ...(knownTwist ? {knownHiddenGoal: knownTwist.hiddenGoal, knownComplication: knownTwist.complication} : {}),
        history: [],
        isOpening: true,
      });

      const workingLvl = scenario.level;
      const probeLvl = workingLvl === 1 ? 2 : 3;
      const openMsg: OpiMessage = {
        id: createId('rp-ex'),
        role: 'examiner',
        text: openTurn.characterText,
        timestamp: new Date().toISOString(),
        elapsedSeconds: 0,
        workingLevel: workingLvl,
        probeLevel: probeLvl,
        phase: 'roleplay',
        targetFunctionKey: openTurn.assessment.functionKey,
      };
      setMessages([openMsg]);
      setComplicationIntroduced(openTurn.complicationIntroduced);
      speakCharacterTurn(openTurn.characterText);
    } catch (err) {
      setCallError(err instanceof Error ? err.message : 'Unable to start role-play call.');
    } finally {
      setIsThinking(false);
    }
  };

  const handleSendResponse = async (overrideText?: string) => {
    if (!scenario) return;
    const cleanText = (overrideText ?? draftResponse).trim();
    if (!cleanText || isThinking) return;

    stt.stopListening();
    stt.resetTranscript();
    tts.stop();
    setDraftResponse('');
    setCallError(null);

    const currentElapsed = elapsedRef.current;
    const workingLvl = scenario.level;
    const probeLvl = workingLvl === 1 ? 2 : 3;

    const candidateMsg: OpiMessage = {
      id: createId('rp-cand'),
      role: 'candidate',
      text: cleanText,
      timestamp: new Date().toISOString(),
      elapsedSeconds: currentElapsed,
      workingLevel: workingLvl,
      probeLevel: probeLvl,
      phase: 'roleplay',
    };

    const nextMessages = [...messagesRef.current, candidateMsg];
    setMessages(nextMessages);
    setIsThinking(true);

    try {
      const turn = await requestRoleplayTurn({
        scenarioId: scenario.scenarioId,
        scenarioToken: scenario.scenarioToken,
        language: config.language,
        dialect: dialectInfo.id,
        level: scenario.level,
        situationEnglish: scenario.situationEnglish,
        learnerGoal: scenario.learnerGoal,
        register: scenario.register,
        characterRole: scenario.characterRole,
        candidateTurnCount: candidateTurns + 1,
        elapsedSeconds: currentElapsed,
        complicationIntroduced: complicationRef.current,
        ...(knownTwist ? {knownHiddenGoal: knownTwist.hiddenGoal, knownComplication: knownTwist.complication} : {}),
        history: nextMessages.map((m) => ({role: m.role, text: m.text})),
        userMessage: cleanText,
      });

      const assessment: TurnAssessment = {
        functionKey: turn.assessment.functionKey,
        outcome: turn.assessment.outcome,
        evidence: turn.assessment.evidence,
        phase: 'roleplay',
        targetLevel: scenario.level,
      };
      const nextAssessments = [...assessmentsRef.current, assessment];
      assessmentsRef.current = nextAssessments;
      setAssessments(nextAssessments);
      setComplicationIntroduced(turn.complicationIntroduced);

      const charMsg: OpiMessage = {
        id: createId('rp-ex'),
        role: 'examiner',
        text: turn.characterText,
        timestamp: new Date().toISOString(),
        elapsedSeconds: elapsedRef.current,
        workingLevel: workingLvl,
        probeLevel: probeLvl,
        phase: 'roleplay',
        targetFunctionKey: turn.assessment.functionKey,
      };
      setMessages((prev) => [...prev, charMsg]);
      speakCharacterTurn(turn.characterText);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'scenario_expired') {
        // The scenario can't continue, but nothing the learner said is lost: End call grades what was said.
        setCallError(`${err.message} Tap End call to see feedback on what you said so far.`);
      } else {
        // Put the answer back in the box and out of the transcript so it can be sent again, not counted twice.
        messagesRef.current = messagesRef.current.filter((m) => m.id !== candidateMsg.id);
        setMessages((prev) => prev.filter((m) => m.id !== candidateMsg.id));
        setDraftResponse(cleanText);
        setCallError(
          `${err instanceof Error ? err.message : 'Role-play turn failed.'} Your answer is kept below: tap Send to try again.`
        );
      }
    } finally {
      setIsThinking(false);
    }
  };

  const handleToggleMute = () => {
    const nextMuted = callAudio.toggleMuted();
    if (nextMuted) {
      stt.stopListening();
    } else if (!tts.isSpeaking && !isThinking && stt.supported) {
      stt.resetTranscript();
      stt.startListening({lang: dialectInfo.bcp47, continuous: true});
    }
  };

  const handleRepeat = async () => {
    if (!scenario || isThinking) return;
    const lastChar = [...messagesRef.current].reverse().find((m) => m.role === 'examiner');
    if (!lastChar) return;

    stt.stopListening();
    tts.stop();
    setCallError(null);
    setIsThinking(true);

    try {
      const turn = await requestRoleplayTurn({
        scenarioId: scenario.scenarioId,
        scenarioToken: scenario.scenarioToken,
        language: config.language,
        dialect: dialectInfo.id,
        level: scenario.level,
        situationEnglish: scenario.situationEnglish,
        learnerGoal: scenario.learnerGoal,
        register: scenario.register,
        characterRole: scenario.characterRole,
        candidateTurnCount: candidateTurns,
        elapsedSeconds: elapsedRef.current,
        complicationIntroduced: complicationRef.current,
        ...(knownTwist ? {knownHiddenGoal: knownTwist.hiddenGoal, knownComplication: knownTwist.complication} : {}),
        history: messagesRef.current.map((m) => ({role: m.role, text: m.text})),
        isRepeat: true,
        lastExaminerText: lastChar.text,
      });

      const workingLvl = scenario.level;
      const probeLvl = workingLvl === 1 ? 2 : 3;
      const repeatMsg: OpiMessage = {
        id: createId('rp-ex'),
        role: 'examiner',
        text: turn.characterText,
        timestamp: new Date().toISOString(),
        elapsedSeconds: elapsedRef.current,
        workingLevel: workingLvl,
        probeLevel: probeLvl,
        phase: 'roleplay',
      };
      setMessages((prev) => [...prev, repeatMsg]);
      speakCharacterTurn(turn.characterText);
    } catch {
      speakCharacterTurn(lastChar.text);
    } finally {
      setIsThinking(false);
    }
  };

  const handleEndCall = async () => {
    if (!scenario) return;
    tts.stop();
    stt.stopListening();
    const audioBlob = await callAudio.stopCapture();

    const finalDuration = Math.max(elapsedRef.current, messagesRef.current.length * 15);
    const sessionId = createId('rp');
    let savedAudio = false;
    if (audioBlob) {
      savedAudio = await saveLastOpiAudio(sessionId, audioBlob, finalDuration);
    }

    const workingLvl = scenario.level;
    const probeLvl = workingLvl === 1 ? 2 : 3;
    const finalMessages = [...messagesRef.current];
    const draft = draftResponse.trim();
    if (draft) {
      finalMessages.push({
        id: createId('rp-cand'),
        role: 'candidate',
        text: draft,
        timestamp: new Date().toISOString(),
        elapsedSeconds: elapsedRef.current,
        workingLevel: workingLvl,
        probeLevel: probeLvl,
        phase: 'roleplay',
      });
    }

    const capturedAssessments = [...assessmentsRef.current];
    setSessionStartedAt(null);
    setCallActive(false);
    setDraftResponse('');

    const session: OpiSession = {
      id: sessionId,
      type: 'roleplay',
      language: config.language,
      dialect: config.dialect,
      mode: 'practice',
      focusLevel: scenario.level,
      durationTargetSeconds: ROLEPLAY_DURATION_SECONDS,
      hasLocalAudio: savedAudio,
      startedAt: new Date().toISOString(),
      durationSeconds: finalDuration,
      messages: finalMessages,
      assessments: capturedAssessments,
      roleplayScenario: scenario,
    };

    onCompleteSession(session);
  };

  if (callActive && scenario) {
    return (
      <OpiCallScreen
        config={config}
        mode="practice"
        workingLevel={scenario.level}
        probeLevel={scenario.level === 1 ? 2 : 3}
        elapsedSeconds={elapsedSeconds}
        phase="roleplay"
        messages={messages}
        isThinking={isThinking}
        isExaminerSpeaking={tts.isSpeaking}
        isListening={stt.isListening}
        isMuted={callAudio.isMuted}
        micLevel={callAudio.micLevel}
        sttSupported={stt.supported}
        sttUnavailable={stt.failed}
        sttError={stt.error ?? callAudio.micError}
        ttsUnsupported={!tts.supported}
        ttsBlocked={tts.blocked}
        onPlayBlocked={tts.playBlocked}
        onRetryStart={() => {
          void callAudio.stopCapture().then(() => handleStartCall());
        }}
        apiError={callError}
        draftResponse={draftResponse}
        wordLookup={wordLookup}
        callTitle={`Role-play · Level ${scenario.level}`}
        speakerLabel={scenario.characterRole}
        situationReminder={{
          situationEnglish: scenario.situationEnglish,
          learnerGoal: scenario.learnerGoal,
          register: scenario.register,
          characterRole: scenario.characterRole,
        }}
        onChangeDraft={setDraftResponse}
        onSendResponse={handleSendResponse}
        onToggleMute={handleToggleMute}
        onRepeatExaminer={handleRepeat}
        onEndCall={handleEndCall}
        onSpeakText={(text) =>
          tts.speak(text, {lang: dialectInfo.bcp47, rate: config.speechRate, voiceURI: config.voiceURI})
        }
        onSaveVocab={onSaveVocab}
      />
    );
  }

  return (
    <RoleplaySetupScreen
      config={config}
      level={level}
      scenario={scenario}
      knownTwist={knownTwist}
      isLoadingScenario={isLoadingScenario}
      isStartingCall={isThinking}
      error={setupError}
      onChangeLevel={handleChangeLevel}
      onRefreshScenario={handleRefreshScenario}
      onClearReplayTwist={() => setKnownTwist(null)}
      onBack={onBackToTestPrep}
      onStartCall={() => void handleStartCall()}
    />
  );
};
