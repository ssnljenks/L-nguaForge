import React, {lazy, Suspense, useCallback, useEffect, useMemo, useState} from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  Headphones,
  MessageSquare,
  Mic,
  Newspaper,
  Play,
  Zap,
} from 'lucide-react';
import type {ErrorTaxonomyKey} from '../../data/errorTaxonomy';
import type {
  AppendErrorEventsFn,
  BriefItem,
  DlptDrillResult,
  DrillHistoryEntry,
  ErrorEvent,
  MissionConfig,
  ModuleTab,
  OpiSession,
  RecordErrorLogFn,
  TodayPlanDayCompletion,
  TodayPlanStepId,
  VocabFsrsRating,
  VocabItem,
} from '../../types';
import {fetchBriefFeed} from '../../services/api';
import {SEED_BRIEF_ITEMS} from '../../utils/briefLogic';
import {deriveUserSkillProfile, rankRecurringErrors} from '../../utils/errorPatterns';
import {DEFAULT_ILR_GOALS, generateTodayPlan, getLocalDateKey, type TodayPlanSpeakingItem} from '../../utils/todayPlan';
import type {SaveVocabFn} from '../../hooks/useWordLookup';
import {FixDrillModal} from './FixDrillModal';
import {RecurringErrorsView} from './RecurringErrorsModal';
import {VocabWarmupModal} from './VocabWarmupModal';

const BriefDrillModal = lazy(() => import('../brief/BriefDrillModal').then((m) => ({default: m.BriefDrillModal})));
const BriefGistModal = lazy(() => import('../brief/BriefGistModal').then((m) => ({default: m.BriefGistModal})));

export interface TodayModuleProps {
  config: MissionConfig;
  vocabItems: VocabItem[];
  sessions: OpiSession[];
  dlptResults: DlptDrillResult[];
  errorEvents: ErrorEvent[];
  dayCompletion: TodayPlanDayCompletion;
  onMarkPlanStepDone: (step: TodayPlanStepId, dateKey: string) => void;
  onReviewVocabFsrs: (id: string, rating: VocabFsrsRating) => void;
  onSaveVocab: SaveVocabFn;
  onLogHistory: (entry: DrillHistoryEntry) => void;
  onSaveDlptResult: (result: DlptDrillResult) => void;
  onRecordErrorLog: RecordErrorLogFn;
  onAppendErrorEvents: AppendErrorEventsFn;
  onBriefItBack: (story: BriefItem) => void;
  onLaunchSpeakingPlanStep: (item: TodayPlanSpeakingItem, dateKey: string) => void;
  onNavigateTab: (tab: ModuleTab) => void;
  onOpenSettings: () => void;
}

