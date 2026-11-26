import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  Check,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  Flag,
  Headphones,
  Info,
  Loader2,
  MessageSquare,
  Play,
  RotateCcw,
  Sparkles,
  Volume2,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AppendErrorEventsFn,
  BriefDrill,
  BriefIlrLevel,
  BriefItem,
  DlptDrillMode,
  DlptDrillResult,
  DlptQuestionOutcome,
  DlptTrapType,
  DrillHistoryEntry,
  MissionConfig,
  VocabItem,
} from '../../types';
import {fetchBriefDrill} from '../../services/api';
import {
  buildFixedOrderPassages,
  canAdvancePage,
  CHOICE_LETTERS,
  computeNextAdaptiveLevel,
  getDlptProfileForLanguage,
  getMaxQuestionsForPassage,
  getPlannedPassageCount,
  getUnansweredSummary,
  mediaTypeToDlptSkill,
  pickNextAdaptivePassage,
  QUESTION_TYPE_LABELS,
  TRAP_TYPE_META,
} from '../../utils/dlptRules';
import {type SaveVocabFn, useWordLookup} from '../../hooks/useWordLookup';
import {TappableText} from '../shared/TappableText';
import {WordLookupPopover} from '../shared/WordLookupPopover';
import {createId} from '../../utils/ids';
import {DlptRulesSheet} from './DlptRulesSheet';
import {DlptTrapCard} from './DlptTrapCard';

interface BriefDrillModalProps {
  item: BriefItem;
  allPassages?: BriefItem[];
  config: MissionConfig;
  vocabItems: VocabItem[];
  onClose: () => void;
  onLogHistory: (entry: DrillHistoryEntry) => void;
  onSaveDlptResult: (result: DlptDrillResult) => void;
  onAppendErrorEvents?: AppendErrorEventsFn;
  onSaveVocab: SaveVocabFn;
  onBriefItBack: (item: BriefItem) => void;
}

type SessionStage = 'active' | 'review' | 'finished';

