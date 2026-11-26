import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookmarkCheck,
  BookmarkPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileCheck2,
  Loader2,
  MinusCircle,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  XCircle,
} from 'lucide-react';
import type {IlrBaseLevel, IlrFunctionKey} from '../data/ilrSpeakingLevels';
import type {
  AppendErrorEventsFn,
  DebriefReport,
  IlrFunctionRating,
  OpiAccuracyNote,
  OpiRedoRecord,
  OpiSession,
  RoleplayDebriefResult,
  RoleplayScenarioPublic,
  TargetLanguage,
  VocabItem,
} from '../types';
import {
  filterItemsByLanguage,
  formatSecondsClock,
  getDialectInfo,
  getDomainInfo,
  LANGUAGE_LABELS,
  resolveActiveSessionForLanguage,
} from '../utils/ilrLogic';
import {extractClipWindow, normalizeLevelFunctions, splitProblemSpan} from '../utils/opiLogic';
import {roleplayChecklistToAssessments} from '../utils/opiRoleplay';
import {
  calculateOpiRating,
  HIGHER_LEVELS_NOT_RATED_NOTE,
  PRACTICE_RATING_DISCLAIMER,
  resolvePrimaryRetryFunction,
} from '../utils/opiRating';
import {loadOpiAudioForSession, type StoredOpiAudio} from '../utils/opiAudioStore';
import {gradeRoleplayDebrief, runSessionDebrief} from '../services/api';
import {CeilingRedoPanel} from './debrief/CeilingRedoPanel';

interface DebriefModuleProps {
  language: TargetLanguage;
  sessions: OpiSession[];
  selectedSessionId: string;
  onSelectSession: (id: string) => void;
  onSaveDebrief: (sessionId: string, report: DebriefReport) => void;
  onSaveRoleplayDebrief?: (sessionId: string, rpDebrief: RoleplayDebriefResult) => void;
  onSaveRedo?: (sessionId: string, record: OpiRedoRecord) => void;
  onSaveVocab: (item: Omit<VocabItem, 'id' | 'createdAt' | 'mastery' | 'reviewCount'>) => void;
  onAppendErrorEvents?: AppendErrorEventsFn;
  onStartTargetedRetry?: (functionKey: IlrFunctionKey) => void;
  onReplayRoleplayWithTwist?: (payload: {
    scenario: RoleplayScenarioPublic;
    hiddenGoal: string;
    complication: string;
  }) => void;
}

const STATUS_BADGE: Record<
  IlrFunctionRating,
  {label: string; className: string; icon: React.FC<{className?: string}>}
> = {
  met: {
    label: 'Met',
    className: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
    icon: CheckCircle2,
  },
  partly: {
    label: 'Partly',
    className: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
    icon: MinusCircle,
  },
  not_met: {
    label: 'Not met',
    className: 'text-[#F87171] bg-red-500/10 border-[#F87171]/35',
    icon: XCircle,
  },
};

const ACCURACY_STATUS_STYLE: Record<OpiAccuracyNote['status'], {label: string; className: string}> = {
  strength: {label: 'Strength', className: 'text-emerald-300'},
  watch: {label: 'Developing', className: 'text-amber-300'},
  gap: {label: 'Ceiling signal', className: 'text-[#F87171]'},
};

const ROLEPLAY_STATUS_BADGE: Record<
  IlrFunctionRating,
  {label: string; className: string; icon: React.FC<{className?: string}>}
> = {
  met: {
    label: 'Met',
    className: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
    icon: CheckCircle2,
  },
  partly: {
    label: 'Partly',
    className: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
    icon: MinusCircle,
  },
  not_met: {
    label: 'Missed',
    className: 'text-[#F87171] bg-red-500/10 border-[#F87171]/35',
    icon: XCircle,
  },
};

