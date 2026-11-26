import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
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
  computeNextAdaptiveLevel,
  getDlptProfileForLanguage,
  getMaxQuestionsForPassage,
  getPlannedPassageCount,
  getUnansweredSummary,
  mediaTypeToDlptSkill,
  pickNextAdaptivePassage,
  TRAP_TYPE_META,
} from '../../utils/dlptRules';
import {type SaveVocabFn, useWordLookup} from '../../hooks/useWordLookup';
import {createId} from '../../utils/ids';
import {isBriefItemDrillable} from '../../utils/briefLogic';
import {DlptRulesSheet} from './DlptRulesSheet';
import {DrillHeader} from './drill/DrillHeader';
import {DrillReviewStage} from './drill/DrillReviewStage';
import {DrillRunStage} from './drill/DrillRunStage';
import {DrillSummaryStage} from './drill/DrillSummaryStage';
import {useDrillAudio} from './drill/useDrillAudio';

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
      // Only passages with real source text can join a drill session (REVIEW C-2).
      if (p.language === item.language && p.mediaType === item.mediaType && isBriefItemDrillable(p)) {
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

  // Cached drills and load errors keyed by briefId
  const [drillsById, setDrillsById] = useState<Record<string, BriefDrill>>({});
  const [drillErrorById, setDrillErrorById] = useState<Record<string, string>>({});
  const drillsInFlight = useRef(new Set<string>());

  // User selections (questionId -> optionIndex), focused question index on current page, checked pages (Practice), flags (PT)
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [checkedPages, setCheckedPages] = useState<Record<string, boolean>>({});
  const [flaggedPassages, setFlaggedPassages] = useState<Record<string, boolean>>({});

  // Audio single-play enforcement & Practice replay-with-transcript state
  const audio = useDrillAudio();
  const {pauseAll: pauseAllAudio} = audio;

  // Adaptive step notice in Practice mode
  const [adaptiveStepNote, setAdaptiveStepNote] = useState<string | null>(null);

  // Persisted result guard
  const [finalResult, setFinalResult] = useState<DlptDrillResult | null>(null);

  const currentPassage = passageLineup[currentPassageIndex] ?? item;
  const currentDrill = drillsById[currentPassage.id] ?? null;
  const currentError = drillErrorById[currentPassage.id] ?? null;
  const isCurrentPageChecked = Boolean(checkedPages[currentPassage.id]);

  const wordLookup = useWordLookup({
    config,
    vocabItems,
    onSaveVocab,
    vocabSource: 'brief',
    omitDomain: !config.workFocusEnabled,
  });

  // Fetch the current passage's drill unless it is cached, failed (Retry clears the error) or in flight.
  // Loading state is derived, so the effect only syncs with the server.
  useEffect(() => {
    const briefId = currentPassage.id;
    if (currentDrill || currentError || drillsInFlight.current.has(briefId)) return;
    drillsInFlight.current.add(briefId);
    fetchBriefDrill(briefId)
      .then((data) => setDrillsById((prev) => ({...prev, [briefId]: data})))
      .catch((err: unknown) =>
        setDrillErrorById((prev) => ({
          ...prev,
          [briefId]: err instanceof Error ? err.message : 'Failed to generate DLPT drill questions.',
        }))
      )
      .finally(() => drillsInFlight.current.delete(briefId));
  }, [currentPassage.id, currentDrill, currentError]);

  const retryCurrentDrill = () => {
    const briefId = currentPassage.id;
    setDrillErrorById((prev) => {
      const next = {...prev};
      delete next[briefId];
      return next;
    });
  };

  /** Moves to a passage of the lineup; a different passage starts at its first question. */
  const showPassage = (index: number, lineup: BriefItem[] = passageLineup) => {
    if ((lineup[index] ?? item).id !== currentPassage.id) {
      setActiveQuestionIndex(0);
      pauseAllAudio();
    }
    setCurrentPassageIndex(index);
  };

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
      pauseAllAudio();

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
    [
      drillsById,
      item,
      mode,
      onAppendErrorEvents,
      onLogHistory,
      onSaveDlptResult,
      pauseAllAudio,
      profile,
      selectedAnswers,
      skill,
    ]
  );

  // Check answers on current page (Practice mode)
  const handleCheckPracticePage = () => {
    if (!currentDrill) return;
    if (profile.hideNextUntilPageComplete && !canProceedFromCurrentPage) return;
    setModeLocked(true);
    setCheckedPages((prev) => ({...prev, [currentPassage.id]: true}));
    audio.pauseMain();
  };

  // Advance to next passage (handles ES adaptive routing vs PT fixed order)
  const handleAdvancePassage = () => {
    if (!currentDrill) return;
    if (profile.hideNextUntilPageComplete && !canProceedFromCurrentPage) return;

    setModeLocked(true);
    pauseAllAudio();

    // For PT Lower-Range on the final passage: open End-of-Session Review screen
    if (!profile.adaptive) {
      if (currentPassageIndex + 1 < passageLineup.length) {
        showPassage(currentPassageIndex + 1);
      } else if (profile.allowEndReview && mode === 'test') {
        setStage('review');
      } else if (profile.allowEndReview && mode === 'practice') {
        // In Practice mode on PT, if any passages were flagged or skipped, offer review; otherwise finish
        const anyFlagged = Object.values(flaggedPassages).some(Boolean);
        const pagesForSummary = passageLineup.map((p) => ({
          questionIds: (drillsById[p.id]?.questions ?? []).map((q) => q.id),
        }));
        const unanswered = getUnansweredSummary(pagesForSummary, selectedAnswers);
        if (anyFlagged || unanswered.totalUnanswered > 0) {
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

    const nextLineup = [...passageLineup, nextPassage];
    setPassageLineup(nextLineup);
    showPassage(currentPassageIndex + 1, nextLineup);
  };

  const handlePreviousPassage = () => {
    if (!profile.allowBack || currentPassageIndex === 0) return;
    pauseAllAudio();
    showPassage(Math.max(0, currentPassageIndex - 1));
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
  };

  const handleRestartDrill = () => {
    audio.reset();
    setPassageLineup(profile.adaptive ? [item] : buildFixedOrderPassages(item, candidatePool, plannedPassageCount));
    setCurrentPassageIndex(0);
    setActiveQuestionIndex(0);
    setStage('active');
    setModeLocked(false);
    setSelectedAnswers({});
    setCheckedPages({});
    setFlaggedPassages({});
    setAdaptiveStepNote(null);
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

  const isLoadingCurrent = !currentDrill && !currentError;

  const counterLabel =
    stage === 'review'
      ? `End-of-session review · ${passageLineup.length} passages`
      : stage === 'finished'
        ? `Drill complete · ${passageLineup.length} ${passageLineup.length === 1 ? 'passage' : 'passages'}`
        : `Passage ${currentPassageIndex + 1} of ${plannedPassageCount} · Question ${displayQuestionNum} of ${currentTotalQuestions}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="brief-drill-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-5 bg-black/85 backdrop-blur-sm"
    >
      <div className="relative flex flex-col w-full max-w-3xl max-h-[94vh] rounded-2xl border border-[#23303E] bg-[#111922] shadow-2xl overflow-hidden">
        <DrillHeader
          mode={mode}
          modeLocked={modeLocked}
          onModeSwitch={handleModeSwitch}
          rulesPillLabel={profile.pillLabel}
          onOpenRules={() => setRulesSheetOpen(true)}
          onClose={onClose}
          counterLabel={counterLabel}
          skillLabel={`${skill === 'listening' ? 'Listening' : 'Reading'}${
            mode === 'practice' && stage === 'active' ? ` · ILR ${currentPassage.ilrLevel}` : ''
          }`}
          progressPct={overallProgressPct}
        />

        {stage === 'active' && (
          <DrillRunStage
            profile={profile}
            mode={mode}
            skill={skill}
            passage={currentPassage}
            drill={currentDrill}
            isLoading={isLoadingCurrent}
            error={currentError}
            onRetry={retryCurrentDrill}
            adaptiveStepNote={adaptiveStepNote}
            flagged={Boolean(flaggedPassages[currentPassage.id])}
            onToggleFlag={(flagged) => setFlaggedPassages((prev) => ({...prev, [currentPassage.id]: flagged}))}
            audio={audio}
            wordLookup={wordLookup}
            vocabItems={vocabItems}
            selectedAnswers={selectedAnswers}
            onSelectOption={handleSelectOption}
            isPageChecked={isCurrentPageChecked}
            canProceed={canProceedFromCurrentPage}
            answeredOnPageCount={answeredOnPageCount}
            isLastPlannedPassage={isLastPlannedPassage}
            canGoBack={profile.allowBack && currentPassageIndex > 0}
            onPrevious={handlePreviousPassage}
            onCheckPage={handleCheckPracticePage}
            onAdvance={handleAdvancePassage}
            onSaveVocabTerm={handleSaveVocabTerm}
          />
        )}

        {stage === 'review' && (
          <DrillReviewStage
            profile={profile}
            pages={reviewPagesData}
            selectedAnswers={selectedAnswers}
            flaggedPassages={flaggedPassages}
            totalUnanswered={unansweredSummary.totalUnanswered}
            onOpenPassage={(idx) => {
              showPassage(idx);
              setStage('active');
            }}
            onBackToPassages={() => setStage('active')}
            onSubmit={() => finalizeSession(passageLineup)}
          />
        )}

        {stage === 'finished' && finalResult && (
          <DrillSummaryStage
            result={finalResult}
            skill={skill}
            mode={mode}
            passages={passageLineup}
            drillsById={drillsById}
            selectedAnswers={selectedAnswers}
            wordLookup={wordLookup}
            onRestart={handleRestartDrill}
            onBriefItBack={() => {
              onClose();
              onBriefItBack(item);
            }}
            onDone={onClose}
          />
        )}
      </div>

      {/* Rules Sheet */}
      {rulesSheetOpen && <DlptRulesSheet profile={profile} onClose={() => setRulesSheetOpen(false)} />}
    </div>
  );
};