export const BriefDrillModal: React.FC<BriefDrillModalProps> = ({
  item,
  allPassages = [],
  config,
  vocabItems,
  onClose,
  onLogHistory,
  onSaveDlptResult,
  onAppendErrorEvents,
  onSaveVocab,
  onBriefItBack,
}) => {
  const profile = useMemo(() => getDlptProfileForLanguage(item.language), [item.language]);
  const skill = useMemo(() => mediaTypeToDlptSkill(item.mediaType), [item.mediaType]);

  // Pool of candidate passages for multi-passage adaptive (ES) or fixed-order (PT) sessions
  const candidatePool = useMemo(() => {
    const map = new Map<string, BriefItem>();
    map.set(item.id, item);
    for (const p of allPassages) {
      if (p.language === item.language && p.mediaType === item.mediaType) {
        map.set(p.id, p);
      }
    }
    return Array.from(map.values());
  }, [item, allPassages]);

  const plannedPassageCount = useMemo(() => getPlannedPassageCount(item, candidatePool, 3), [item, candidatePool]);

  // Mode: Practice (default) vs Test
  const [mode, setMode] = useState<DlptDrillMode>('practice');
  const [modeLocked, setModeLocked] = useState(false);
  const [rulesSheetOpen, setRulesSheetOpen] = useState(false);

  // Passage lineup: PT pre-builds fixed order; ES starts with [item] and adapts passage by passage
  const [passageLineup, setPassageLineup] = useState<BriefItem[]>(() =>
    profile.adaptive ? [item] : buildFixedOrderPassages(item, candidatePool, plannedPassageCount)
  );
  const [currentPassageIndex, setCurrentPassageIndex] = useState(0);
  const [stage, setStage] = useState<SessionStage>('active');

  // Cached drills keyed by briefId
  const [drillsById, setDrillsById] = useState<Record<string, BriefDrill>>({});
  const [loadingBriefId, setLoadingBriefId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // User selections (questionId -> optionIndex), focused question index on current page, checked pages (Practice), flags (PT)
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [checkedPages, setCheckedPages] = useState<Record<string, boolean>>({});
  const [flaggedPassages, setFlaggedPassages] = useState<Record<string, boolean>>({});
  const [confirmUnansweredSubmit, setConfirmUnansweredSubmit] = useState(false);

  // Audio single-play enforcement & Practice replay-with-transcript state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const replayAudioRef = useRef<HTMLAudioElement | null>(null);
  const [audioPlayedOnce, setAudioPlayedOnce] = useState<Record<string, boolean>>({});
  const [audioPlayingId, setAudioPlayingId] = useState<string | null>(null);
  const [audioErrorById, setAudioErrorById] = useState<Record<string, boolean>>({});
  const [transcriptOpenById, setTranscriptOpenById] = useState<Record<string, boolean>>({});
  const [replayPlayingId, setReplayPlayingId] = useState<string | null>(null);

  // Adaptive step notice in Practice mode
  const [adaptiveStepNote, setAdaptiveStepNote] = useState<string | null>(null);

  // Saved vocab terms & persisted result guard
  const [savedVocabTerms, setSavedVocabTerms] = useState<Set<string>>(new Set());
  const [finalResult, setFinalResult] = useState<DlptDrillResult | null>(null);

  const currentPassage = passageLineup[currentPassageIndex] ?? item;
  const currentDrill = drillsById[currentPassage.id] ?? null;
  const isCurrentPageChecked = Boolean(checkedPages[currentPassage.id]);

  const wordLookup = useWordLookup({
    config,
    vocabItems,
    onSaveVocab,
    vocabSource: 'brief',
    omitDomain: !config.workFocusEnabled,
  });

  // Load drill for current passage whenever currentPassage changes and isn't cached yet
  const loadDrillForPassage = useCallback(
    async (briefId: string) => {
      if (drillsById[briefId]) return;
      setLoadingBriefId(briefId);
      setError(null);
      try {
        const data = await fetchBriefDrill(briefId);
        setDrillsById((prev) => ({...prev, [briefId]: data}));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to generate DLPT drill questions.');
      } finally {
        setLoadingBriefId((curr) => (curr === briefId ? null : curr));
      }
    },
    [drillsById]
  );

  useEffect(() => {
    void loadDrillForPassage(currentPassage.id);
    setActiveQuestionIndex(0);
    setAudioPlayingId(null);
    setReplayPlayingId(null);
  }, [currentPassage.id, loadDrillForPassage]);

  // Stop audio cleanly on unmount
  useEffect(() => {
    const mainAudio = audioRef.current;
    const replayAudio = replayAudioRef.current;
    return () => {
      mainAudio?.pause();
      replayAudio?.pause();
    };
  }, [currentPassage.id]);

  const handleModeSwitch = (nextMode: DlptDrillMode) => {
    if (modeLocked || nextMode === mode) return;
    setMode(nextMode);
  };

  const handleSelectOption = (questionId: string, optionIndex: number, qIdx: number) => {
    if (stage !== 'active') return;
    if (mode === 'practice' && isCurrentPageChecked) return;
    setSelectedAnswers((prev) => ({...prev, [questionId]: optionIndex}));
    setActiveQuestionIndex(qIdx);
  };

  const handlePlayAudioOnce = () => {
    const id = currentPassage.id;
    if (audioPlayedOnce[id] || audioPlayingId === id) return;
    if (!audioRef.current) return;

    setAudioErrorById((prev) => ({...prev, [id]: false}));
    setAudioPlayingId(id);
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {
      setAudioPlayingId(null);
      setAudioErrorById((prev) => ({...prev, [id]: true}));
    });
  };

  const handleReplayWithTranscript = (briefId: string) => {
    setTranscriptOpenById((prev) => ({...prev, [briefId]: true}));
    if (replayAudioRef.current) {
      replayAudioRef.current.currentTime = 0;
      setReplayPlayingId(briefId);
      replayAudioRef.current.play().catch(() => {
        setReplayPlayingId(null);
      });
    }
  };

  const currentQuestionIds = useMemo(
    () => (currentDrill ? currentDrill.questions.map((q) => q.id) : []),
    [currentDrill]
  );

  const canProceedFromCurrentPage = useMemo(
    () => canAdvancePage(profile, currentQuestionIds, selectedAnswers),
    [profile, currentQuestionIds, selectedAnswers]
  );

  const isLastPlannedPassage = currentPassageIndex + 1 >= plannedPassageCount;

  // Build & save complete session result
  const finalizeSession = useCallback(
    (lineupSnapshot: BriefItem[]) => {
      audioRef.current?.pause();
      replayAudioRef.current?.pause();
      setAudioPlayingId(null);
      setReplayPlayingId(null);

      const outcomes: DlptQuestionOutcome[] = [];
      const trapsMissed: Partial<Record<DlptTrapType, number>> = {};
      const dlptErrorEvents: Parameters<AppendErrorEventsFn>[0] = [];
      const resultId = createId('dlpt-res');

      for (const passage of lineupSnapshot) {
        const drill = drillsById[passage.id];
        if (!drill) continue;
        const level: BriefIlrLevel = drill.targetIlrLevel || drill.ilrLevel || passage.ilrLevel;
        for (const q of drill.questions) {
          const picked = selectedAnswers[q.id];
          const answered = typeof picked === 'number';
          const correct = answered && picked === q.correctIndex;
          const pickedChoice = answered && q.choices ? q.choices[picked] : undefined;
          const correctChoice = q.choices ? q.choices[q.correctIndex] : undefined;
          const trapType = !correct && pickedChoice?.trapType ? pickedChoice.trapType : undefined;

          if (trapType) {
            trapsMissed[trapType] = (trapsMissed[trapType] ?? 0) + 1;
            dlptErrorEvents.push({
              key: trapType,
              source: 'dlpt',
              sessionId: resultId,
              wrong: pickedChoice?.text || q.options[picked ?? 0] || TRAP_TYPE_META[trapType].label,
              fix: correctChoice?.text || q.options[q.correctIndex] || q.explanation,
              quote: q.sourceQuote || q.question,
              language: item.language,
            });
          }

          outcomes.push({
            questionId: q.id,
            briefId: passage.id,
            ilrLevel: level,
            questionType: q.questionType ?? 'detail',
            correct,
            answered,
            ...(trapType ? {trapType} : {}),
          });
        }
      }

      const correctCount = outcomes.filter((o) => o.correct).length;
      const totalQuestions = outcomes.length;
      const pct = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

      const result: DlptDrillResult = {
        id: resultId,
        completedAt: new Date().toISOString(),
        language: item.language,
        dialect: item.dialectId,
        skill,
        mode,
        profileId: profile.id,
        passageIds: lineupSnapshot.map((p) => p.id),
        passageLevels: lineupSnapshot.map((p) => p.ilrLevel),
        totalQuestions,
        correctCount,
        outcomes,
        trapsMissed,
      };

      setFinalResult(result);
      setStage('finished');
      onSaveDlptResult(result);
      if (dlptErrorEvents.length > 0) {
        onAppendErrorEvents?.(dlptErrorEvents);
      }

      const historyEntry: DrillHistoryEntry = {
        id: createId('hist-brief'),
        module: 'brief_drill',
        language: item.language,
        dialect: item.dialectId,
        domain: item.matchingDomains?.[0] || 'general_policy',
        completedAt: result.completedAt,
        summary: `DLPT ${skill === 'listening' ? 'Listening' : 'Reading'} (${mode === 'test' ? 'Test' : 'Practice'} · ${correctCount}/${totalQuestions})`,
        scoreLabel: `${pct}% · ${profile.pillLabel}`,
      };
      onLogHistory(historyEntry);
    },
    [drillsById, item, mode, onAppendErrorEvents, onLogHistory, onSaveDlptResult, profile, selectedAnswers, skill]
  );

  // Check answers on current page (Practice mode)
  const handleCheckPracticePage = () => {
    if (!currentDrill) return;
    if (profile.hideNextUntilPageComplete && !canProceedFromCurrentPage) return;
    setModeLocked(true);
    setCheckedPages((prev) => ({...prev, [currentPassage.id]: true}));
    audioRef.current?.pause();
    setAudioPlayingId(null);
  };

  // Advance to next passage (handles ES adaptive routing vs PT fixed order)
  const handleAdvancePassage = () => {
    if (!currentDrill) return;
    if (profile.hideNextUntilPageComplete && !canProceedFromCurrentPage) return;

    setModeLocked(true);
    audioRef.current?.pause();
    replayAudioRef.current?.pause();
    setAudioPlayingId(null);
    setReplayPlayingId(null);

    // For PT Lower-Range on the final passage: open End-of-Session Review screen
    if (!profile.adaptive) {
      if (currentPassageIndex + 1 < passageLineup.length) {
        setCurrentPassageIndex((idx) => idx + 1);
      } else if (profile.allowEndReview && mode === 'test') {
        setConfirmUnansweredSubmit(false);
        setStage('review');
      } else if (profile.allowEndReview && mode === 'practice') {
        // In Practice mode on PT, if any passages were flagged or skipped, offer review; otherwise finish
        const anyFlagged = Object.values(flaggedPassages).some(Boolean);
        const pagesForSummary = passageLineup.map((p) => ({
          questionIds: (drillsById[p.id]?.questions ?? []).map((q) => q.id),
        }));
        const unanswered = getUnansweredSummary(pagesForSummary, selectedAnswers);
        if (anyFlagged || unanswered.totalUnanswered > 0) {
          setConfirmUnansweredSubmit(false);
          setStage('review');
        } else {
          finalizeSession(passageLineup);
        }
      } else {
        finalizeSession(passageLineup);
      }
      return;
    }

    // ES DLPT5-CA adaptive routing
    if (isLastPlannedPassage) {
      finalizeSession(passageLineup);
      return;
    }

    const pageCorrect = currentDrill.questions.filter((q) => selectedAnswers[q.id] === q.correctIndex).length;
    const pageTotal = currentDrill.questions.length;
    const usedIds = new Set(passageLineup.map((p) => p.id));
    const nextPassage = pickNextAdaptivePassage({
      currentLevel: currentPassage.ilrLevel,
      pageCorrect,
      pageTotal,
      candidates: candidatePool,
      usedIds,
      language: item.language,
      mediaType: item.mediaType,
    });

    if (!nextPassage) {
      finalizeSession(passageLineup);
      return;
    }

    const nextTargetLevel = computeNextAdaptiveLevel(currentPassage.ilrLevel, pageCorrect, pageTotal);
    if (mode === 'practice') {
      setAdaptiveStepNote(
        `Adaptive routing: stepped from Level ${currentPassage.ilrLevel} → Level ${nextPassage.ilrLevel} (target ${nextTargetLevel})`
      );
    } else {
      setAdaptiveStepNote(null);
    }

    setPassageLineup((prev) => [...prev, nextPassage]);
    setCurrentPassageIndex((idx) => idx + 1);
  };

  const handlePreviousPassage = () => {
    if (!profile.allowBack || currentPassageIndex === 0) return;
    audioRef.current?.pause();
    replayAudioRef.current?.pause();
    setAudioPlayingId(null);
    setReplayPlayingId(null);
    setCurrentPassageIndex((idx) => Math.max(0, idx - 1));
  };

  const handleSaveVocabTerm = (term: string, meaning: string, excerpt?: string) => {
    onSaveVocab({
      term,
      englishConcept: meaning,
      contextSentence: excerpt?.slice(0, 160) || currentPassage.title,
      registerTag: 'Standard Press',
      category: config.workFocusEnabled ? 'Operational/Military Terms' : 'High-Register Connectors',
      source: 'brief',
      language: item.language,
      dialect: item.dialectId,
    });
    setSavedVocabTerms((prev) => new Set(prev).add(term.toLowerCase()));
  };

  const handleRestartDrill = () => {
    audioRef.current?.pause();
    replayAudioRef.current?.pause();
    setPassageLineup(profile.adaptive ? [item] : buildFixedOrderPassages(item, candidatePool, plannedPassageCount));
    setCurrentPassageIndex(0);
    setStage('active');
    setModeLocked(false);
    setSelectedAnswers({});
    setCheckedPages({});
    setFlaggedPassages({});
    setAudioPlayedOnce({});
    setAudioPlayingId(null);
    setAudioErrorById({});
    setTranscriptOpenById({});
    setReplayPlayingId(null);
    setAdaptiveStepNote(null);
    setConfirmUnansweredSubmit(false);
    setFinalResult(null);
  };

  // Unanswered summary for PT Review screen
  const reviewPagesData = useMemo(
    () =>
      passageLineup.map((p) => ({
        passage: p,
        drill: drillsById[p.id],
        questionIds: (drillsById[p.id]?.questions ?? []).map((q) => q.id),
      })),
    [passageLineup, drillsById]
  );

  const unansweredSummary = useMemo(
    () => getUnansweredSummary(reviewPagesData, selectedAnswers),
    [reviewPagesData, selectedAnswers]
  );

  // Progress bar & header counter
  const currentTotalQuestions =
    currentDrill?.questions.length ?? getMaxQuestionsForPassage(item.language, item.mediaType);
  const displayQuestionNum = Math.min(activeQuestionIndex + 1, Math.max(1, currentTotalQuestions));
  const answeredOnPageCount = currentQuestionIds.filter((id) => typeof selectedAnswers[id] === 'number').length;
  const pageProgressFraction = currentTotalQuestions > 0 ? answeredOnPageCount / currentTotalQuestions : 0;
  const overallProgressPct =
    stage === 'finished'
      ? 100
      : stage === 'review'
        ? 95
        : Math.min(
            98,
            Math.round(((currentPassageIndex + pageProgressFraction) / Math.max(1, plannedPassageCount)) * 100)
          );

  const isLoadingCurrent = loadingBriefId === currentPassage.id && !currentDrill;
  const hasPlayedAudioOnce = Boolean(audioPlayedOnce[currentPassage.id]);
  const isPlayingCurrentAudio = audioPlayingId === currentPassage.id;
  const hasAudioError = Boolean(audioErrorById[currentPassage.id]);
  const showFeedbackOnCurrentPage = mode === 'practice' && isCurrentPageChecked;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="brief-drill-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-5 bg-black/85 backdrop-blur-sm"
    >
      <div className="relative flex flex-col w-full max-w-3xl max-h-[94vh] rounded-2xl border border-[#23303E] bg-[#111922] shadow-2xl overflow-hidden">
        {/* Top Cockpit Header */}
        <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-[#23303E] bg-[#0B1117] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {/* Practice / Test segmented toggle */}
              <div
                role="group"
                aria-label="Drill mode"
                className="inline-flex p-0.5 rounded-lg bg-[#111922] border border-[#23303E]"
              >
                <button
                  type="button"
                  disabled={modeLocked}
                  onClick={() => handleModeSwitch('practice')}
                  className={`px-3 py-1.5 min-h-[36px] rounded-md text-xs font-semibold transition-colors ${
                    mode === 'practice'
                      ? 'bg-[#D99B26] text-[#0B1117]'
                      : 'text-[#94A3B8] hover:text-white disabled:opacity-50'
                  }`}
                >
                  Practice
                </button>
                <button
                  type="button"
                  disabled={modeLocked}
                  onClick={() => handleModeSwitch('test')}
                  className={`px-3 py-1.5 min-h-[36px] rounded-md text-xs font-semibold transition-colors ${
                    mode === 'test'
                      ? 'bg-[#7DD3FC] text-[#0B1117]'
                      : 'text-[#94A3B8] hover:text-white disabled:opacity-50'
                  }`}
                >
                  Test
                </button>
              </div>

              {/* Active DLPT rules pill button (opens rules sheet) */}
              <button
                type="button"
                data-testid="dlpt-rules-pill"
                onClick={() => setRulesSheetOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-full border border-[#7DD3FC]/40 bg-[#7DD3FC]/10 text-[#7DD3FC] hover:bg-[#7DD3FC]/20 font-mono text-[11px] font-medium transition-colors"
              >
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>{profile.pillLabel}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close DLPT drill"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#94A3B8] hover:text-white rounded-xl hover:bg-[#16202B] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Progress bar + Passage x of y · Question x of y */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-mono font-medium text-[#CBD5E1] tabular-nums">
                {stage === 'review'
                  ? `End-of-session review · ${passageLineup.length} passages`
                  : stage === 'finished'
                    ? `Drill complete · ${passageLineup.length} ${passageLineup.length === 1 ? 'passage' : 'passages'}`
                    : `Passage ${currentPassageIndex + 1} of ${plannedPassageCount} · Question ${displayQuestionNum} of ${currentTotalQuestions}`}
              </span>
              <span className="text-[11px] text-[#94A3B8]">
                {skill === 'listening' ? 'Listening' : 'Reading'}
                {mode === 'practice' && stage === 'active' ? ` · ILR ${currentPassage.ilrLevel}` : ''}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[#16202B] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#D99B26] transition-all duration-300"
                style={{width: `${overallProgressPct}%`}}
              />
            </div>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* STAGE: ACTIVE PASSAGE */}
          {stage === 'active' && (
            <>
              {/* Adaptive step notice (Practice mode only) */}
              {adaptiveStepNote && mode === 'practice' && (
                <div className="px-3.5 py-2 rounded-lg border border-[#7DD3FC]/30 bg-[#7DD3FC]/8 text-xs text-[#7DD3FC]">
                  {adaptiveStepNote}
                </div>
              )}

              {/* Passage Orientation & Controls */}
              <div className="rounded-xl border border-[#23303E] bg-[#0B1117] p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0 flex-1">
                    <p
                      data-testid="dlpt-orientation-line"
                      className="text-xs sm:text-sm italic text-[#CBD5E1] leading-relaxed"
                    >
                      {currentDrill?.orientationLine || currentPassage.orientationLine}
                    </p>
                    <h2 id="brief-drill-title" className="text-sm sm:text-base font-semibold text-[#F8FAFC]">
                      {currentPassage.title}
                    </h2>
                    <p className="text-xs text-[#7D8FA3]">
                      {currentPassage.sourceName} · {currentPassage.lengthLabel}
                    </p>
                  </div>

                  {/* PT DLPT5 Lower-Range: Flag to return checkbox */}
                  {profile.allowFlag && (
                    <label className="inline-flex items-center gap-2 px-3 py-2 min-h-[44px] rounded-lg border border-[#23303E] bg-[#111922] hover:border-[#D99B26]/50 cursor-pointer shrink-0 transition-colors">
                      <input
                        type="checkbox"
                        checked={Boolean(flaggedPassages[currentPassage.id])}
                        onChange={(e) =>
                          setFlaggedPassages((prev) => ({...prev, [currentPassage.id]: e.target.checked}))
                        }
                        className="h-4 w-4 accent-[#D99B26] cursor-pointer"
                      />
                      <Flag
                        className={`w-3.5 h-3.5 ${
                          flaggedPassages[currentPassage.id] ? 'text-[#D99B26]' : 'text-[#94A3B8]'
                        }`}
                      />
                      <span className="text-xs font-medium text-[#E2E8F0]">Flag to return</span>
                    </label>
                  )}
                </div>

                {/* Listening Single-Play Audio Control */}
                {currentPassage.mediaType === 'audio' && currentPassage.audioUrl && (
                  <div className="pt-2 border-t border-[#23303E] space-y-2.5">
                    <audio
                      ref={audioRef}
                      key={`single-${currentPassage.id}`}
                      src={currentPassage.audioUrl}
                      preload="none"
                      onPlay={() => {
                        setAudioPlayingId(currentPassage.id);
                      }}
                      onEnded={() => {
                        setAudioPlayingId(null);
                        setAudioPlayedOnce((prev) => ({...prev, [currentPassage.id]: true}));
                      }}
                      onError={() => {
                        setAudioPlayingId(null);
                        setAudioErrorById((prev) => ({...prev, [currentPassage.id]: true}));
                      }}
                    >
                      <track kind="captions" />
                    </audio>

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        data-testid="dlpt-play-audio-btn"
                        disabled={hasPlayedAudioOnce || isPlayingCurrentAudio}
                        onClick={handlePlayAudioOnce}
                        className={`inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold transition-colors ${
                          hasPlayedAudioOnce
                            ? 'bg-[#16202B] text-[#94A3B8] border border-[#23303E] cursor-not-allowed'
                            : isPlayingCurrentAudio
                              ? 'bg-[#7DD3FC]/20 text-[#7DD3FC] border border-[#7DD3FC]/40 cursor-wait'
                              : 'bg-[#D99B26] text-[#0B1117] hover:bg-[#E5AE42]'
                        }`}
                      >
                        {isPlayingCurrentAudio ? (
                          <Volume2 className="w-4 h-4 animate-pulse" />
                        ) : hasPlayedAudioOnce ? (
                          <Headphones className="w-4 h-4" />
                        ) : (
                          <Play className="w-4 h-4 ml-0.5" />
                        )}
                        <span>
                          {hasPlayedAudioOnce
                            ? 'Played once · no replay in test conditions'
                            : isPlayingCurrentAudio
                              ? 'Playing broadcast (1 play only)…'
                              : 'Play audio'}
                        </span>
                      </button>

                      {!hasPlayedAudioOnce && (
                        <span className="text-xs text-[#94A3B8]">
                          You may read questions and select answers while the audio plays.
                        </span>
                      )}
                    </div>

                    {hasAudioError && (
                      <p className="text-xs text-[#F87171]">
                        Stream could not play inline — listen at{' '}
                        <a
                          href={currentPassage.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline text-[#7DD3FC]"
                        >
                          {currentPassage.sourceName}
                        </a>
                        .
                      </p>
                    )}

                    {/* Practice mode post-check: Replay with transcript */}
                    {showFeedbackOnCurrentPage && currentDrill?.studyExcerpt && (
                      <div className="pt-2 border-t border-[#23303E]/70 space-y-3">
                        <audio
                          ref={replayAudioRef}
                          key={`replay-${currentPassage.id}`}
                          src={currentPassage.audioUrl}
                          preload="none"
                          onEnded={() => setReplayPlayingId(null)}
                          onPause={() => setReplayPlayingId(null)}
                        >
                          <track kind="captions" />
                        </audio>
                        <button
                          type="button"
                          onClick={() => handleReplayWithTranscript(currentPassage.id)}
                          className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-xl border border-[#7DD3FC]/45 bg-[#7DD3FC]/10 text-xs sm:text-sm font-semibold text-[#7DD3FC] hover:bg-[#7DD3FC]/20 transition-colors"
                        >
                          <RotateCcw className="w-4 h-4" />
                          <span>
                            {replayPlayingId === currentPassage.id
                              ? 'Replaying with transcript…'
                              : 'Replay with transcript'}
                          </span>
                        </button>

                        {transcriptOpenById[currentPassage.id] && (
                          <div className="space-y-2">
                            <p className="text-xs text-[#94A3B8]">
                              Short study transcript (tap any word to inspect &amp; save to Vocab):
                            </p>
                            <div className="p-3.5 rounded-xl bg-[#111922] border border-[#23303E] text-sm text-[#F8FAFC] leading-relaxed">
                              <TappableText
                                text={currentDrill.studyExcerpt}
                                activeWord={wordLookup.lookup?.word}
                                onWordTap={(w) =>
                                  void wordLookup.lookUpWord(
                                    `drill-tx-${currentPassage.id}`,
                                    w,
                                    currentDrill.studyExcerpt || ''
                                  )
                                }
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Reading Passage Excerpt */}
                {currentPassage.mediaType === 'text' && currentDrill?.studyExcerpt && (
                  <div className="pt-2 border-t border-[#23303E] space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[11px] uppercase tracking-wider text-[#94A3B8]">
                        Reading Passage Excerpt
                      </span>
                      {currentPassage.sourceUrl ? (
                        <a
                          href={currentPassage.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-[#7DD3FC] hover:underline"
                        >
                          <span>Original at {currentPassage.sourceName}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-[#94A3B8]">{currentPassage.sourceName}</span>
                      )}
                    </div>
                    <div className="p-3.5 sm:p-4 rounded-xl bg-[#111922] border border-[#23303E] text-sm sm:text-[15px] text-[#F8FAFC] leading-relaxed">
                      {showFeedbackOnCurrentPage ? (
                        <TappableText
                          text={currentDrill.studyExcerpt}
                          activeWord={wordLookup.lookup?.word}
                          onWordTap={(w) =>
                            void wordLookup.lookUpWord(
                              `drill-rd-${currentPassage.id}`,
                              w,
                              currentDrill.studyExcerpt || ''
                            )
                          }
                        />
                      ) : (
                        <p>{currentDrill.studyExcerpt}</p>
                      )}
                    </div>
                    {showFeedbackOnCurrentPage && (
                      <p className="text-[11px] text-[#94A3B8]">
                        Tap any word in the passage above to look it up and save to Vocab.
                      </p>
                    )}
                  </div>
                )}

                {wordLookup.lookup && (
                  <WordLookupPopover
                    lookup={wordLookup.lookup}
                    onClose={wordLookup.close}
                    onRetry={wordLookup.retry}
                    onSave={wordLookup.save}
                  />
                )}
              </div>

              {/* Loading state */}
              {isLoadingCurrent && (
                <div className="flex flex-col items-center justify-center py-14 gap-3 text-[#94A3B8]">
                  <Loader2 className="w-6 h-6 animate-spin text-[#D99B26]" />
                  <p className="text-sm font-medium">
                    Generating verified DLPT {skill === 'listening' ? 'listening' : 'reading'} items…
                  </p>
                </div>
              )}

              {/* Error state */}
              {error && !isLoadingCurrent && (
                <div className="p-4 rounded-xl border border-[#F87171]/45 bg-[#F87171]/10 text-red-200 text-sm flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 shrink-0 text-[#F87171] mt-0.5" />
                    <div>
                      <p className="font-semibold">Unable to load verified questions</p>
                      <p className="text-xs text-red-200/90 mt-0.5">{error}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadDrillForPassage(currentPassage.id)}
                    className="px-3 py-2 min-h-[44px] rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] shrink-0"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Questions Fieldsets */}
              {currentDrill && !isLoadingCurrent && (
                <div className="space-y-4">
                  {currentDrill.questions.map((q, qIdx) => {
                    const userChoice = selectedAnswers[q.id];
                    const isCorrect = userChoice === q.correctIndex;
                    const qTypeLabel = q.questionType ? QUESTION_TYPE_LABELS[q.questionType] : null;

                    return (
                      <fieldset
                        key={q.id}
                        className="p-4 sm:p-5 rounded-xl border border-[#23303E] bg-[#0B1117] space-y-3.5"
                      >
                        <legend className="sr-only">
                          Question {qIdx + 1}: {q.questionEnglish || q.question}
                        </legend>

                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-[#94A3B8]">
                              <span className="font-mono font-semibold text-[#7DD3FC] tabular-nums">
                                Question {qIdx + 1} of {currentDrill.questions.length}
                              </span>
                              {qTypeLabel && showFeedbackOnCurrentPage && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{qTypeLabel}</span>
                                </>
                              )}
                            </div>
                            <p className="text-sm sm:text-base font-semibold text-[#F8FAFC] leading-snug">
                              {q.questionEnglish || q.question}
                            </p>
                          </div>

                          {showFeedbackOnCurrentPage && (
                            <span className="shrink-0 flex items-center gap-1 text-xs font-semibold">
                              {isCorrect ? (
                                <>
                                  <CheckCircle2 className="w-5 h-5 text-[#7DD3FC]" />
                                  <span className="text-[#7DD3FC]">Correct</span>
                                </>
                              ) : (
                                <>
                                  <XCircle className="w-5 h-5 text-[#F87171]" />
                                  <span className="text-[#F87171]">Missed</span>
                                </>
                              )}
                            </span>
                          )}
                        </div>

                        {/* 4 Radio Choices (>= 44px tall each) */}
                        <div className="space-y-2">
                          {q.options.slice(0, 4).map((optionText, optIdx) => {
                            const letter = CHOICE_LETTERS[optIdx] ?? 'A';
                            const isSelected = userChoice === optIdx;
                            let choiceClasses = 'border-[#23303E] bg-[#111922] text-[#CBD5E1] hover:border-[#35495E]';

                            if (showFeedbackOnCurrentPage) {
                              if (optIdx === q.correctIndex) {
                                choiceClasses = 'border-[#7DD3FC] bg-[#7DD3FC]/12 text-[#F8FAFC] font-medium';
                              } else if (isSelected && !isCorrect) {
                                choiceClasses = 'border-[#F87171] bg-[#F87171]/12 text-[#FECACA]';
                              } else {
                                choiceClasses = 'border-[#23303E] bg-[#111922]/50 text-[#7D8FA3] opacity-70';
                              }
                            } else if (isSelected) {
                              choiceClasses = 'border-[#D99B26] bg-[#D99B26]/12 text-[#F8FAFC] font-medium';
                            }

                            return (
                              <label
                                key={letter}
                                className={`flex items-start gap-3 px-3.5 py-3 rounded-xl border min-h-[44px] transition-colors ${
                                  showFeedbackOnCurrentPage ? 'cursor-default' : 'cursor-pointer'
                                } ${choiceClasses}`}
                              >
                                <input
                                  type="radio"
                                  name={`question-${q.id}`}
                                  checked={isSelected}
                                  disabled={showFeedbackOnCurrentPage}
                                  onChange={() => handleSelectOption(q.id, optIdx, qIdx)}
                                  className="mt-1 h-4 w-4 accent-[#D99B26] shrink-0 cursor-pointer"
                                />
                                <span className="font-mono text-xs font-bold mt-0.5 shrink-0 text-[#94A3B8]">
                                  ({letter})
                                </span>
                                <span className="text-xs sm:text-sm leading-relaxed flex-1">{optionText}</span>
                                {showFeedbackOnCurrentPage && optIdx === q.correctIndex && (
                                  <span className="text-[11px] font-semibold text-[#7DD3FC] shrink-0">Correct</span>
                                )}
                                {showFeedbackOnCurrentPage && isSelected && !isCorrect && (
                                  <span className="text-[11px] font-semibold text-[#F87171] shrink-0">Your pick</span>
                                )}
                              </label>
                            );
                          })}
                        </div>

                        {/* Practice Mode Per-Page Trap Card & Vocab */}
                        {showFeedbackOnCurrentPage && (
                          <>
                            <DlptTrapCard question={q} userChoiceIndex={userChoice} />

                            {(q.targetVocabulary || []).length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                <span className="text-[11px] font-semibold text-[#94A3B8]">Key terms:</span>
                                {(q.targetVocabulary || []).map((tv) => {
                                  const saved =
                                    savedVocabTerms.has(tv.term.toLowerCase()) ||
                                    vocabItems.some((v) => v.term.toLowerCase() === tv.term.toLowerCase());
                                  return (
                                    <button
                                      key={tv.term}
                                      type="button"
                                      disabled={saved}
                                      onClick={() =>
                                        handleSaveVocabTerm(tv.term, tv.english, currentDrill.studyExcerpt)
                                      }
                                      className={`inline-flex items-center gap-1 px-2.5 py-1 min-h-[32px] rounded-lg text-[11px] font-medium border transition-colors ${
                                        saved
                                          ? 'border-[#23303E] bg-[#16202B] text-[#7DD3FC]'
                                          : 'border-[#D99B26]/40 bg-[#D99B26]/10 text-[#F3C669] hover:bg-[#D99B26]/20'
                                      }`}
                                    >
                                      {saved ? <Check className="w-3 h-3" /> : <BookmarkPlus className="w-3 h-3" />}
                                      <span>
                                        {tv.term} ({tv.english})
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        )}
                      </fieldset>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* STAGE: PT LOWER-RANGE END-OF-SESSION REVIEW SCREEN */}
          {stage === 'review' && (
            <div className="space-y-5">
              <div className="rounded-xl border border-[#7DD3FC]/35 bg-[#7DD3FC]/8 p-4 space-y-1.5">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4 text-[#7DD3FC]" />
                  <h2 id="brief-drill-title" className="text-base font-semibold text-[#F8FAFC]">
                    Review before submitting ({profile.pillLabel})
                  </h2>
                </div>
                <p className="text-xs sm:text-sm text-[#CBD5E1] leading-relaxed">
                  Select any passage below to return and change answers. Audio recordings remain locked and will not
                  replay.
                </p>
              </div>

              {/* No-guessing-penalty warning for any unanswered questions */}
              {profile.warnUnansweredBeforeSubmit && unansweredSummary.totalUnanswered > 0 && (
                <div
                  data-testid="pt-unanswered-warning"
                  className="rounded-xl border border-[#D99B26]/60 bg-[#D99B26]/12 p-4 space-y-2"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-5 h-5 text-[#D99B26] shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-[#F8FAFC]">
                        No guessing penalty — {unansweredSummary.totalUnanswered} unanswered{' '}
                        {unansweredSummary.totalUnanswered === 1 ? 'question' : 'questions'}
                      </p>
                      <p className="text-xs text-[#CBD5E1] leading-relaxed">
                        On the DLPT5 Lower-Range there is no penalty for guessing. Jump back to mark your best answer
                        before submitting.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Passage review list */}
              <div className="space-y-3">
                {reviewPagesData.map(({passage, drill, questionIds}, idx) => {
                  const answeredCount = questionIds.filter((id) => typeof selectedAnswers[id] === 'number').length;
                  const totalQ = questionIds.length;
                  const isFlagged = Boolean(flaggedPassages[passage.id]);
                  const hasMissing = totalQ === 0 || answeredCount < totalQ;

                  return (
                    <button
                      key={passage.id}
                      type="button"
                      onClick={() => {
                        setCurrentPassageIndex(idx);
                        setConfirmUnansweredSubmit(false);
                        setStage('active');
                      }}
                      className="w-full text-left rounded-xl border border-[#23303E] bg-[#0B1117] hover:border-[#7DD3FC]/50 p-4 min-h-[64px] transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono font-semibold text-[#7DD3FC] tabular-nums">Passage {idx + 1}</span>
                          {isFlagged && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#D99B26]/15 text-[#F3C669] text-[11px] font-medium">
                              <Flag className="w-3 h-3" />
                              Flagged
                            </span>
                          )}
                          {hasMissing && (
                            <span className="text-[#F87171] font-medium">
                              {totalQ === 0 ? 'Not visited yet' : `${totalQ - answeredCount} unanswered`}
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-[#F8FAFC] truncate">{passage.title}</p>
                        <p className="text-xs text-[#94A3B8] font-mono tabular-nums">
                          {drill ? `${answeredCount} / ${totalQ} answered` : 'Tap to open passage'}
                        </p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-[#94A3B8] shrink-0" />
                    </button>
                  );
                })}
              </div>

              {confirmUnansweredSubmit && unansweredSummary.totalUnanswered > 0 && (
                <div className="rounded-xl border border-[#F87171]/50 bg-[#F87171]/10 p-4 space-y-3">
                  <p className="text-sm font-semibold text-[#FECACA]">
                    Submit with {unansweredSummary.totalUnanswered} unanswered{' '}
                    {unansweredSummary.totalUnanswered === 1 ? 'question' : 'questions'}?
                  </p>
                  <p className="text-xs text-[#E2E8F0]">
                    Unanswered items score zero. You can still return to any passage above to enter a guess.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => finalizeSession(passageLineup)}
                      className="px-4 py-2 min-h-[44px] rounded-xl bg-[#F87171] text-[#0B1117] text-xs font-semibold hover:bg-[#FCA5A5] transition-colors"
                    >
                      Submit anyway
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmUnansweredSubmit(false)}
                      className="px-4 py-2 min-h-[44px] rounded-xl border border-[#23303E] bg-[#111922] text-xs font-semibold text-[#CBD5E1] hover:text-white transition-colors"
                    >
                      Keep reviewing
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STAGE: FINISHED SUMMARY & FULL REVIEW */}
          {stage === 'finished' && finalResult && (
            <div className="space-y-6">
              {/* Summary Hero */}
              <div className="rounded-xl border border-[#D99B26]/45 bg-[#D99B26]/10 p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-wider text-[#D99B26]">
                      DLPT {skill === 'listening' ? 'Listening' : 'Reading'} Summary ·{' '}
                      {mode === 'test' ? 'Test conditions' : 'Practice mode'}
                    </p>
                    <h2 id="brief-drill-title" className="text-lg sm:text-xl font-bold text-[#F8FAFC] mt-0.5">
                      {finalResult.correctCount} of {finalResult.totalQuestions} correct (
                      {finalResult.totalQuestions > 0
                        ? Math.round((finalResult.correctCount / finalResult.totalQuestions) * 100)
                        : 0}
                      %)
                    </h2>
                  </div>
                  <span className="font-mono text-xs text-[#CBD5E1] tabular-nums">
                    Levels: {finalResult.passageLevels.join(' → ')}
                  </span>
                </div>

                {/* Trap breakdown */}
                {Object.keys(finalResult.trapsMissed).length > 0 && (
                  <div className="pt-2 border-t border-[#D99B26]/25 space-y-1.5">
                    <p className="text-xs font-semibold text-[#F8FAFC]">Distractor traps to watch:</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(finalResult.trapsMissed)
                        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                        .map(([trapKey, count]) => {
                          const meta = TRAP_TYPE_META[trapKey as DlptTrapType];
                          return (
                            <span
                              key={trapKey}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#F87171]/35 bg-[#0B1117] text-xs text-[#FECACA]"
                            >
                              <span>{meta?.label ?? trapKey}</span>
                              <span className="font-mono text-[#F87171] tabular-nums">×{count}</span>
                            </span>
                          );
                        })}
                    </div>
                  </div>
                )}

                <p className="text-xs text-[#94A3B8]">
                  Saved to your Today ILR profile. Practice estimate, not an official rating.
                </p>
              </div>

              {/* Full Passage-by-Passage Review (especially essential for Test mode end-only feedback) */}
              <div className="space-y-5">
                {passageLineup.map((passage, pIdx) => {
                  const drill = drillsById[passage.id];
                  if (!drill) return null;

                  return (
                    <div
                      key={passage.id}
                      className="rounded-xl border border-[#23303E] bg-[#0B1117] p-4 sm:p-5 space-y-4"
                    >
                      <div className="space-y-1">
                        <p className="font-mono text-xs text-[#7DD3FC] tabular-nums">
                          Passage {pIdx + 1} · ILR Level {passage.ilrLevel} · {passage.sourceName}
                        </p>
                        <h3 className="text-sm sm:text-base font-semibold text-[#F8FAFC]">{passage.title}</h3>
                        <p className="text-xs italic text-[#94A3B8]">{drill.orientationLine}</p>
                      </div>

                      {drill.questions.map((q, qIdx) => {
                        const picked = selectedAnswers[q.id];
                        const isCorrect = picked === q.correctIndex;
                        const pickedLetter = typeof picked === 'number' ? CHOICE_LETTERS[picked] : null;
                        const correctLetter = CHOICE_LETTERS[q.correctIndex] ?? 'A';

                        return (
                          <div key={q.id} className="p-3.5 rounded-xl border border-[#23303E] bg-[#111922] space-y-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-xs sm:text-sm font-semibold text-[#F8FAFC]">
                                Q{qIdx + 1}. {q.questionEnglish || q.question}
                              </p>
                              <span
                                className={`text-xs font-semibold shrink-0 ${
                                  isCorrect ? 'text-[#7DD3FC]' : 'text-[#F87171]'
                                }`}
                              >
                                {isCorrect
                                  ? `Correct (${correctLetter})`
                                  : pickedLetter
                                    ? `Picked (${pickedLetter}) · Ans (${correctLetter})`
                                    : `Blank · Ans (${correctLetter})`}
                              </span>
                            </div>

                            <DlptTrapCard question={q} userChoiceIndex={picked} />
                          </div>
                        );
                      })}

                      {drill.studyExcerpt && (
                        <div className="pt-2 border-t border-[#23303E] space-y-2">
                          <span className="font-mono text-[11px] uppercase tracking-wider text-[#7DD3FC]">
                            Short Review {passage.mediaType === 'audio' ? 'Transcript' : 'Excerpt'} (tap any word)
                          </span>
                          <div className="p-3.5 rounded-lg bg-[#111922] border border-[#23303E] text-sm text-[#F8FAFC] leading-relaxed">
                            <TappableText
                              text={drill.studyExcerpt}
                              activeWord={wordLookup.lookup?.word}
                              onWordTap={(w) =>
                                void wordLookup.lookUpWord(`fin-${passage.id}`, w, drill.studyExcerpt || '')
                              }
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {wordLookup.lookup && (
                  <WordLookupPopover
                    lookup={wordLookup.lookup}
                    onClose={wordLookup.close}
                    onRetry={wordLookup.retry}
                    onSave={wordLookup.save}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Sticky Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-t border-[#23303E] bg-[#0B1117]">
          {/* ACTIVE STAGE CONTROLS */}
          {stage === 'active' && (
            <>
              <div className="flex items-center gap-2">
                {profile.allowBack && currentPassageIndex > 0 && (
                  <button
                    type="button"
                    onClick={handlePreviousPassage}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-xl border border-[#23303E] bg-[#111922] text-xs sm:text-sm font-semibold text-[#CBD5E1] hover:text-white transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Previous</span>
                  </button>
                )}

                {profile.hideNextUntilPageComplete && !canProceedFromCurrentPage && currentDrill && (
                  <span className="text-xs text-[#94A3B8] font-mono tabular-nums">
                    Answer all {currentDrill.questions.length} questions to continue ({answeredOnPageCount}/
                    {currentDrill.questions.length})
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 ml-auto">
                {/* Practice mode: Check answers first, then Next/Finish */}
                {mode === 'practice' && !isCurrentPageChecked && canProceedFromCurrentPage && currentDrill && (
                  <button
                    type="button"
                    data-testid="dlpt-check-page-btn"
                    onClick={handleCheckPracticePage}
                    className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[44px] rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Check answers</span>
                  </button>
                )}

                {/* Advance button:
                    - In Practice mode: shown after checking the page (or on PT where skipping is allowed)
                    - In Test mode: shown whenever canProceedFromCurrentPage is true (hidden on ES until all answered!) */}
                {((mode === 'practice' && (isCurrentPageChecked || !profile.hideNextUntilPageComplete)) ||
                  (mode === 'test' && canProceedFromCurrentPage)) &&
                  currentDrill && (
                    <button
                      type="button"
                      data-testid="dlpt-next-btn"
                      onClick={handleAdvancePassage}
                      className={`inline-flex items-center gap-2 px-5 py-2.5 min-h-[44px] rounded-xl text-sm font-semibold transition-colors ${
                        mode === 'practice' && !isCurrentPageChecked
                          ? 'border border-[#23303E] bg-[#111922] text-[#CBD5E1] hover:text-white'
                          : 'bg-[#D99B26] text-[#0B1117] hover:bg-[#E5AE42]'
                      }`}
                    >
                      <span>
                        {!isLastPlannedPassage
                          ? 'Next passage'
                          : profile.allowEndReview && mode === 'test'
                            ? 'Review & submit'
                            : 'Finish drill'}
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  )}
              </div>
            </>
          )}

          {/* REVIEW STAGE CONTROLS (PT Lower-Range) */}
          {stage === 'review' && (
            <>
              <button
                type="button"
                onClick={() => {
                  setConfirmUnansweredSubmit(false);
                  setStage('active');
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-xl border border-[#23303E] bg-[#111922] text-xs sm:text-sm font-semibold text-[#CBD5E1] hover:text-white transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to passages</span>
              </button>

              <button
                type="button"
                data-testid="pt-final-submit-btn"
                onClick={() => {
                  if (unansweredSummary.totalUnanswered > 0 && !confirmUnansweredSubmit) {
                    setConfirmUnansweredSubmit(true);
                    return;
                  }
                  finalizeSession(passageLineup);
                }}
                className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[44px] rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
              >
                <ClipboardCheck className="w-4 h-4" />
                <span>Submit test</span>
              </button>
            </>
          )}

          {/* FINISHED STAGE CONTROLS */}
          {stage === 'finished' && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleRestartDrill}
                  className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[44px] rounded-xl border border-[#23303E] bg-[#111922] text-xs sm:text-sm font-semibold text-[#CBD5E1] hover:text-white transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Try again</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onBriefItBack(item);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[44px] rounded-xl bg-[#D99B26] text-[#0B1117] text-xs sm:text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Brief it back in OPI</span>
                </button>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 min-h-[44px] rounded-xl text-xs sm:text-sm font-medium text-[#94A3B8] hover:text-white transition-colors"
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>

      {/* Rules Sheet */}
      {rulesSheetOpen && <DlptRulesSheet profile={profile} onClose={() => setRulesSheetOpen(false)} />}
    </div>
  );
};