export const TodayModule: React.FC<TodayModuleProps> = ({
  config,
  vocabItems,
  sessions,
  dlptResults,
  errorEvents,
  dayCompletion,
  onMarkPlanStepDone,
  onReviewVocabFsrs,
  onSaveVocab,
  onLogHistory,
  onSaveDlptResult,
  onRecordErrorLog,
  onAppendErrorEvents,
  onBriefItBack,
  onLaunchSpeakingPlanStep,
  onNavigateTab,
  onOpenSettings,
}) => {
  const [showRecurringErrors, setShowRecurringErrors] = useState(false);
  const [activeFixKey, setActiveFixKey] = useState<ErrorTaxonomyKey | null>(null);
  const [activeFixIsPlanStep, setActiveFixIsPlanStep] = useState(false);
  const [showVocabWarmup, setShowVocabWarmup] = useState(false);
  const [activeBriefModal, setActiveBriefModal] = useState<'dlpt' | 'gist' | null>(null);
  const [liveBriefPool, setLiveBriefPool] = useState<BriefItem[]>([]);

  const dateKey = useMemo(() => getLocalDateKey(), []);

  // Opportunistically hydrate the Brief feed cache (non-blocking, zero AI calls)
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchBriefFeed({language: config.language, mediaType: 'audio'}),
      fetchBriefFeed({language: config.language, mediaType: 'text'}),
    ])
      .then(([audioRes, textRes]) => {
        if (cancelled) return;
        const merged = [...(audioRes.items ?? []), ...(textRes.items ?? [])];
        if (merged.length > 0) {
          setLiveBriefPool(merged);
        }
      })
      .catch(() => {
        // Fallback silently to built-in SEED_BRIEF_ITEMS
      });
    return () => {
      cancelled = true;
    };
  }, [config.language]);

  const briefPool = useMemo(() => {
    if (liveBriefPool.length > 0) return liveBriefPool;
    return [...SEED_BRIEF_ITEMS];
  }, [liveBriefPool]);

  const {profile, plan} = useMemo(
    () =>
      generateTodayPlan({
        language: config.language,
        domain: config.domain,
        workFocusEnabled: config.workFocusEnabled,
        vocabItems,
        sessions,
        dlptResults,
        errorEvents,
        briefPool,
        goals: config.ilrGoals ?? DEFAULT_ILR_GOALS,
        testDate: config.testDate,
        dateKey,
      }),
    [
      config.language,
      config.domain,
      config.workFocusEnabled,
      config.ilrGoals,
      config.testDate,
      vocabItems,
      sessions,
      dlptResults,
      errorEvents,
      briefPool,
      dateKey,
    ]
  );

  const skillProfile = useMemo(
    () =>
      deriveUserSkillProfile({
        language: config.language,
        sessions,
        dlptResults,
        events: errorEvents,
      }),
    [config.language, sessions, dlptResults, errorEvents]
  );

  const rankedErrors = useMemo(
    () =>
      rankRecurringErrors(errorEvents, {
        language: config.language,
        currentFloor: skillProfile.currentFloor,
        weakestSkill: skillProfile.weakestSkill,
      }),
    [errorEvents, config.language, skillProfile.currentFloor, skillProfile.weakestSkill]
  );

  const [vocabItem, briefItem, speakingItem] = plan.items;

  const doneCount = (dayCompletion.vocab ? 1 : 0) + (dayCompletion.brief ? 1 : 0) + (dayCompletion.speaking ? 1 : 0);

  const nextIncompleteStep: TodayPlanStepId | null = !dayCompletion.vocab
    ? 'vocab'
    : !dayCompletion.brief
      ? 'brief'
      : !dayCompletion.speaking
        ? 'speaking'
        : null;

  const launchStep = useCallback(
    (stepId: TodayPlanStepId) => {
      if (stepId === 'vocab') {
        setShowVocabWarmup(true);
        return;
      }
      if (stepId === 'brief') {
        setActiveBriefModal(briefItem.drillType);
        return;
      }
      // Step 3: Speaking
      if (speakingItem.kind === 'fix_drill' && speakingItem.errorKey) {
        setActiveFixIsPlanStep(true);
        setActiveFixKey(speakingItem.errorKey);
        return;
      }
      onLaunchSpeakingPlanStep(speakingItem, dateKey);
    },
    [briefItem.drillType, dateKey, onLaunchSpeakingPlanStep, speakingItem]
  );

  const handleStartPlan = () => {
    launchStep(nextIncompleteStep ?? 'vocab');
  };

  const audioPool = useMemo(
    () => briefPool.filter((item) => item.language === config.language && item.mediaType === 'audio'),
    [briefPool, config.language]
  );

  if (showRecurringErrors) {
    return (
      <>
        <RecurringErrorsView
          rankedErrors={rankedErrors}
          currentFloor={skillProfile.currentFloor}
          weakestSkill={skillProfile.weakestSkill}
          onBack={() => setShowRecurringErrors(false)}
          onLaunchFix={(key) => {
            setActiveFixIsPlanStep(false);
            setActiveFixKey(key);
          }}
          onNavigateTab={onNavigateTab}
        />
        {activeFixKey && (
          <FixDrillModal
            errorKey={activeFixKey}
            config={config}
            onClose={() => {
              setActiveFixKey(null);
              setActiveFixIsPlanStep(false);
            }}
            onLogHistory={(entry) => {
              onLogHistory(entry);
              if (activeFixIsPlanStep) {
                onMarkPlanStepDone('speaking', dateKey);
              }
            }}
          />
        )}
      </>
    );
  }

  return (
    <div className="space-y-6 pb-24 md:pb-8">
      {/* ILR Profile Card (tapping opens Recurring errors) */}
      <section aria-label="ILR profile" className="space-y-2.5">
        <button
          type="button"
          data-testid="ilr-profile-card"
          onClick={() => setShowRecurringErrors(true)}
          className="w-full text-left rounded-2xl border border-[#23303E] bg-[#111922] hover:border-[#35495E] transition-colors p-5 sm:p-6 space-y-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D99B26]"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-lg sm:text-xl font-semibold tracking-tight text-[#F8FAFC]">
                ILR profile
              </h1>
              <p className="text-xs text-[#7D8FA3] mt-0.5">Practice estimates, not official ratings.</p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[#7DD3FC] shrink-0">
              <span>
                Recurring errors
                {rankedErrors.length > 0 ? ` (${rankedErrors.length})` : ''}
              </span>
              <ChevronRight className="w-4 h-4" />
            </span>
          </div>

          {/* 3-Column Skill Estimates: Listening | Reading | Speaking */}
          <div className="grid grid-cols-3 gap-3 sm:gap-5">
            {profile.columns.map((col) => {
              const barColor = col.id === 'speaking' ? 'bg-[#D99B26]' : 'bg-[#7DD3FC]';
              return (
                <div key={col.id} data-testid={`ilr-col-${col.id}`} className="space-y-2 min-w-0">
                  <p className="text-xs font-medium text-[#94A3B8] truncate">{col.label}</p>

                  <div className="flex items-baseline gap-1.5">
                    <span className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-[#F8FAFC] tabular-nums leading-none">
                      {col.level ?? '—'}
                    </span>
                    {col.level && (
                      <span className="font-mono text-[11px] text-[#7D8FA3] tabular-nums">/ {col.goal}</span>
                    )}
                  </div>

                  {/* Progress bar toward editable goal */}
                  <div
                    className="h-1.5 w-full rounded-full bg-[#1C2836] overflow-hidden"
                    role="progressbar"
                    aria-label={`${col.label} progress toward ILR ${col.goal}`}
                    aria-valuenow={col.progressPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                      style={{width: `${col.progressPct}%`}}
                    />
                  </div>

                  {col.level ? (
                    <p className="text-[11px] text-[#7D8FA3] leading-snug">
                      {col.sourceLabel}
                      <span className="hidden sm:inline"> · Goal {col.goal}</span>
                    </p>
                  ) : (
                    <div className="space-y-0.5">
                      <p className="text-[11px] text-[#CBD5E1] leading-snug">{col.emptyHint}</p>
                      <p className="text-[11px] text-[#64748B] leading-snug">{col.sourceLabel}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Weakest link line */}
          <div
            data-testid="ilr-weakest-link"
            className="pt-3.5 border-t border-[#1D2835] flex items-center justify-between gap-3 text-xs"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-3.5 h-3.5 text-[#D99B26] shrink-0" />
              <span className="text-[#94A3B8] shrink-0">Weakest link:</span>
              <span className="text-[#F8FAFC] font-medium truncate">{profile.weakestLinkLine}</span>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-[#7D8FA3] shrink-0" />
          </div>
        </button>

        {/* Optional DLPT/OPI test countdown line under profile */}
        {profile.testCountdownLabel && (
          <div
            data-testid="today-test-countdown"
            className="flex items-center justify-between gap-2 px-1 text-xs text-[#CBD5E1]"
          >
            <span className="inline-flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-[#D99B26]" />
              <span className="font-mono font-semibold text-[#F3C669] tabular-nums">{profile.testCountdownLabel}</span>
              {config.testDate && (
                <>
                  <span aria-hidden="true" className="text-[#556980]">
                    ·
                  </span>
                  <span className="text-[#7D8FA3] font-mono tabular-nums">{config.testDate}</span>
                </>
              )}
            </span>
            <button
              type="button"
              onClick={onOpenSettings}
              className="text-[#7DD3FC] hover:text-white transition-colors min-h-[36px] px-1"
            >
              Edit goals
            </button>
          </div>
        )}
      </section>

      {/* Today's Plan (~25 min, 3 items generated locally) */}
      <section aria-label="Today's plan" className="space-y-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="font-display text-lg font-semibold text-[#F8FAFC]">Today&apos;s plan</h2>
            <span className="text-xs text-[#7D8FA3] font-mono tabular-nums">~{plan.totalMinutes} min</span>
          </div>
          <span
            data-testid="today-plan-progress"
            className={`font-mono text-xs font-semibold tabular-nums ${
              doneCount === 3 ? 'text-emerald-400' : 'text-[#F3C669]'
            }`}
          >
            {doneCount} of 3 done
          </span>
        </div>

        <div className="space-y-3">
          {/* Item 1: Vocab warm-up (FSRS) */}
          <button
            type="button"
            data-testid="plan-item-vocab"
            onClick={() => launchStep('vocab')}
            className={`w-full text-left rounded-2xl border p-4 sm:p-5 transition-colors flex items-start justify-between gap-4 min-h-[76px] ${
              dayCompletion.vocab
                ? 'border-emerald-500/35 bg-[#111922]/80 hover:border-emerald-500/55'
                : 'border-[#23303E] bg-[#111922] hover:border-[#35495E]'
            }`}
          >
            <div className="flex items-start gap-3.5 min-w-0">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 font-mono text-xs font-bold ${
                  dayCompletion.vocab
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/35'
                    : 'bg-[#0B1117] text-[#CBD5E1] border border-[#23303E]'
                }`}
              >
                {dayCompletion.vocab ? <Check className="w-4 h-4" /> : '1'}
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#94A3B8]">
                  <span className="inline-flex items-center gap-1 font-medium text-[#7DD3FC]">
                    <Brain className="w-3.5 h-3.5" />
                    Vocab
                  </span>
                  <span aria-hidden="true" className="text-[#556980]">
                    ·
                  </span>
                  <span className="font-mono tabular-nums">~{vocabItem.minutes} min</span>
                  {dayCompletion.vocab && (
                    <>
                      <span aria-hidden="true" className="text-[#556980]">
                        ·
                      </span>
                      <span className="text-emerald-400 font-medium">Done</span>
                    </>
                  )}
                </div>
                <p className="font-display text-base font-semibold text-[#F8FAFC] leading-snug">{vocabItem.title}</p>
                <p className="text-xs text-[#94A3B8] leading-relaxed">{vocabItem.subtitle}</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-[#7D8FA3] shrink-0 self-center" />
          </button>

          {/* Item 2: Brief drill (DLPT or Gist) */}
          <button
            type="button"
            data-testid="plan-item-brief"
            onClick={() => launchStep('brief')}
            className={`w-full text-left rounded-2xl border p-4 sm:p-5 transition-colors flex items-start justify-between gap-4 min-h-[76px] ${
              dayCompletion.brief
                ? 'border-emerald-500/35 bg-[#111922]/80 hover:border-emerald-500/55'
                : 'border-[#23303E] bg-[#111922] hover:border-[#35495E]'
            }`}
          >
            <div className="flex items-start gap-3.5 min-w-0">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 font-mono text-xs font-bold ${
                  dayCompletion.brief
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/35'
                    : 'bg-[#0B1117] text-[#CBD5E1] border border-[#23303E]'
                }`}
              >
                {dayCompletion.brief ? <Check className="w-4 h-4" /> : '2'}
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#94A3B8]">
                  <span className="inline-flex items-center gap-1 font-medium text-[#7DD3FC]">
                    {briefItem.targetSkill === 'listening' ? (
                      <Headphones className="w-3.5 h-3.5" />
                    ) : (
                      <Newspaper className="w-3.5 h-3.5" />
                    )}
                    {briefItem.drillType === 'gist' ? 'Brief · Gist' : 'Brief · DLPT'}
                  </span>
                  <span aria-hidden="true" className="text-[#556980]">
                    ·
                  </span>
                  <span className="font-mono tabular-nums">~{briefItem.minutes} min</span>
                  {briefItem.isWorkAddon && (
                    <>
                      <span aria-hidden="true" className="text-[#556980]">
                        ·
                      </span>
                      <span className="text-[#F3C669] font-medium">Work focus</span>
                    </>
                  )}
                  {dayCompletion.brief && (
                    <>
                      <span aria-hidden="true" className="text-[#556980]">
                        ·
                      </span>
                      <span className="text-emerald-400 font-medium">Done</span>
                    </>
                  )}
                </div>
                <p className="font-display text-base font-semibold text-[#F8FAFC] leading-snug">{briefItem.title}</p>
                <p className="text-xs text-[#94A3B8] leading-relaxed line-clamp-2">{briefItem.subtitle}</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-[#7D8FA3] shrink-0 self-center" />
          </button>

          {/* Item 3: Speaking (ALWAYS gets the amber border!) */}
          <button
            type="button"
            data-testid="plan-item-speaking"
            onClick={() => launchStep('speaking')}
            className={`w-full text-left rounded-2xl border-2 border-[#D99B26] p-4 sm:p-5 transition-colors flex items-start justify-between gap-4 min-h-[76px] ${
              dayCompletion.speaking ? 'bg-[#111922]/85 hover:bg-[#141E28]' : 'bg-[#111922] hover:bg-[#15202B]'
            }`}
          >
            <div className="flex items-start gap-3.5 min-w-0">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 font-mono text-xs font-bold ${
                  dayCompletion.speaking
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/35'
                    : 'bg-[#D99B26]/15 text-[#F3C669] border border-[#D99B26]/50'
                }`}
              >
                {dayCompletion.speaking ? <Check className="w-4 h-4" /> : '3'}
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#94A3B8]">
                  <span className="inline-flex items-center gap-1 font-semibold text-[#F3C669]">
                    {speakingItem.kind === 'fix_drill' ? (
                      <Zap className="w-3.5 h-3.5" />
                    ) : speakingItem.kind === 'talk_work' ? (
                      <MessageSquare className="w-3.5 h-3.5" />
                    ) : (
                      <Mic className="w-3.5 h-3.5" />
                    )}
                    Speaking
                  </span>
                  <span aria-hidden="true" className="text-[#556980]">
                    ·
                  </span>
                  <span className="font-mono tabular-nums">~{speakingItem.minutes} min</span>
                  {speakingItem.isWorkAddon && (
                    <>
                      <span aria-hidden="true" className="text-[#556980]">
                        ·
                      </span>
                      <span className="text-[#F3C669] font-medium">Work focus</span>
                    </>
                  )}
                  {dayCompletion.speaking && (
                    <>
                      <span aria-hidden="true" className="text-[#556980]">
                        ·
                      </span>
                      <span className="text-emerald-400 font-medium">Done</span>
                    </>
                  )}
                </div>
                <p className="font-display text-base font-semibold text-[#F8FAFC] leading-snug">{speakingItem.title}</p>
                <p className="text-xs text-[#94A3B8] leading-relaxed line-clamp-2">{speakingItem.subtitle}</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-[#F3C669] shrink-0 self-center" />
          </button>
        </div>
      </section>

      {/* Secondary Quick Links (Desktop-friendly breathing room, unobtrusive) */}
      <section aria-label="Quick navigation" className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
        <button
          type="button"
          onClick={() => onNavigateTab('talk')}
          className="flex items-center justify-between gap-3 rounded-xl border border-[#23303E] bg-[#0E151D] px-4 py-3 min-h-[52px] text-left hover:border-[#35495E] transition-colors"
        >
          <span className="inline-flex items-center gap-2.5 text-xs font-medium text-[#CBD5E1]">
            <MessageSquare className="w-4 h-4 text-[#D99B26]" />
            <span>Casual chat in Talk</span>
          </span>
          <ArrowRight className="w-3.5 h-3.5 text-[#7D8FA3]" />
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab('brief')}
          className="flex items-center justify-between gap-3 rounded-xl border border-[#23303E] bg-[#0E151D] px-4 py-3 min-h-[52px] text-left hover:border-[#35495E] transition-colors"
        >
          <span className="inline-flex items-center gap-2.5 text-xs font-medium text-[#CBD5E1]">
            <FileText className="w-4 h-4 text-[#7DD3FC]" />
            <span>Browse all Brief stories</span>
          </span>
          <ArrowRight className="w-3.5 h-3.5 text-[#7D8FA3]" />
        </button>

        <button
          type="button"
          onClick={() => setShowRecurringErrors(true)}
          className="flex items-center justify-between gap-3 rounded-xl border border-[#23303E] bg-[#0E151D] px-4 py-3 min-h-[52px] text-left hover:border-[#35495E] transition-colors"
        >
          <span className="inline-flex items-center gap-2.5 text-xs font-medium text-[#CBD5E1]">
            <Zap className="w-4 h-4 text-[#D99B26]" />
            <span>Recurring errors &amp; fixes</span>
          </span>
          <ArrowRight className="w-3.5 h-3.5 text-[#7D8FA3]" />
        </button>
      </section>

      {/* Sticky "Start today's plan" CTA */}
      <div className="fixed bottom-[60px] left-0 right-0 z-30 px-4 py-3 bg-[#0B1117]/95 backdrop-blur-md border-t border-[#23303E] md:sticky md:bottom-4 md:p-0 md:bg-transparent md:border-0">
        <button
          type="button"
          data-testid="start-todays-plan-btn"
          onClick={handleStartPlan}
          className={`w-full md:w-auto md:min-w-[280px] inline-flex items-center justify-center gap-2.5 min-h-[52px] px-6 rounded-xl text-sm font-semibold transition-colors shadow-lg ${
            doneCount === 3
              ? 'bg-emerald-500/20 border border-emerald-500/45 text-emerald-300 hover:bg-emerald-500/30'
              : 'bg-[#D99B26] text-[#0B1117] hover:bg-[#E5AE42]'
          }`}
        >
          {doneCount === 3 ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              <span>All 3 done today · Review warm-up</span>
            </>
          ) : doneCount > 0 ? (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>Continue today&apos;s plan ({doneCount} of 3)</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>Start today&apos;s plan</span>
            </>
          )}
        </button>
      </div>

      {/* Step 1 Modal: FSRS Vocab Warm-up */}
      {showVocabWarmup && (
        <VocabWarmupModal
          cards={vocabItem.warmupCards}
          config={config}
          onReviewFsrs={onReviewVocabFsrs}
          onLogHistory={onLogHistory}
          onComplete={() => onMarkPlanStepDone('vocab', dateKey)}
          onClose={() => setShowVocabWarmup(false)}
        />
      )}

      {/* Step 2 Modal: Brief DLPT or Gist Drill */}
      {activeBriefModal === 'dlpt' && (
        <Suspense fallback={null}>
          <BriefDrillModal
            item={briefItem.briefItem}
            allPassages={briefPool}
            config={config}
            vocabItems={vocabItems}
            onClose={() => setActiveBriefModal(null)}
            onLogHistory={onLogHistory}
            onSaveDlptResult={(result) => {
              onSaveDlptResult(result);
              onMarkPlanStepDone('brief', dateKey);
            }}
            onAppendErrorEvents={onAppendErrorEvents}
            onSaveVocab={onSaveVocab}
            onBriefItBack={(story) => {
              setActiveBriefModal(null);
              onBriefItBack(story);
            }}
          />
        </Suspense>
      )}

      {activeBriefModal === 'gist' && (
        <Suspense fallback={null}>
          <BriefGistModal
            item={briefItem.briefItem}
            audioPool={audioPool.length > 0 ? audioPool : [briefItem.briefItem]}
            config={config}
            vocabItems={vocabItems}
            onClose={() => setActiveBriefModal(null)}
            onLogHistory={(entry) => {
              onLogHistory(entry);
              onMarkPlanStepDone('brief', dateKey);
            }}
            onRecordErrorLog={onRecordErrorLog}
            onAppendErrorEvents={onAppendErrorEvents}
            onSaveVocab={onSaveVocab}
          />
        </Suspense>
      )}

      {/* Step 3 Modal: 2-Min Fix Drill */}
      {activeFixKey && (
        <FixDrillModal
          errorKey={activeFixKey}
          config={config}
          onClose={() => {
            setActiveFixKey(null);
            setActiveFixIsPlanStep(false);
          }}
          onLogHistory={(entry) => {
            onLogHistory(entry);
            if (activeFixIsPlanStep) {
              onMarkPlanStepDone('speaking', dateKey);
            }
          }}
        />
      )}
    </div>
  );
};
