import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {getFunctionLevel, type IlrFunctionKey} from '../data/ilrSpeakingLevels';
import type {
  BriefItem,
  MissionConfig,
  OpiCallMode,
  OpiFocusLevel,
  OpiMessage,
  OpiPhase,
  OpiProbeLevel,
  OpiSession,
  OpiTopicSource,
  OpiWorkingLevel,
  RoleplayScenarioPublic,
  TurnAssessment,
  VocabItem,
} from '../types';
import {getDialectInfo} from '../utils/ilrLogic';
import {
  determineNextOpiStep,
  OPI_STANDARD_DURATION_SECONDS,
  OPI_TARGETED_RETRY_DURATION_SECONDS,
} from '../utils/opiLogic';
import {saveLastOpiAudio} from '../utils/opiAudioStore';
import {fetchRoleplayScenario, requestOpiTurn, requestRoleplayTurn} from '../services/api';
import {useSpeechRecognition, useSpeechSynthesis} from '../hooks/useSpeech';
import {useCallAudio} from '../hooks/useCallAudio';
import {type SaveVocabFn, useWordLookup} from '../hooks/useWordLookup';
import {createId} from '../utils/ids';
import {OpiSetupScreen} from './opi/OpiSetupScreen';
import {OpiCallScreen} from './opi/OpiCallScreen';

export interface TargetedRetryRequest {
  functionKey: IlrFunctionKey;
  token: number;
}

interface OpiSimulatorModuleProps {
  config: MissionConfig;
  vocabItems: VocabItem[];
  briefStory?: BriefItem | null;
  targetedRetryRequest?: TargetedRetryRequest | null;
  onConsumeTargetedRetry?: () => void;
  onCallActiveChange?: (active: boolean) => void;
  onSaveVocab: SaveVocabFn;
  onCompleteSession: (session: OpiSession) => void;
}