export const DebriefModule: React.FC<DebriefModuleProps> = ({
  language,
  sessions,
  selectedSessionId,
  onSelectSession,
  onSaveDebrief,
  onSaveRoleplayDebrief,
  onSaveRedo,
  onSaveVocab,
  onAppendErrorEvents,
  onStartTargetedRetry,
  onReplayRoleplayWithTwist,
}) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({});
  const [redoOpen, setRedoOpen] = useState(false);
  const [showDetailedAudit, setShowDetailedAudit] = useState(false);
  const [expandedEvidenceKeys, setExpandedEvidenceKeys] = useState<Record<string, boolean>>({});

  // Local IndexedDB clip playback state
  const [storedAudio, setStoredAudio] = useState<StoredOpiAudio | null>(null);
  const [isPlayingClip, setIsPlayingClip] = useState(false);
  const [clipNotice, setClipNotice] = useState<string | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const autoAnalyzedRef = useRef<Set<string>>(new Set());
  const autoSavedVocabRef = useRef<Set<string>>(new Set());

  const languageSessions = useMemo(() => filterItemsByLanguage(sessions, language), [sessions, language]);

  const activeSession = useMemo(
    () => resolveActiveSessionForLanguage(sessions, selectedSessionId, language),
    [sessions, selectedSessionId, language]
  );

  const stopClipPlayback = useCallback(() => {
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setIsPlayingClip(false);
  }, []);

  useEffect(() => {
    return () => stopClipPlayback();
  }, [stopClipPlayback]);

  const activeSessionId = activeSession?.id;

  // Reset per-session transient UI state and check local IndexedDB for last-session mic audio
  useEffect(() => {
    stopClipPlayback();
    setError(null);
    setClipNotice(null);
    setRedoOpen(false);
    setSavedKeys({});
    setExpandedEvidenceKeys({});
    if (!activeSessionId) {
      setStoredAudio(null);
      return;
    }
    let cancelled = false;
    loadOpiAudioForSession(activeSessionId).then((audio) => {
      if (!cancelled) setStoredAudio(audio);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, stopClipPlayback]);

  const hasCandidateSpeech = Boolean(
    activeSession?.messages.some((m) => m.role === 'candidate' && m.text.trim().length > 0)
  );

  const handleAnalyze = useCallback(async () => {
    if (!activeSession) return;
    setIsAnalyzing(true);
    setError(null);
    try {
      const dialectInfo = getDialectInfo(activeSession.language, activeSession.dialect);
      let combinedAssessments = [...(activeSession.assessments ?? [])];

      // 1. If this session contains a role-play (standalone OR embedded inside OPI), grade its 3-item checklist & reveal twist
      if (activeSession.roleplayScenario && !activeSession.roleplayDebrief) {
        const sc = activeSession.roleplayScenario;
        const rpMsgs =
          activeSession.type === 'roleplay'
            ? activeSession.messages
            : activeSession.messages.filter((m) => m.phase === 'roleplay');
        const sourceMsgs = rpMsgs.length > 0 ? rpMsgs : activeSession.messages;
        const hasRpCandidateSpeech = sourceMsgs.some((m) => m.role === 'candidate' && m.text.trim().length > 0);
        if (hasRpCandidateSpeech) {
          const rpDebrief = await gradeRoleplayDebrief({
            scenarioId: sc.scenarioId,
            language: activeSession.language,
            dialect: dialectInfo.id,
            level: sc.level,
            situationEnglish: sc.situationEnglish,
            learnerGoal: sc.learnerGoal,
            register: sc.register,
            characterRole: sc.characterRole,
            messages: sourceMsgs.map((m) => ({
              role: m.role,
              text: m.text,
              elapsedSeconds: m.elapsedSeconds,
            })),
          });
          onSaveRoleplayDebrief?.(activeSession.id, rpDebrief);
          if (rpDebrief.errors && rpDebrief.errors.length > 0) {
            onAppendErrorEvents?.(
              rpDebrief.errors.map((errItem) => ({
                key: errItem.key,
                source: 'roleplay',
                sessionId: activeSession.id,
                wrong: errItem.wrong,
                fix: errItem.fix,
                quote: errItem.quote,
                language: activeSession.language,
              }))
            );
          }
          combinedAssessments = [
            ...combinedAssessments,
            ...roleplayChecklistToAssessments(rpDebrief.level, rpDebrief.checklist),
          ];
        }
      } else if (activeSession.roleplayDebrief) {
        combinedAssessments = [
          ...combinedAssessments,
          ...roleplayChecklistToAssessments(
            activeSession.roleplayDebrief.level,
            activeSession.roleplayDebrief.checklist
          ),
        ];
      }

      // 2. Run main ILR debrief using combined assessments (including role-play checklist evidence)
      const report = await runSessionDebrief({
        language: activeSession.language,
        dialect: dialectInfo.id,
        sessionType: activeSession.type,
        ...(activeSession.type === 'prep_monologue' && activeSession.domain ? {domain: activeSession.domain} : {}),
        assessments: combinedAssessments,
        messages: activeSession.messages.map((m) => ({
          role: m.role,
          text: m.text,
          elapsedSeconds: m.elapsedSeconds,
        })),
      });
      onSaveDebrief(activeSession.id, report);
      if (report.errors && report.errors.length > 0) {
        onAppendErrorEvents?.(
          report.errors.map((errItem) => ({
            key: errItem.key,
            source: activeSession.type === 'roleplay' ? 'roleplay' : 'opi',
            sessionId: activeSession.id,
            wrong: errItem.wrong,
            fix: errItem.fix,
            quote: errItem.quote,
            language: activeSession.language,
          }))
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate ILR debrief.');
    } finally {
      setIsAnalyzing(false);
    }
  }, [activeSession, onAppendErrorEvents, onSaveDebrief, onSaveRoleplayDebrief]);

  // Auto-run diagnostic analysis when a freshly ended OPI or Role-play session has candidate speech and no debrief yet
  useEffect(() => {
    const needsMainDebrief = Boolean(activeSession && !activeSession.debrief);
    const needsRpDebrief = Boolean(activeSession?.roleplayScenario && !activeSession?.roleplayDebrief);
    if (!activeSession || (!needsMainDebrief && !needsRpDebrief) || !hasCandidateSpeech || isAnalyzing) return;
    if (autoAnalyzedRef.current.has(activeSession.id)) return;
    autoAnalyzedRef.current.add(activeSession.id);
    void handleAnalyze();
  }, [activeSession, hasCandidateSpeech, isAnalyzing, handleAnalyze]);

  // Auto-add debrief vocabulary items to Vocab once per generated debrief
  useEffect(() => {
    if (!activeSession?.debrief) return;
    const key = `${activeSession.id}:${activeSession.debrief.generatedAt}`;
    if (autoSavedVocabRef.current.has(key)) return;
    const autoWords = activeSession.debrief.autoAddedVocab ?? [];
    if (autoWords.length === 0) return;
    autoSavedVocabRef.current.add(key);
    for (const item of autoWords) {
      onSaveVocab({
        term: item.term,
        englishConcept: item.englishConcept,
        contextSentence: item.contextSentence,
        registerTag: item.registerTag,
        category: item.category,
        language: activeSession.language,
        dialect: activeSession.dialect,
        ...(activeSession.domain ? {domain: activeSession.domain} : {}),
        source: 'opi',
      });
    }
  }, [activeSession, onSaveVocab]);

  const handlePlayBreakdownClip = () => {
    if (!activeSession?.debrief?.ceilingMoment) return;
    if (isPlayingClip) {
      stopClipPlayback();
      return;
    }
    if (!storedAudio) {
      setClipNotice('Mic audio is stored locally for your most recent recorded call only.');
      return;
    }
    setClipNotice(null);
    const url = URL.createObjectURL(storedAudio.blob);
    audioUrlRef.current = url;
    const audio = new Audio(url);
    audioElRef.current = audio;

    const {startSec, endSec} = extractClipWindow(
      activeSession.debrief.ceilingMoment.timestampSeconds,
      storedAudio.durationSeconds || activeSession.durationSeconds
    );

    audio.onloadedmetadata = () => {
      const safeDur =
        Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : storedAudio.durationSeconds;
      audio.currentTime = Math.min(startSec, Math.max(0, safeDur - 1));
    };
    audio.ontimeupdate = () => {
      if (audio.currentTime >= endSec) {
        stopClipPlayback();
      }
    };
    audio.onended = () => stopClipPlayback();
    audio.onerror = () => {
      stopClipPlayback();
      setClipNotice('Unable to play the local audio clip in this browser.');
    };

    setIsPlayingClip(true);
    audio.play().catch(() => {
      stopClipPlayback();
      setClipNotice('Audio playback was blocked or unavailable.');
    });
  };

  const handleSaveConnector = (connector: string, upgradedSentence: string, idx: number) => {
    if (!activeSession) return;
    const key = `conn-${idx}-${connector}`;
    onSaveVocab({
      term: connector,
      englishConcept: 'High-register connector (from debrief upgrade)',
      contextSentence: upgradedSentence,
      registerTag: 'High-Register Connector',
      category: 'High-Register Connectors',
      language: activeSession.language,
      dialect: activeSession.dialect,
      ...(activeSession.domain ? {domain: activeSession.domain} : {}),
      source: 'opi',
    });
    setSavedKeys((prev) => ({...prev, [key]: true}));
  };

  const toggleEvidence = (fnKey: string) => {
    setExpandedEvidenceKeys((prev) => ({...prev, [fnKey]: !prev[fnKey]}));
  };

  if (!activeSession) {
    return (
      <div className="rounded-xl border border-[#23303E] bg-[#111922] p-10 text-center space-y-2">
        <h1 className="font-display text-xl font-semibold text-[#F8FAFC]">
          No Completed {LANGUAGE_LABELS[language]} Sessions Yet
        </h1>
        <p className="text-sm text-[#94A3B8]">
          Complete a {LANGUAGE_LABELS[language]} OPI call or PREP monologue to unlock your speaking debrief.
        </p>
      </div>
    );
  }

  const dialectInfo = getDialectInfo(activeSession.language, activeSession.dialect);
  const report = activeSession.debrief;
  const rpDebrief = activeSession.roleplayDebrief;
  const combinedFallbackAssessments = rpDebrief
    ? [...(activeSession.assessments ?? []), ...roleplayChecklistToAssessments(rpDebrief.level, rpDebrief.checklist)]
    : (activeSession.assessments ?? []);
  const ratingFallback = calculateOpiRating(combinedFallbackAssessments);
  const gridLevel: IlrBaseLevel = report?.gridLevel ?? ratingFallback.gridLevel;
  const levelFunctions = report ? normalizeLevelFunctions(report.levelFunctions, gridLevel) : [];
  const accuracyNotes = report?.accuracyNotes?.length ? report.accuracyNotes : ratingFallback.accuracyNotes;
  const primaryRetryFn = report
    ? resolvePrimaryRetryFunction(levelFunctions, report.ceilingMoment?.failedFunction)
    : null;
  const ceiling = report?.ceilingMoment;
  const splitSpan = ceiling ? splitProblemSpan(ceiling.candidateUtterance, ceiling.problemSpan) : null;
  const autoVocab = report?.autoAddedVocab ?? [];

  const displayRating = report?.estimatedIlr || ratingFallback.displayRating;
  const isLevel3Rating = displayRating === '3' || report?.floorLevel === 3;
  const floorLabel = report?.floorLevel ?? ratingFallback.floor;
  const ceilingLabel = report?.ceilingLevel !== undefined ? report.ceilingLevel : ratingFallback.ceiling;

  return (
    <div className="space-y-6 pb-24 md:pb-8">
      {/* Header & Session Picker (Domain shown only for PREP monologues, never for general OPI or Role-play) */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-5 border-b border-[#23303E]">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-[#94A3B8]">
            Post-Call Debrief · {LANGUAGE_LABELS[activeSession.language]} ({dialectInfo.short})
            {activeSession.type === 'roleplay' && activeSession.roleplayScenario
              ? ` · Role-play Level ${activeSession.roleplayScenario.level}`
              : activeSession.type === 'prep_monologue' && activeSession.domain
                ? ` · ${getDomainInfo(activeSession.domain).shortLabel}`
                : ''}
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[#F8FAFC]">
            Speaking Debrief
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2">
            <label htmlFor="debrief-session-select" className="text-xs text-[#94A3B8] whitespace-nowrap">
              Session
            </label>
            <select
              id="debrief-session-select"
              value={activeSession.id}
              onChange={(e) => onSelectSession(e.target.value)}
              className="min-h-[44px] rounded-lg border border-[#23303E] bg-[#111922] px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#D99B26] max-w-[260px]"
            >
              {languageSessions.map((s) => {
                const dial = getDialectInfo(s.language, s.dialect).short;
                const labelDetail = s.type === 'prep_monologue' && s.domain ? getDomainInfo(s.domain).shortLabel : dial;
                const typeLabel = s.type === 'prep_monologue' ? 'PREP' : s.type === 'roleplay' ? 'Role-play' : 'OPI';
                const dateStr = new Date(s.startedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                });
                return (
                  <option key={s.id} value={s.id}>
                    {LANGUAGE_LABELS[s.language]} · {labelDetail} ({typeLabel} · {dateStr})
                  </option>
                );
              })}
            </select>
          </div>

          {hasCandidateSpeech && (
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-lg border border-[#2E4054] bg-[#16202B] text-xs font-medium text-[#E6EDF3] hover:bg-[#1E2C3A] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {isAnalyzing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D99B26]" />
              ) : (
                <FileCheck2 className="w-3.5 h-3.5 text-[#D99B26]" />
              )}
              <span>{isAnalyzing ? 'Analyzing…' : report ? 'Re-analyze' : 'Run Debrief'}</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-[#F87171]/40 bg-red-950/30 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      {/* Session Meta Strip */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#94A3B8]">
        {activeSession.mode && (
          <>
            <span className="text-[#CBD5E1] font-medium">
              {activeSession.mode === 'exam' ? 'Exam mode' : 'Practice mode'}
            </span>
            <span aria-hidden="true">·</span>
          </>
        )}
        <span className="font-mono tabular-nums">Duration {formatSecondsClock(activeSession.durationSeconds)}</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono tabular-nums">{activeSession.messages.length} turns</span>
      </div>

      {!report ? (
        <div className="rounded-xl border border-[#23303E] bg-[#111922] p-6 sm:p-8 space-y-4">
          {isAnalyzing ? (
            <div role="status" className="flex items-center gap-3 text-sm text-[#CBD5E1]">
              <Loader2 className="w-5 h-5 animate-spin text-[#D99B26] shrink-0" />
              <div>
                <p className="font-semibold text-[#F8FAFC]">Auditing your call transcript…</p>
                <p className="text-xs text-[#94A3B8] mt-0.5">
                  Computing ILR floor &amp; ceiling, pinpointing breakdowns, and mapping accuracy descriptors.
                </p>
              </div>
            </div>
          ) : !hasCandidateSpeech ? (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-[#F8FAFC]">Call ended before a response was recorded</h2>
              <p className="text-sm text-[#94A3B8]">
                Start another call and answer at least one examiner prompt to generate a speaking debrief and breakdown
                analysis.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <h2 className="text-lg font-semibold text-[#F8FAFC]">Ready to generate your debrief</h2>
                <p className="text-sm text-[#94A3B8]">
                  Run diagnostic grading to see your estimated speaking level (0+ to 3), ceiling breakdown moment,
                  next-level function scores, and accuracy notes.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAnalyze}
                className="inline-flex items-center gap-2 px-5 min-h-[52px] rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
              >
                <FileCheck2 className="w-4 h-4" />
                <span>Run Diagnostic Debrief</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* 1. Estimated Speaking Level (0+..3 with Floor/Ceiling & mandatory disclaimer) */}
          <section
            data-testid="debrief-level-card"
            className="rounded-xl border border-[#23303E] bg-[#111922] p-5 sm:p-6 space-y-2.5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-[#94A3B8]">Estimated speaking level</span>
              <span data-testid="debrief-estimate-disclaimer" className="text-xs font-medium text-[#7DD3FC]">
                {PRACTICE_RATING_DISCLAIMER}
              </span>
            </div>

            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-[#F8FAFC]">
                ILR {displayRating}
              </h2>
              <p className="text-xs text-[#94A3B8] font-mono tabular-nums">
                Floor: Level {floorLabel}
                {ceilingLabel !== null ? ` · Ceiling: Level ${ceilingLabel}` : ''}
              </p>
            </div>

            {isLevel3Rating && (
              <p data-testid="debrief-higher-levels-note" className="text-xs font-medium text-[#D99B26]">
                {report.ratingNote || HIGHER_LEVELS_NOT_RATED_NOTE}
              </p>
            )}

            <p className="text-sm sm:text-[15px] text-[#CBD5E1] leading-relaxed">
              {report.oneLineRationale || report.summaryAssessment}
            </p>
          </section>

          {/* 1b. Role-play Debrief Card (Hidden goal & complication revealed + 3-item checklist + Replay CTA) */}
          {rpDebrief && (
            <section
              data-testid="roleplay-debrief-card"
              className="rounded-xl border-2 border-[#D99B26]/70 bg-[#111922] p-5 sm:p-6 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#F3C669]">
                    Role-play debrief · Level {rpDebrief.level}
                  </p>
                  <h2 className="font-display text-lg font-semibold text-[#F8FAFC] mt-0.5">
                    {rpDebrief.characterRole} ({rpDebrief.register})
                  </h2>
                </div>
                <span className="px-2.5 py-1 rounded-lg border border-[#23303E] bg-[#0B1117] text-xs font-semibold text-[#7DD3FC] capitalize">
                  {rpDebrief.resolvedOutcome}
                </span>
              </div>

              <p className="text-sm text-[#CBD5E1] leading-relaxed">{rpDebrief.summary}</p>

              {/* Revealed server-side secrets */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-lg border border-[#23303E] bg-[#0B1117] p-3.5 space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#7DD3FC]">
                    Hidden goal revealed
                  </span>
                  <p data-testid="roleplay-hidden-goal" className="text-xs sm:text-sm text-[#E6EDF3] leading-relaxed">
                    {rpDebrief.hiddenGoal}
                  </p>
                </div>

                <div className="rounded-lg border border-[#23303E] bg-[#0B1117] p-3.5 space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#F3C669]">
                    Complication revealed
                  </span>
                  <p data-testid="roleplay-complication" className="text-xs sm:text-sm text-[#E6EDF3] leading-relaxed">
                    {rpDebrief.complication}
                  </p>
                </div>
              </div>

              {/* Level-specific 3-item checklist (Met / Partly / Missed + 1 quoted evidence line) */}
              <div className="space-y-2.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
                  Level {rpDebrief.level} checklist
                </span>
                <div className="space-y-2">
                  {rpDebrief.checklist.map((item) => {
                    const badge = ROLEPLAY_STATUS_BADGE[item.status] ?? ROLEPLAY_STATUS_BADGE.partly;
                    const Icon = badge.icon;
                    return (
                      <div
                        key={item.itemKey}
                        data-testid={`roleplay-check-${item.itemKey}`}
                        className="rounded-lg border border-[#23303E] bg-[#0B1117] p-3.5 space-y-1.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-[#F8FAFC]">{item.label}</span>
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-semibold shrink-0 ${badge.className}`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            <span>{badge.label}</span>
                          </span>
                        </div>
                        <p className="text-xs text-[#94A3B8] leading-relaxed">{item.evidence}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {activeSession.roleplayScenario && onReplayRoleplayWithTwist && (
                <div className="pt-1 flex justify-end">
                  <button
                    type="button"
                    data-testid="roleplay-replay-btn"
                    onClick={() =>
                      onReplayRoleplayWithTwist({
                        scenario: activeSession.roleplayScenario!,
                        hiddenGoal: rpDebrief.hiddenGoal,
                        complication: rpDebrief.complication,
                      })
                    }
                    className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-xl border border-[#D99B26]/60 bg-[#D99B26]/12 text-sm font-semibold text-[#F3C669] hover:bg-[#D99B26]/22 transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Replay with the twist known</span>
                  </button>
                </div>
              )}
            </section>
          )}

          {/* 2. Where It Broke Down (Ceiling Moment) */}
          {ceiling && (
            <section
              data-testid="debrief-ceiling-card"
              className="rounded-xl border border-[#23303E] bg-[#111922] p-5 sm:p-6 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-[#F87171] shrink-0" />
                  <h2 className="font-display text-lg font-semibold text-[#F8FAFC]">Where it broke down</h2>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono tabular-nums px-2 py-0.5 rounded bg-[#0B1117] border border-[#23303E] text-[#CBD5E1]">
                    {formatSecondsClock(ceiling.timestampSeconds)}
                  </span>
                  <span className="px-2.5 py-0.5 rounded bg-red-500/10 border border-[#F87171]/35 text-[#F87171] font-medium">
                    {ceiling.failedFunctionLabel}
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                {ceiling.examinerPrompt && (
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-[#7D8FA3]">Examiner prompt</span>
                    <p className="text-sm text-[#CBD5E1] leading-relaxed">&ldquo;{ceiling.examinerPrompt}&rdquo;</p>
                  </div>
                )}

                <div className="rounded-lg border border-[#23303E] bg-[#0B1117] p-4 space-y-3">
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-[#94A3B8]">What you said</span>
                    <p className="text-sm text-[#E6EDF3] leading-relaxed">
                      &ldquo;
                      {splitSpan?.match ? (
                        <>
                          {splitSpan.before}
                          <mark
                            data-testid="ceiling-problem-span"
                            className="rounded bg-[#F87171]/20 text-[#FCA5A5] px-1 py-0.5 underline decoration-[#F87171] decoration-wavy underline-offset-2"
                          >
                            {splitSpan.match}
                          </mark>
                          {splitSpan.after}
                        </>
                      ) : (
                        ceiling.candidateUtterance
                      )}
                      &rdquo;
                    </p>
                  </div>

                  {ceiling.fix && (
                    <div className="pt-3 border-t border-[#1D2835] space-y-1">
                      <span className="text-xs font-medium text-emerald-400">Natural fix</span>
                      <p className="text-sm font-medium text-[#F8FAFC] leading-relaxed">&ldquo;{ceiling.fix}&rdquo;</p>
                    </div>
                  )}

                  {ceiling.explanation && (
                    <p className="text-xs text-[#94A3B8] leading-relaxed">{ceiling.explanation}</p>
                  )}
                </div>
              </div>

              {/* Action Row: Play clip + Redo this answer */}
              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <button
                  type="button"
                  data-testid="debrief-play-clip-btn"
                  onClick={handlePlayBreakdownClip}
                  className={`inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl border text-xs sm:text-sm font-medium transition-colors ${
                    storedAudio
                      ? 'border-[#2E4054] bg-[#16202B] text-[#F8FAFC] hover:border-[#D99B26]'
                      : 'border-[#23303E] bg-[#0B1117] text-[#94A3B8] hover:text-[#CBD5E1]'
                  }`}
                >
                  {isPlayingClip ? (
                    <Square className="w-3.5 h-3.5 text-[#F87171]" />
                  ) : (
                    <Play className="w-3.5 h-3.5 text-[#D99B26]" />
                  )}
                  <span>{isPlayingClip ? 'Stop clip' : 'Play clip'}</span>
                </button>

                <button
                  type="button"
                  data-testid="debrief-redo-answer-btn"
                  onClick={() => setRedoOpen((o) => !o)}
                  className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl border border-[#7DD3FC]/40 bg-[#7DD3FC]/10 text-[#7DD3FC] text-xs sm:text-sm font-semibold hover:bg-[#7DD3FC]/20 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{activeSession.redoRecord ? 'View / Redo this answer' : 'Redo this answer'}</span>
                </button>
              </div>

              {clipNotice && <p className="text-xs text-[#94A3B8]">{clipNotice}</p>}

              {redoOpen && (
                <CeilingRedoPanel
                  session={activeSession}
                  ceiling={ceiling}
                  existingRedo={activeSession.redoRecord}
                  onSaveRedo={(sid, rec) => onSaveRedo?.(sid, rec)}
                  onAppendErrorEvents={onAppendErrorEvents}
                  onClose={() => setRedoOpen(false)}
                />
              )}
            </section>
          )}

          {/* 3. Interactive Functions Grid for Level Just Above the Floor */}
          <section
            data-testid="debrief-functions-grid"
            className="rounded-xl border border-[#23303E] bg-[#111922] p-5 sm:p-6 space-y-4"
          >
            <div className="space-y-1">
              <h2 className="font-display text-lg font-semibold text-[#F8FAFC]">Level {gridLevel} functions</h2>
              <p className="text-xs text-[#94A3B8]">
                {floorLabel >= 3
                  ? 'ILR Level 3 core functions evaluated across this interview. Tap any card to inspect turn evidence.'
                  : `Next-level benchmark above your Level ${floorLabel} floor. Tap any card to inspect turn evidence.`}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {levelFunctions.map((fn) => {
                const badge = STATUS_BADGE[fn.status];
                const Icon = badge.icon;
                const isExpanded = Boolean(expandedEvidenceKeys[fn.functionKey]);
                const evidenceItems = fn.evidence && fn.evidence.length > 0 ? fn.evidence : [];
                return (
                  <button
                    key={fn.functionKey}
                    type="button"
                    data-testid={`fn-card-${fn.functionKey}`}
                    aria-expanded={isExpanded}
                    onClick={() => toggleEvidence(fn.functionKey)}
                    className="w-full text-left rounded-xl border border-[#23303E] bg-[#0B1117] hover:border-[#35495E] p-4 min-h-[44px] space-y-2 transition-colors"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[#F8FAFC]">{fn.label}</span>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-semibold shrink-0 ${badge.className}`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{badge.label}</span>
                      </span>
                    </span>

                    {fn.note && <span className="block text-xs text-[#94A3B8] leading-relaxed">{fn.note}</span>}

                    <span className="flex items-center justify-between pt-0.5 text-[11px] font-medium text-[#7DD3FC]">
                      <span>
                        {evidenceItems.length > 0 ? `Evidence (${evidenceItems.length})` : 'View assessment details'}
                      </span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </span>

                    {isExpanded && (
                      <span
                        data-testid={`fn-evidence-${fn.functionKey}`}
                        className="block mt-2 pt-2.5 border-t border-[#1D2835] space-y-1.5 text-xs text-[#CBD5E1]"
                      >
                        {evidenceItems.length > 0 ? (
                          evidenceItems.map((ev) => (
                            <span key={ev} className="block leading-relaxed text-[#CBD5E1]">
                              • {ev}
                            </span>
                          ))
                        ) : (
                          <span className="block text-[#94A3B8]">
                            {fn.note || 'No direct turn quote recorded for this function.'}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* 4. Accuracy Notes mapped to ILR Descriptors */}
          {accuracyNotes.length > 0 && (
            <section
              data-testid="debrief-accuracy-notes"
              className="rounded-xl border border-[#23303E] bg-[#111922] p-5 sm:p-6 space-y-4"
            >
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#7DD3FC] shrink-0" />
                <div>
                  <h2 className="font-display text-lg font-semibold text-[#F8FAFC]">Accuracy notes</h2>
                  <p className="text-xs text-[#94A3B8]">
                    Speech accuracy and comprehensibility against ILR Level {floorLabel === 0 ? 1 : gridLevel}{' '}
                    benchmarks.
                  </p>
                </div>
              </div>

              <ul className="divide-y divide-[#1D2835]">
                {accuracyNotes.map((item) => {
                  const style = ACCURACY_STATUS_STYLE[item.status] ?? ACCURACY_STATUS_STYLE.watch;
                  return (
                    <li key={item.descriptor} className="py-3 first:pt-0 last:pb-0 space-y-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-[#F8FAFC]">{item.descriptor}</span>
                        <span className={`text-xs font-semibold ${style.className}`}>{style.label}</span>
                      </div>
                      <p className="text-xs text-[#94A3B8] leading-relaxed">{item.observation}</p>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* 5. Words Auto-Added to Vocab */}
          {autoVocab.length > 0 && (
            <section
              data-testid="debrief-auto-vocab"
              className="rounded-xl border border-[#23303E] bg-[#111922] p-5 sm:p-6 space-y-3"
            >
              <div className="flex items-center gap-2">
                <BookmarkCheck className="w-4 h-4 text-[#D99B26]" />
                <h2 className="font-display text-base font-semibold text-[#F8FAFC]">Words auto-added to Vocab</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {autoVocab.map((item) => (
                  <div
                    key={item.term}
                    className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 max-w-full rounded-lg border border-[#2E4054] bg-[#0B1117] px-3 py-2 text-xs leading-snug"
                  >
                    <span className="font-semibold text-[#F8FAFC] whitespace-nowrap">{item.term}</span>
                    {item.englishConcept && <span className="text-[#94A3B8]">— {item.englishConcept}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 6. Secondary CTA: Targeted 3-Minute Probe Retry */}
          {primaryRetryFn && onStartTargetedRetry && (
            <section className="rounded-xl border border-[#D99B26]/35 bg-[#131B24] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-[#D99B26]">Targeted follow-up</p>
                <p className="text-sm text-[#CBD5E1]">
                  Run a focused 3-minute call drilling only{' '}
                  <span className="text-[#F8FAFC] font-medium">{primaryRetryFn.label}</span>.
                </p>
              </div>
              <button
                type="button"
                data-testid="debrief-retry-probe-btn"
                onClick={() => onStartTargetedRetry(primaryRetryFn.functionKey)}
                className="inline-flex items-center justify-center gap-2 min-h-[52px] px-5 rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors whitespace-nowrap shrink-0"
              >
                <span>Retry the {primaryRetryFn.label} probe · 3 min</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </section>
          )}

          {/* 7. Expandable Detailed Discourse Audit & Natural Upgrades */}
          <div className="rounded-xl border border-[#23303E] bg-[#111922] overflow-hidden">
            <button
              type="button"
              onClick={() => setShowDetailedAudit((s) => !s)}
              aria-expanded={showDetailedAudit}
              className="w-full px-5 py-4 min-h-[52px] flex items-center justify-between gap-3 text-left hover:bg-[#141E29] transition-colors"
            >
              <div>
                <p className="text-sm font-semibold text-[#F8FAFC]">Full Discourse Audit &amp; Natural Upgrades</p>
                <p className="text-xs text-[#94A3B8]">
                  PREP cohesion scores, subjunctive &amp; time-frame notes, and sentence upgrades
                </p>
              </div>
              {showDetailedAudit ? (
                <ChevronUp className="w-4 h-4 text-[#94A3B8] shrink-0" />
              ) : (
                <ChevronDown className="w-4 h-4 text-[#94A3B8] shrink-0" />
              )}
            </button>

            {showDetailedAudit && (
              <div className="px-5 pb-6 pt-2 border-t border-[#23303E] space-y-6">
                <p className="text-sm text-[#CBD5E1] leading-relaxed">{report.summaryAssessment}</p>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    {label: 'Point (Thesis)', value: report.discourseAudit.pointScore},
                    {label: 'Reason (Systemic)', value: report.discourseAudit.reasonScore},
                    {label: 'Example (Concrete)', value: report.discourseAudit.exampleScore},
                    {label: 'Pivot / Conclusion', value: report.discourseAudit.pivotScore},
                  ].map((metric) => (
                    <div key={metric.label} className="space-y-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs text-[#94A3B8]">{metric.label}</span>
                        <span className="font-mono text-sm font-semibold text-[#F8FAFC] tabular-nums">
                          {metric.value}/100
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-[#1C2836] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#D99B26]"
                          style={{width: `${Math.max(0, Math.min(100, metric.value))}%`}}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-4 border-t border-[#23303E]">
                  <div className="space-y-1">
                    <h3 className="text-xs font-semibold text-[#E6EDF3]">Paragraph Cohesion</h3>
                    <p className="text-sm text-[#94A3B8] leading-relaxed">{report.discourseAudit.cohesionNotes}</p>
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-xs font-semibold text-[#7DD3FC]">Subjunctive &amp; Conditional Control</h3>
                    <p className="text-sm text-[#94A3B8] leading-relaxed">{report.discourseAudit.subjunctiveControl}</p>
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-xs font-semibold text-amber-300">Time-Frame Stability</h3>
                    <p className="text-sm text-[#94A3B8] leading-relaxed">{report.discourseAudit.timeFrameStability}</p>
                  </div>
                </div>

                {report.naturalUpgrades.length > 0 && (
                  <div className="pt-4 border-t border-[#23303E] divide-y divide-[#23303E]">
                    {report.naturalUpgrades.map((item, idx) => (
                      <div key={item.originalLevel2} className="py-4 first:pt-0 last:pb-0 space-y-2.5">
                        <div className="grid grid-cols-1 lg:grid-cols-11 gap-3 items-center">
                          <div className="lg:col-span-5 space-y-1">
                            <span className="text-xs font-medium text-[#7D8FA3]">What You Said</span>
                            <p className="text-sm text-[#CBD5E1] leading-relaxed">
                              &ldquo;{item.originalLevel2}&rdquo;
                            </p>
                          </div>
                          <div className="hidden lg:flex lg:col-span-1 justify-center text-[#D99B26]">
                            <ArrowRight className="w-4 h-4" />
                          </div>
                          <div className="lg:col-span-5 space-y-1">
                            <span className="text-xs font-medium text-emerald-400">
                              Natural Higher-Register Upgrade
                            </span>
                            <p className="text-sm font-medium text-[#F8FAFC] leading-relaxed">
                              &ldquo;{item.upgradedLevel2Plus}&rdquo;
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-[#94A3B8] max-w-2xl">{item.whyItUpgrades}</p>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {item.connectorsUsed.map((conn) => {
                              const key = `conn-${idx}-${conn}`;
                              const isSaved = Boolean(savedKeys[key]);
                              return (
                                <button
                                  key={conn}
                                  type="button"
                                  onClick={() => handleSaveConnector(conn, item.upgradedLevel2Plus, idx)}
                                  disabled={isSaved}
                                  className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 py-1 rounded-md border border-[#2E4054] bg-[#16202B] text-xs font-medium text-[#E6EDF3] hover:border-[#D99B26] disabled:opacity-60 transition-colors"
                                >
                                  {isSaved ? (
                                    <Check className="w-3 h-3 text-emerald-400" />
                                  ) : (
                                    <BookmarkPlus className="w-3 h-3 text-[#D99B26]" />
                                  )}
                                  <span>{conn}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