export const OpiSimulatorModule: React.FC<OpiSimulatorModuleProps> = ({
  config,
  vocabItems,
  briefStory,
  targetedRetryRequest,
  onConsumeTargetedRetry,
  onCallActiveChange,
  onSaveVocab,
  onCompleteSession,
}) => {
  const dialectInfo = getDialectInfo(config.language, config.dialect);

  // Setup preferences — Exam mode default, Focus adaptive default, Role-play ON default, Examiner's choice default
  const [callMode, setCallMode] = useState<OpiCallMode>('exam');
  const [focusLevel, setFocusLevel] = useState<OpiFocusLevel>('adaptive');
  const [includeRoleplay, setIncludeRoleplay] = useState(true);
  const [topicSource, setTopicSource] = useState<OpiTopicSource>(briefStory ? 'brief' : 'examiner_choice');
  const [prevStoryId, setPrevStoryId] = useState(briefStory?.id);

  if (briefStory && briefStory.id !== prevStoryId) {
    setPrevStoryId(briefStory.id);
    setTopicSource('brief');
  }

  // Active call state (client holds adaptive ILR state; server validates each turn)
  const [callActive, setCallActive] = useState(false);
  const [activeTargetFunction, setActiveTargetFunction] = useState<IlrFunctionKey | undefined>(undefined);
  const [durationTargetSeconds, setDurationTargetSeconds] = useState<number>(OPI_STANDARD_DURATION_SECONDS);
  const [messages, setMessages] = useState<OpiMessage[]>([]);
  const [assessments, setAssessments] = useState<TurnAssessment[]>([]);
  const [workingLevel, setWorkingLevel] = useState<OpiWorkingLevel>(2);
  const [probeLevel, setProbeLevel] = useState<OpiProbeLevel>(3);
  const [phase, setPhase] = useState<OpiPhase>('warmup');
  const [currentFunctionKey, setCurrentFunctionKey] = useState<IlrFunctionKey | undefined>(undefined);
  const [roleplayDone, setRoleplayDone] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [draftResponse, setDraftResponse] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const wordLookup = useWordLookup({config, vocabItems, onSaveVocab, vocabSource: 'opi', omitDomain: true});
  const tts = useSpeechSynthesis();
  const stt = useSpeechRecognition();
  const callAudio = useCallAudio();

  const callActiveRef = useRef(false);
  const isMutedRef = useRef(false);
  const messagesRef = useRef<OpiMessage[]>([]);
  const assessmentsRef = useRef<TurnAssessment[]>([]);
  const elapsedRef = useRef(0);
  const roleplayDoneRef = useRef(false);
  const activeRoleplayRef = useRef<RoleplayScenarioPublic | null>(null);
  const roleplayTurnsCountRef = useRef(0);
  const roleplayComplicationRef = useRef(false);
  const roleplayResolvedRef = useRef(false);
  const lastConsumedRetryTokenRef = useRef<number | null>(null);

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
    roleplayDoneRef.current = roleplayDone;
  }, [roleplayDone]);

  // Wall-clock elapsed timer while call is active
  useEffect(() => {
    if (sessionStartedAt === null || !callActive) return;
    const id = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - sessionStartedAt) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [sessionStartedAt, callActive]);

  // Mirror speech recognition transcript into draftResponse while listening
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

  const speakExaminerTurn = useCallback(
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

  const launchCall = useCallback(
    async (options?: {targetFunctionKey?: IlrFunctionKey}) => {
      const targetFn = options?.targetFunctionKey;
      const targetDuration = targetFn ? OPI_TARGETED_RETRY_DURATION_SECONDS : OPI_STANDARD_DURATION_SECONDS;
      const effectiveFocus: OpiFocusLevel = callMode === 'exam' ? 'adaptive' : focusLevel;
      const initStep = determineNextOpiStep({
        elapsedSeconds: 0,
        candidateTurnCount: 0,
        currentPhase: targetFn ? 'probe' : 'warmup',
        workingLevel: effectiveFocus === 'adaptive' ? 2 : effectiveFocus,
        focusLevel: effectiveFocus,
        includeRoleplay,
        roleplayDone: false,
        assessments: [],
        durationTargetSeconds: targetDuration,
        targetFunctionKey: targetFn,
      });

      tts.stop();
      stt.stopListening();
      stt.resetTranscript();
      wordLookup.close();
      callAudio.setMuted(false);

      setActiveTargetFunction(targetFn);
      setDurationTargetSeconds(targetDuration);
      setMessages([]);
      setAssessments([]);
      assessmentsRef.current = [];
      setRoleplayDone(false);
      roleplayDoneRef.current = false;
      activeRoleplayRef.current = null;
      roleplayTurnsCountRef.current = 0;
      roleplayComplicationRef.current = false;
      roleplayResolvedRef.current = false;
      setDraftResponse('');
      setElapsedSeconds(0);
      setPhase(initStep.phase);
      setWorkingLevel(initStep.workingLevel);
      setProbeLevel(initStep.probeLevel);
      setCurrentFunctionKey(initStep.targetFunctionKey);
      setApiError(null);
      setSessionStartedAt(Date.now());
      setCallActive(true);
      setIsThinking(true);

      // Start local mic recording + waveform analyser (gracefully degrades if mic denied)
      void callAudio.startCapture();

      try {
        const turn = await requestOpiTurn({
          language: config.language,
          dialect: dialectInfo.id,
          phase: initStep.phase,
          workingLevel: initStep.workingLevel,
          probeLevel: initStep.probeLevel,
          focusLevel: effectiveFocus,
          includeRoleplay,
          roleplayDone: false,
          topicSource,
          briefStory: topicSource === 'brief' && briefStory ? briefStory : undefined,
          targetFunctionKey: targetFn,
          assessments: [],
          elapsedSeconds: 0,
          durationTargetSeconds: targetDuration,
          candidateTurnCount: 0,
          history: [],
          isOpening: true,
        });

        const openingMsg: OpiMessage = {
          id: createId('opi-ex'),
          role: 'examiner',
          text: turn.examinerText,
          timestamp: new Date().toISOString(),
          elapsedSeconds: 0,
          workingLevel: turn.workingLevel,
          probeLevel: turn.probeLevel,
          phase: turn.phase,
          targetFunctionKey: turn.targetFunctionKey,
          probeReason: turn.nextReason,
        };
        setMessages([openingMsg]);
        setWorkingLevel(turn.workingLevel);
        setProbeLevel(turn.probeLevel);
        setPhase(turn.phase);
        setCurrentFunctionKey(turn.targetFunctionKey);
        speakExaminerTurn(turn.examinerText);
      } catch (err) {
        setApiError(err instanceof Error ? err.message : 'Unable to start OPI call.');
      } finally {
        setIsThinking(false);
      }
    },
    [
      callAudio,
      callMode,
      config.language,
      dialectInfo.id,
      focusLevel,
      includeRoleplay,
      speakExaminerTurn,
      stt,
      topicSource,
      briefStory,
      tts,
      wordLookup,
    ]
  );

  // Auto-launch targeted 3-minute retry drill when triggered from Debrief
  useEffect(() => {
    if (!targetedRetryRequest) return;
    if (lastConsumedRetryTokenRef.current === targetedRetryRequest.token) return;
    lastConsumedRetryTokenRef.current = targetedRetryRequest.token;
    onConsumeTargetedRetry?.();
    void launchCall({targetFunctionKey: targetedRetryRequest.functionKey});
  }, [targetedRetryRequest, onConsumeTargetedRetry, launchCall]);

  const handleSendResponse = async (overrideText?: string) => {
    const cleanText = (overrideText ?? draftResponse).trim();
    if (!cleanText || isThinking) return;

    stt.stopListening();
    stt.resetTranscript();
    tts.stop();
    setDraftResponse('');
    setApiError(null);

    const currentElapsed = elapsedRef.current;
    const candidatePhase = phase;
    const candidateWorking = workingLevel;
    const candidateProbe = probeLevel;
    const effectiveFocus: OpiFocusLevel = callMode === 'exam' ? 'adaptive' : focusLevel;

    const candidateMsg: OpiMessage = {
      id: createId('opi-cand'),
      role: 'candidate',
      text: cleanText,
      timestamp: new Date().toISOString(),
      elapsedSeconds: currentElapsed,
      workingLevel: candidateWorking,
      probeLevel: candidateProbe,
      phase: candidatePhase,
      targetFunctionKey: currentFunctionKey,
    };

    const nextMessages = [...messagesRef.current, candidateMsg];
    setMessages(nextMessages);

    const nextRpTurns =
      candidatePhase === 'roleplay' ? roleplayTurnsCountRef.current + 1 : roleplayTurnsCountRef.current;
    const stepPlan = determineNextOpiStep({
      elapsedSeconds: currentElapsed,
      candidateTurnCount: candidateTurns + 1,
      currentPhase: candidatePhase,
      workingLevel: candidateWorking,
      focusLevel: effectiveFocus,
      includeRoleplay,
      roleplayDone: roleplayDoneRef.current,
      roleplayTurnsCount: nextRpTurns,
      roleplayResolved: roleplayResolvedRef.current,
      assessments: assessmentsRef.current,
      durationTargetSeconds,
      targetFunctionKey: activeTargetFunction,
      lastCandidateText: cleanText,
    });

    // If transitioning out of an active roleplay (resolved or max turns), lock roleplayDone = true
    if (candidatePhase === 'roleplay' && stepPlan.phase !== 'roleplay' && !roleplayDoneRef.current) {
      roleplayDoneRef.current = true;
      setRoleplayDone(true);
    }

    setIsThinking(true);
    try {
      // Branch 1: Entering Role-play hook inside OPI — fetch level-matched civilian scenario, read English situation aloud, then start character
      if (stepPlan.phase === 'roleplay' && !activeRoleplayRef.current) {
        const scenario = await fetchRoleplayScenario({
          language: config.language,
          dialect: dialectInfo.id,
          level: stepPlan.probeLevel,
        });
        activeRoleplayRef.current = scenario;
        roleplayTurnsCountRef.current = 0;
        roleplayComplicationRef.current = false;
        roleplayResolvedRef.current = false;

        const openRp = await requestRoleplayTurn({
          scenarioId: scenario.scenarioId,
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
          history: [],
          isOpening: true,
        });

        const englishSetupCue = `Let us try a brief role-play. ${scenario.situationEnglish} Your goal: ${scenario.learnerGoal}`;
        const combinedText = `${englishSetupCue}\n\n${openRp.characterText}`;
        const examinerMsg: OpiMessage = {
          id: createId('opi-ex'),
          role: 'examiner',
          text: combinedText,
          timestamp: new Date().toISOString(),
          elapsedSeconds: elapsedRef.current,
          workingLevel: stepPlan.workingLevel,
          probeLevel: stepPlan.probeLevel,
          phase: 'roleplay',
          targetFunctionKey: openRp.assessment.functionKey,
          probeReason: stepPlan.reason,
        };
        setMessages((prev) => [...prev, examinerMsg]);
        setWorkingLevel(stepPlan.workingLevel);
        setProbeLevel(stepPlan.probeLevel);
        setPhase('roleplay');
        setCurrentFunctionKey(openRp.assessment.functionKey);

        if (config.autoSpeakExaminer) {
          tts.speak(englishSetupCue, {
            lang: 'en-US',
            rate: 1.0,
            onEnd: () => speakExaminerTurn(openRp.characterText),
          });
        } else {
          startListeningIfUnmuted();
        }
        return;
      }

      // Branch 2: Continuing active Role-play turns inside OPI
      if (stepPlan.phase === 'roleplay' && activeRoleplayRef.current) {
        const sc = activeRoleplayRef.current;
        roleplayTurnsCountRef.current = nextRpTurns;
        const rpTurn = await requestRoleplayTurn({
          scenarioId: sc.scenarioId,
          language: config.language,
          dialect: dialectInfo.id,
          level: sc.level,
          situationEnglish: sc.situationEnglish,
          learnerGoal: sc.learnerGoal,
          register: sc.register,
          characterRole: sc.characterRole,
          candidateTurnCount: nextRpTurns,
          elapsedSeconds: currentElapsed,
          complicationIntroduced: roleplayComplicationRef.current,
          history: nextMessages.filter((m) => m.phase === 'roleplay').map((m) => ({role: m.role, text: m.text})),
          userMessage: cleanText,
        });

        roleplayComplicationRef.current = rpTurn.complicationIntroduced;
        roleplayResolvedRef.current = rpTurn.resolved;
        if (rpTurn.resolved || nextRpTurns >= 3) {
          roleplayDoneRef.current = true;
          setRoleplayDone(true);
        }

        const rpAssessment: TurnAssessment = {
          functionKey: rpTurn.assessment.functionKey,
          outcome: rpTurn.assessment.outcome,
          evidence: rpTurn.assessment.evidence,
          phase: 'roleplay',
          targetLevel: sc.level,
        };
        const updatedAssessments = [...assessmentsRef.current, rpAssessment];
        assessmentsRef.current = updatedAssessments;
        setAssessments(updatedAssessments);

        const examinerMsg: OpiMessage = {
          id: createId('opi-ex'),
          role: 'examiner',
          text: rpTurn.characterText,
          timestamp: new Date().toISOString(),
          elapsedSeconds: elapsedRef.current,
          workingLevel: candidateWorking,
          probeLevel: candidateProbe,
          phase: 'roleplay',
          targetFunctionKey: rpTurn.assessment.functionKey,
          probeReason: `Role-play (${rpTurn.stage})`,
        };
        setMessages((prev) => [...prev, examinerMsg]);
        setPhase('roleplay');
        setCurrentFunctionKey(rpTurn.assessment.functionKey);
        speakExaminerTurn(rpTurn.characterText);
        return;
      }

      // Branch 3: Standard OPI Examiner Turn (warmup / level_check / probe / wind_down)
      const turn = await requestOpiTurn({
        language: config.language,
        dialect: dialectInfo.id,
        phase: stepPlan.phase,
        workingLevel: stepPlan.workingLevel,
        probeLevel: stepPlan.probeLevel,
        focusLevel: effectiveFocus,
        includeRoleplay,
        roleplayDone: roleplayDoneRef.current,
        topicSource,
        briefStory: topicSource === 'brief' && briefStory ? briefStory : undefined,
        targetFunctionKey: activeTargetFunction ?? currentFunctionKey,
        assessments: assessmentsRef.current,
        elapsedSeconds: currentElapsed,
        durationTargetSeconds,
        candidateTurnCount: candidateTurns + 1,
        history: nextMessages.map((m) => ({role: m.role, text: m.text})),
        userMessage: cleanText,
      });

      let updatedAssessments = assessmentsRef.current;
      if (candidatePhase !== 'warmup') {
        const assessedFnKey = turn.lastTurnAssessment.functionKey;
        const enrichedAssessment: TurnAssessment = {
          functionKey: assessedFnKey,
          outcome: turn.lastTurnAssessment.outcome,
          evidence: turn.lastTurnAssessment.evidence,
          phase: candidatePhase,
          targetLevel: getFunctionLevel(assessedFnKey),
        };
        updatedAssessments = [...assessmentsRef.current, enrichedAssessment];
        assessmentsRef.current = updatedAssessments;
        setAssessments(updatedAssessments);
      }

      const examinerMsg: OpiMessage = {
        id: createId('opi-ex'),
        role: 'examiner',
        text: turn.examinerText,
        timestamp: new Date().toISOString(),
        elapsedSeconds: elapsedRef.current,
        workingLevel: turn.workingLevel,
        probeLevel: turn.probeLevel,
        phase: turn.phase,
        targetFunctionKey: turn.targetFunctionKey,
        probeReason: turn.nextReason,
      };
      setMessages((prev) => [...prev, examinerMsg]);
      setWorkingLevel(turn.workingLevel);
      setProbeLevel(turn.probeLevel);
      setPhase(turn.phase);
      setCurrentFunctionKey(turn.targetFunctionKey);
      speakExaminerTurn(turn.examinerText);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Examiner turn failed.');
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

  const handleRepeatExaminer = async () => {
    if (isThinking) return;
    const lastExaminer = [...messagesRef.current].reverse().find((m) => m.role === 'examiner');
    if (!lastExaminer) return;

    stt.stopListening();
    tts.stop();
    setApiError(null);

    setIsThinking(true);
    try {
      const effectiveFocus: OpiFocusLevel = callMode === 'exam' ? 'adaptive' : focusLevel;
      const turn = await requestOpiTurn({
        language: config.language,
        dialect: dialectInfo.id,
        phase,
        workingLevel,
        probeLevel,
        focusLevel: effectiveFocus,
        includeRoleplay,
        roleplayDone: roleplayDoneRef.current,
        topicSource,
        briefStory: topicSource === 'brief' && briefStory ? briefStory : undefined,
        targetFunctionKey: activeTargetFunction ?? currentFunctionKey,
        assessments: assessmentsRef.current,
        elapsedSeconds: elapsedRef.current,
        durationTargetSeconds,
        candidateTurnCount: candidateTurns,
        history: messagesRef.current.map((m) => ({role: m.role, text: m.text})),
        isRepeat: true,
        lastExaminerText: lastExaminer.text,
      });

      const repeatMsg: OpiMessage = {
        id: createId('opi-ex'),
        role: 'examiner',
        text: turn.examinerText,
        timestamp: new Date().toISOString(),
        elapsedSeconds: elapsedRef.current,
        workingLevel: turn.workingLevel,
        probeLevel: turn.probeLevel,
        phase: turn.phase,
        targetFunctionKey: turn.targetFunctionKey,
        probeReason: 'Examiner repeated/clarified the previous question.',
      };
      setMessages((prev) => [...prev, repeatMsg]);
      speakExaminerTurn(turn.examinerText);
    } catch {
      speakExaminerTurn(lastExaminer.text);
    } finally {
      setIsThinking(false);
    }
  };

  const handleEndCall = async () => {
    tts.stop();
    stt.stopListening();
    const audioBlob = await callAudio.stopCapture();

    const finalDuration = Math.max(elapsedRef.current, messagesRef.current.length * 15);
    const sessionId = createId('opi');
    let savedAudio = false;
    if (audioBlob) {
      savedAudio = await saveLastOpiAudio(sessionId, audioBlob, finalDuration);
    }

    const finalMessages = [...messagesRef.current];
    const draft = draftResponse.trim();
    if (draft) {
      finalMessages.push({
        id: createId('opi-cand'),
        role: 'candidate',
        text: draft,
        timestamp: new Date().toISOString(),
        elapsedSeconds: elapsedRef.current,
        workingLevel,
        probeLevel,
        phase,
        targetFunctionKey: currentFunctionKey,
      });
    }

    const capturedAssessments = [...assessmentsRef.current];
    const effectiveFocus: OpiFocusLevel = callMode === 'exam' ? 'adaptive' : focusLevel;

    setSessionStartedAt(null);
    setCallActive(false);
    setDraftResponse('');

    const session: OpiSession = {
      id: sessionId,
      type: 'opi',
      language: config.language,
      dialect: config.dialect,
      mode: callMode,
      focusLevel: effectiveFocus,
      includeRoleplay,
      topicSource,
      ...(topicSource === 'brief' && briefStory ? {briefStory} : {}),
      targetFunctionKey: activeTargetFunction,
      durationTargetSeconds,
      hasLocalAudio: savedAudio,
      startedAt: new Date().toISOString(),
      durationSeconds: finalDuration,
      messages: finalMessages,
      assessments: capturedAssessments,
      ...(activeRoleplayRef.current ? {roleplayScenario: activeRoleplayRef.current} : {}),
    };

    onCompleteSession(session);
  };

  if (callActive) {
    return (
      <OpiCallScreen
        config={config}
        mode={callMode}
        targetFunctionKey={activeTargetFunction ?? currentFunctionKey}
        workingLevel={workingLevel}
        probeLevel={probeLevel}
        elapsedSeconds={elapsedSeconds}
        phase={phase}
        messages={messages}
        isThinking={isThinking}
        isExaminerSpeaking={tts.isSpeaking}
        isListening={stt.isListening}
        isMuted={callAudio.isMuted}
        micLevel={callAudio.micLevel}
        sttSupported={stt.supported}
        sttError={stt.error}
        apiError={apiError}
        draftResponse={draftResponse}
        wordLookup={wordLookup}
        onChangeDraft={setDraftResponse}
        onSendResponse={handleSendResponse}
        onToggleMute={handleToggleMute}
        onRepeatExaminer={handleRepeatExaminer}
        onEndCall={handleEndCall}
        onSpeakText={(text) =>
          tts.speak(text, {lang: dialectInfo.bcp47, rate: config.speechRate, voiceURI: config.voiceURI})
        }
        onSaveVocab={onSaveVocab}
      />
    );
  }

  return (
    <OpiSetupScreen
      config={config}
      mode={callMode}
      focusLevel={focusLevel}
      includeRoleplay={includeRoleplay}
      topicSource={topicSource}
      briefStory={briefStory}
      isStarting={isThinking}
      error={apiError}
      onChangeMode={setCallMode}
      onChangeFocusLevel={setFocusLevel}
      onChangeIncludeRoleplay={setIncludeRoleplay}
      onChangeTopicSource={setTopicSource}
      onStartCall={() => void launchCall()}
    />
  );
};
