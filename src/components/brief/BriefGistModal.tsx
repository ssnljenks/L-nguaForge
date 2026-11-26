import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Headphones,
  Loader2,
  Pause,
  Play,
  Quote,
  Send,
  Sparkles,
  Volume2,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AppendErrorEventsFn,
  BriefItem,
  DrillHistoryEntry,
  GistFinding,
  GistGradeResult,
  MissionConfig,
  RecordErrorLogFn,
  VocabItem,
} from '../../types';
import {gradeBriefGist} from '../../services/api';
import {
  buildGistErrorLogEntries,
  countSummarySentences,
  formatGistCountdown,
  GIST_TIMER_SECONDS,
  pickNextAudioClip,
  segmentGistHighlights,
} from '../../utils/gistLogic';
import {type SaveVocabFn, useWordLookup} from '../../hooks/useWordLookup';
import {TappableText} from '../shared/TappableText';
import {WordLookupPopover} from '../shared/WordLookupPopover';
import {createId} from '../../utils/ids';

interface BriefGistModalProps {
  item: BriefItem;
  audioPool: BriefItem[];
  config: MissionConfig;
  vocabItems: VocabItem[];
  onClose: () => void;
  onLogHistory: (entry: DrillHistoryEntry) => void;
  onRecordErrorLog: RecordErrorLogFn;
  onAppendErrorEvents?: AppendErrorEventsFn;
  onSaveVocab: SaveVocabFn;
}

type GistStage = 'listen' | 'write' | 'grading' | 'result';

interface FidelitySectionProps {
  title: string;
  subtitle: string;
  findings: GistFinding[];
  accent: 'red' | 'amber' | 'sky';
  testId: string;
}

const FidelitySection: React.FC<FidelitySectionProps> = ({title, subtitle, findings, accent, testId}) => {
  const accentStyles =
    accent === 'red'
      ? {
          border: findings.length > 0 ? 'border-[#F87171]/45' : 'border-[#23303E]',
          bg: findings.length > 0 ? 'bg-[#F87171]/8' : 'bg-[#0B1117]',
          titleColor: findings.length > 0 ? 'text-[#FECACA]' : 'text-[#CBD5E1]',
          countColor: findings.length > 0 ? 'text-[#F87171]' : 'text-[#7D8FA3]',
        }
      : accent === 'amber'
        ? {
            border: findings.length > 0 ? 'border-[#D99B26]/45' : 'border-[#23303E]',
            bg: findings.length > 0 ? 'bg-[#D99B26]/8' : 'bg-[#0B1117]',
            titleColor: findings.length > 0 ? 'text-[#F3C669]' : 'text-[#CBD5E1]',
            countColor: findings.length > 0 ? 'text-[#D99B26]' : 'text-[#7D8FA3]',
          }
        : {
            border: findings.length > 0 ? 'border-[#7DD3FC]/40' : 'border-[#23303E]',
            bg: findings.length > 0 ? 'bg-[#7DD3FC]/8' : 'bg-[#0B1117]',
            titleColor: findings.length > 0 ? 'text-[#7DD3FC]' : 'text-[#CBD5E1]',
            countColor: findings.length > 0 ? 'text-[#7DD3FC]' : 'text-[#7D8FA3]',
          };

  return (
    <div data-testid={testId} className={`rounded-xl border p-4 space-y-2.5 ${accentStyles.border} ${accentStyles.bg}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h4 className={`text-xs sm:text-sm font-semibold ${accentStyles.titleColor}`}>{title}</h4>
          <p className="text-[11px] text-[#94A3B8]">{subtitle}</p>
        </div>
        <span className={`font-mono text-xs font-semibold tabular-nums ${accentStyles.countColor}`}>
          {findings.length}
        </span>
      </div>

      {findings.length === 0 ? (
        <p className="text-xs text-[#7D8FA3] italic">None.</p>
      ) : (
        <ul className="space-y-2.5">
          {findings.map((finding, idx) => (
            <li
              key={`${title}-${idx}`}
              className="rounded-lg border border-[#23303E] bg-[#111922] p-3 space-y-1.5 text-xs"
            >
              <p className="text-[#F8FAFC] leading-relaxed">{finding.description}</p>
              {finding.learnerSpan && (
                <p className="text-[11px] text-[#FECACA]">
                  Your text:{' '}
                  <span className="px-1.5 py-0.5 rounded bg-[#F87171]/20 text-[#FECACA] font-medium">
                    “{finding.learnerSpan}”
                  </span>
                </p>
              )}
              {finding.sourceQuote && (
                <div className="flex items-start gap-1.5 text-[11px] text-[#94A3B8] pt-0.5">
                  <Quote className="w-3.5 h-3.5 text-[#7DD3FC] shrink-0 mt-0.5" />
                  <span className="italic text-[#CBD5E1]">Source: “{finding.sourceQuote}”</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const BriefGistModal: React.FC<BriefGistModalProps> = ({
  item,
  audioPool,
  config,
  vocabItems,
  onClose,
  onLogHistory,
  onRecordErrorLog,
  onAppendErrorEvents,
  onSaveVocab,
}) => {
  const [activeClip, setActiveClip] = useState<BriefItem>(item);
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set([item.id]));
  const [stage, setStage] = useState<GistStage>('listen');

  // Audio playback state (single play in listen stage + replayable in result stage)
  const listenAudioRef = useRef<HTMLAudioElement | null>(null);
  const modelAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlayingClip, setIsPlayingClip] = useState(false);
  const [hasPlayedOnce, setHasPlayedOnce] = useState(false);
  const [audioError, setAudioError] = useState(false);

  // 60-second summary state
  const [secondsLeft, setSecondsLeft] = useState(GIST_TIMER_SECONDS);
  const [summaryText, setSummaryText] = useState('');
  const [submittedSummary, setSubmittedSummary] = useState('');
  const [grade, setGrade] = useState<GistGradeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoSubmitted, setAutoSubmitted] = useState(false);

  // Result stage: Model gist + audio drawer
  const [showModelPanel, setShowModelPanel] = useState(false);
  const [isPlayingModelAudio, setIsPlayingModelAudio] = useState(false);

  const submittingRef = useRef(false);
  const summaryRef = useRef('');

  const wordLookup = useWordLookup({
    config,
    vocabItems,
    onSaveVocab,
    vocabSource: 'brief',
    omitDomain: !config.workFocusEnabled,
  });

  const nextClip = useMemo(
    () => pickNextAudioClip(activeClip.id, audioPool, activeClip.language, seenIds),
    [activeClip.id, activeClip.language, audioPool, seenIds]
  );

  const sentenceCount = useMemo(() => countSummarySentences(summaryText), [summaryText]);

  const highlightedSegments = useMemo(
    () => segmentGistHighlights(submittedSummary, grade?.additions ?? []),
    [submittedSummary, grade]
  );

  // Clean up audio on unmount
  useEffect(() => {
    const listenEl = listenAudioRef.current;
    const modelEl = modelAudioRef.current;
    return () => {
      listenEl?.pause();
      modelEl?.pause();
    };
  }, []);

  const submitGist = useCallback(
    async (triggeredByTimer: boolean) => {
      if (submittingRef.current) return;
      submittingRef.current = true;

      const textToGrade = summaryRef.current.trim();
      setSubmittedSummary(textToGrade);
      setAutoSubmitted(triggeredByTimer);
      setError(null);
      setStage('grading');

      try {
        const result = await gradeBriefGist({
          briefId: activeClip.id,
          summary: textToGrade,
        });
        setGrade(result);
        setStage('result');

        // Log additions/omissions/distortions to both legacy hook and unified Phase 8 error store
        const errorEntries = buildGistErrorLogEntries(activeClip, result);
        if (errorEntries.length > 0) {
          onRecordErrorLog(errorEntries);
        }

        const gistSessionId = createId('gist-sess');
        const unifiedEvents: Parameters<AppendErrorEventsFn>[0] =
          result.errors && result.errors.length > 0
            ? result.errors.map((errItem) => ({
                key: errItem.key,
                source: 'gist',
                sessionId: gistSessionId,
                wrong: errItem.wrong,
                fix: errItem.fix,
                quote: errItem.quote,
                language: activeClip.language,
              }))
            : [
                ...result.additions.map((f) => ({
                  key: 'addition' as const,
                  source: 'gist' as const,
                  sessionId: gistSessionId,
                  wrong: f.learnerSpan || f.description,
                  fix: `Stick strictly to source: "${f.sourceQuote}"`,
                  quote: f.sourceQuote,
                  language: activeClip.language,
                })),
                ...result.omissions.map((f) => ({
                  key: 'omission' as const,
                  source: 'gist' as const,
                  sessionId: gistSessionId,
                  wrong: `Omitted: ${f.description}`,
                  fix: `Include fact: "${f.sourceQuote}"`,
                  quote: f.sourceQuote,
                  language: activeClip.language,
                })),
                ...result.distortions.map((f) => ({
                  key: 'distortion' as const,
                  source: 'gist' as const,
                  sessionId: gistSessionId,
                  wrong: f.learnerSpan || f.description,
                  fix: `Align with source: "${f.sourceQuote}"`,
                  quote: f.sourceQuote,
                  language: activeClip.language,
                })),
              ];

        if (unifiedEvents.length > 0) {
          onAppendErrorEvents?.(unifiedEvents);
        }

        // Log to drill history
        const historyEntry: DrillHistoryEntry = {
          id: createId('hist-gist'),
          module: 'brief_gist',
          language: activeClip.language,
          dialect: activeClip.dialectId,
          domain: activeClip.matchingDomains?.[0] || 'general_policy',
          completedAt: new Date().toISOString(),
          summary: `Gist drill (${result.keyDetails.found}/${result.keyDetails.total} details, ${result.additions.length} additions) on "${activeClip.title.slice(0, 36)}"`,
          scoreLabel: `Main point: ${result.mainPoint}`,
        };
        onLogHistory(historyEntry);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to grade your gist right now.');
        setStage('write');
      } finally {
        submittingRef.current = false;
      }
    },
    [activeClip, onAppendErrorEvents, onLogHistory, onRecordErrorLog]
  );

  // 60-second countdown timer during the 'write' stage — auto-submits at 0:00
  useEffect(() => {
    if (stage !== 'write') return;
    if (secondsLeft <= 0) {
      void submitGist(true);
      return;
    }

    const timerId = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(timerId);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [stage, secondsLeft, submitGist]);

  const handlePlayOnce = () => {
    if (hasPlayedOnce || isPlayingClip) return;
    if (!listenAudioRef.current) return;
    setAudioError(false);
    setIsPlayingClip(true);
    listenAudioRef.current.currentTime = 0;
    listenAudioRef.current.play().catch(() => {
      setIsPlayingClip(false);
      setAudioError(true);
    });
  };

  const handleBeginSummary = () => {
    listenAudioRef.current?.pause();
    setIsPlayingClip(false);
    setHasPlayedOnce(true);
    setSecondsLeft(GIST_TIMER_SECONDS);
    setError(null);
    setStage('write');
  };

  const handleToggleModelAudio = () => {
    if (!modelAudioRef.current) return;
    if (isPlayingModelAudio) {
      modelAudioRef.current.pause();
      setIsPlayingModelAudio(false);
    } else {
      modelAudioRef.current.currentTime = 0;
      modelAudioRef.current.play().catch(() => setIsPlayingModelAudio(false));
      setIsPlayingModelAudio(true);
    }
  };

  const handleOpenNextClip = () => {
    if (!nextClip) return;
    listenAudioRef.current?.pause();
    modelAudioRef.current?.pause();
    submittingRef.current = false;
    setActiveClip(nextClip);
    setSeenIds((prev) => new Set(prev).add(nextClip.id));
    setStage('listen');
    setIsPlayingClip(false);
    setHasPlayedOnce(false);
    setAudioError(false);
    setSecondsLeft(GIST_TIMER_SECONDS);
    setSummaryText('');
    summaryRef.current = '';
    setSubmittedSummary('');
    setGrade(null);
    setError(null);
    setAutoSubmitted(false);
    setShowModelPanel(false);
    setIsPlayingModelAudio(false);
    wordLookup.close();
  };

  const mainPointMeta = useMemo(() => {
    if (!grade) return null;
    if (grade.mainPoint === 'captured') {
      return {
        label: 'Captured',
        color: 'text-[#7DD3FC]',
        border: 'border-[#7DD3FC]/40',
        bg: 'bg-[#7DD3FC]/8',
        icon: CheckCircle2,
      };
    }
    if (grade.mainPoint === 'partial') {
      return {
        label: 'Partial',
        color: 'text-[#D99B26]',
        border: 'border-[#D99B26]/40',
        bg: 'bg-[#D99B26]/8',
        icon: AlertCircle,
      };
    }
    return {
      label: 'Missed',
      color: 'text-[#F87171]',
      border: 'border-[#F87171]/40',
      bg: 'bg-[#F87171]/8',
      icon: XCircle,
    };
  }, [grade]);

  const timerProgressPct = Math.round((secondsLeft / GIST_TIMER_SECONDS) * 100);
  const timerColorClass =
    secondsLeft <= 10 ? 'text-[#F87171]' : secondsLeft <= 20 ? 'text-[#D99B26]' : 'text-[#7DD3FC]';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="brief-gist-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-5 bg-black/85 backdrop-blur-sm"
    >
      <div className="relative flex flex-col w-full max-w-2xl max-h-[94vh] rounded-2xl border border-[#23303E] bg-[#111922] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-5 py-4 border-b border-[#23303E] bg-[#0B1117] space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#94A3B8]">
                <span className="font-mono font-semibold uppercase tracking-wider text-[#D99B26]">
                  Gist Drill · ILR {activeClip.ilrLevel}
                </span>
                <span aria-hidden="true">·</span>
                <span>{activeClip.sourceName}</span>
                <span aria-hidden="true">·</span>
                <span>{activeClip.lengthLabel}</span>
              </div>
              <h2
                id="brief-gist-title"
                className="text-base sm:text-lg font-semibold text-[#F8FAFC] mt-0.5 line-clamp-1"
              >
                {activeClip.title}
              </h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close gist drill"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#94A3B8] hover:text-white rounded-xl hover:bg-[#16202B] transition-colors shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <p className="text-xs sm:text-sm italic text-[#94A3B8] leading-relaxed">{activeClip.orientationLine}</p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* STAGE 1: PLAY CLIP ONCE */}
          {stage === 'listen' && (
            <div className="space-y-5">
              <div className="rounded-xl border border-[#23303E] bg-[#0B1117] p-5 space-y-4">
                <div className="space-y-1">
                  <p className="font-mono text-xs uppercase tracking-wider text-[#7DD3FC]">Step 1 of 2 · Listen once</p>
                  <p className="text-sm text-[#CBD5E1] leading-relaxed">
                    Play the broadcast once without notes or replay. As soon as the clip ends, a 60-second timer will
                    start for your 3-sentence English summary.
                  </p>
                </div>

                {activeClip.audioUrl && (
                  <audio
                    ref={listenAudioRef}
                    key={`gist-listen-${activeClip.id}`}
                    src={activeClip.audioUrl}
                    preload="none"
                    onPlay={() => setIsPlayingClip(true)}
                    onEnded={() => {
                      setIsPlayingClip(false);
                      setHasPlayedOnce(true);
                      setSecondsLeft(GIST_TIMER_SECONDS);
                      setStage('write');
                    }}
                    onError={() => {
                      setIsPlayingClip(false);
                      setAudioError(true);
                    }}
                  >
                    <track kind="captions" />
                  </audio>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    data-testid="gist-play-once-btn"
                    disabled={hasPlayedOnce || isPlayingClip || !activeClip.audioUrl}
                    onClick={handlePlayOnce}
                    className={`inline-flex items-center gap-2 px-5 py-3 min-h-[48px] rounded-xl text-sm font-semibold transition-colors ${
                      isPlayingClip
                        ? 'bg-[#7DD3FC]/20 text-[#7DD3FC] border border-[#7DD3FC]/40 cursor-wait'
                        : hasPlayedOnce
                          ? 'bg-[#16202B] text-[#94A3B8] border border-[#23303E] cursor-not-allowed'
                          : 'bg-[#D99B26] text-[#0B1117] hover:bg-[#E5AE42]'
                    }`}
                  >
                    {isPlayingClip ? (
                      <Volume2 className="w-4 h-4 animate-pulse" />
                    ) : hasPlayedOnce ? (
                      <Headphones className="w-4 h-4" />
                    ) : (
                      <Play className="w-4 h-4 ml-0.5" />
                    )}
                    <span>
                      {isPlayingClip ? 'Playing clip (1 play only)…' : hasPlayedOnce ? 'Played once' : 'Play clip once'}
                    </span>
                  </button>

                  {(isPlayingClip || audioError) && (
                    <button
                      type="button"
                      data-testid="gist-start-summary-btn"
                      onClick={handleBeginSummary}
                      className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl border border-[#23303E] bg-[#111922] text-xs sm:text-sm font-semibold text-[#CBD5E1] hover:text-white hover:border-[#35495E] transition-colors"
                    >
                      <Clock className="w-4 h-4 text-[#D99B26]" />
                      <span>Start 60s summary now</span>
                    </button>
                  )}
                </div>

                {audioError && (
                  <p className="text-xs text-[#F87171] leading-relaxed">
                    Inline stream could not load — listen at{' '}
                    <a
                      href={activeClip.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline text-[#7DD3FC]"
                    >
                      {activeClip.sourceName}
                    </a>
                    , then tap “Start 60s summary now”.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* STAGE 2: 60-SECOND TIMER & 3-SENTENCE TEXTAREA */}
          {stage === 'write' && (
            <div className="space-y-4">
              {/* Countdown Header */}
              <div className="rounded-xl border border-[#23303E] bg-[#0B1117] p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Clock className={`w-4 h-4 ${timerColorClass}`} />
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
                      Step 2 of 2 · Auto-submits at 0:00
                    </span>
                  </div>
                  <span
                    data-testid="gist-countdown"
                    className={`font-mono text-xl font-bold tabular-nums ${timerColorClass}`}
                  >
                    {formatGistCountdown(secondsLeft)}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-[#16202B] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      secondsLeft <= 10 ? 'bg-[#F87171]' : secondsLeft <= 20 ? 'bg-[#D99B26]' : 'bg-[#7DD3FC]'
                    }`}
                    style={{width: `${timerProgressPct}%`}}
                  />
                </div>
              </div>

              {error && (
                <div className="p-3.5 rounded-xl border border-[#F87171]/45 bg-[#F87171]/10 text-xs text-[#FECACA] flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-[#F87171] shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor="gist-summary-input" className="text-sm font-semibold text-[#F8FAFC]">
                    Summarize in 3 English sentences.
                  </label>
                  <span className="font-mono text-xs text-[#94A3B8] tabular-nums">
                    {sentenceCount} / 3 {sentenceCount === 1 ? 'sentence' : 'sentences'}
                  </span>
                </div>

                <textarea
                  id="gist-summary-input"
                  data-testid="gist-summary-input"
                  rows={5}
                  value={summaryText}
                  onChange={(e) => {
                    const next = e.target.value;
                    summaryRef.current = next;
                    setSummaryText(next);
                  }}
                  placeholder="State the main point and key concrete details in up to 3 English sentences. Report only what the speaker said—never add outside facts."
                  className="w-full rounded-xl border border-[#23303E] bg-[#0B1117] p-4 text-sm text-[#F8FAFC] placeholder-[#7D8FA3] leading-relaxed focus:border-[#D99B26] focus:outline-none resize-y"
                />

                <p className="text-xs text-[#7D8FA3]">
                  Fidelity rule: additions (stating something the source never said) count as the most serious error.
                </p>
              </div>
            </div>
          )}

          {/* STAGE 3: GRADING LOADER */}
          {stage === 'grading' && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-[#94A3B8]">
              <Loader2 className="w-7 h-7 animate-spin text-[#D99B26]" />
              <p className="text-sm font-medium text-[#F8FAFC]">Checking fidelity against the source transcript…</p>
              <p className="text-xs text-[#7D8FA3]">Scanning for additions, omissions, and distortions</p>
            </div>
          )}

          {/* STAGE 4: RESULT SCREEN */}
          {stage === 'result' && grade && mainPointMeta && (
            <div className="space-y-5">
              {/* 1. Learner's Gist with Highlighted Additions */}
              <section
                aria-label="Your submitted gist"
                className="rounded-xl border border-[#23303E] bg-[#0B1117] p-4 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs uppercase tracking-wider text-[#94A3B8]">
                    Your gist {autoSubmitted ? '· Auto-submitted at 0:00' : ''}
                  </span>
                  {grade.additions.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#FECACA]">
                      <AlertTriangle className="w-3.5 h-3.5 text-[#F87171]" />
                      <span>Highlighted spans = unsupported additions</span>
                    </span>
                  )}
                </div>

                {submittedSummary ? (
                  <p data-testid="gist-learner-text" className="text-sm text-[#F8FAFC] leading-relaxed">
                    {highlightedSegments.map((seg, idx) =>
                      seg.isAddition ? (
                        <mark
                          key={`seg-${idx}`}
                          className="bg-[#F87171]/25 text-[#FECACA] underline decoration-[#F87171] decoration-wavy underline-offset-2 px-1 py-0.5 rounded"
                        >
                          {seg.text}
                        </mark>
                      ) : (
                        <React.Fragment key={`seg-${idx}`}>{seg.text}</React.Fragment>
                      )
                    )}
                  </p>
                ) : (
                  <p className="text-sm italic text-[#7D8FA3]">No summary was entered before 0:00.</p>
                )}
              </section>

              {/* 2. Two Stat Tiles: Main point + Key details x of y */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div
                  data-testid="gist-stat-main-point"
                  className={`rounded-xl border p-4 space-y-1.5 ${mainPointMeta.border} ${mainPointMeta.bg}`}
                >
                  <span className="font-mono text-[11px] uppercase tracking-wider text-[#94A3B8]">Main point</span>
                  <div className={`flex items-center gap-2 text-lg font-bold ${mainPointMeta.color}`}>
                    <mainPointMeta.icon className="w-5 h-5 shrink-0" />
                    <span>{mainPointMeta.label}</span>
                  </div>
                </div>

                <div
                  data-testid="gist-stat-key-details"
                  className="rounded-xl border border-[#23303E] bg-[#0B1117] p-4 space-y-1.5"
                >
                  <span className="font-mono text-[11px] uppercase tracking-wider text-[#94A3B8]">Key details</span>
                  <p className="font-display text-lg font-bold text-[#F8FAFC] tabular-nums">
                    {grade.keyDetails.found} of {grade.keyDetails.total}
                  </p>
                  {grade.keyDetails.missing.length > 0 && (
                    <p className="text-xs text-[#94A3B8] leading-snug">
                      Missing: {grade.keyDetails.missing.join(' · ')}
                    </p>
                  )}
                </div>
              </div>

              {/* 3. Fidelity Check List: strictly ordered Additions -> Omissions -> Distortions */}
              <section aria-label="Fidelity check" className="space-y-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">Fidelity check</h3>
                  <span className="text-[11px] text-[#7D8FA3]">Additions → Omissions → Distortions</span>
                </div>

                <FidelitySection
                  testId="fidelity-additions"
                  title="Additions"
                  subtitle="Most serious · claims stated that are not in the source"
                  findings={grade.additions}
                  accent="red"
                />

                <FidelitySection
                  testId="fidelity-omissions"
                  title="Omissions"
                  subtitle="Important source points left out of your gist"
                  findings={grade.omissions}
                  accent="amber"
                />

                <FidelitySection
                  testId="fidelity-distortions"
                  title="Distortions"
                  subtitle="Source details misstated (actors, numbers, or cause)"
                  findings={grade.distortions}
                  accent="sky"
                />
              </section>

              {/* 4. Expandable Model Gist + Audio + Short Transcript */}
              {showModelPanel && (
                <section
                  data-testid="gist-model-panel"
                  className="rounded-xl border border-[#7DD3FC]/35 bg-[#0B1117] p-4 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[#7DD3FC]" />
                      <h3 className="text-sm font-semibold text-[#F8FAFC]">Model gist + audio</h3>
                    </div>
                    <a
                      href={activeClip.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-[#7DD3FC] hover:underline"
                    >
                      <span>{activeClip.sourceName}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <p className="text-sm text-[#E2E8F0] leading-relaxed">{grade.modelGist}</p>

                  {activeClip.audioUrl && (
                    <div className="flex items-center gap-3">
                      <audio
                        ref={modelAudioRef}
                        key={`gist-model-${activeClip.id}`}
                        src={activeClip.audioUrl}
                        preload="none"
                        onPlay={() => setIsPlayingModelAudio(true)}
                        onPause={() => setIsPlayingModelAudio(false)}
                        onEnded={() => setIsPlayingModelAudio(false)}
                      >
                        <track kind="captions" />
                      </audio>
                      <button
                        type="button"
                        onClick={handleToggleModelAudio}
                        className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-xl bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] transition-colors"
                      >
                        {isPlayingModelAudio ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                        <span>{isPlayingModelAudio ? 'Pause clip' : 'Replay clip audio'}</span>
                      </button>
                    </div>
                  )}

                  {grade.studyExcerpt && (
                    <div className="space-y-2 pt-2 border-t border-[#23303E]">
                      <p className="text-xs text-[#94A3B8]">
                        Short review transcript (tap any word to inspect &amp; save to Vocab):
                      </p>
                      <div className="p-3.5 rounded-lg bg-[#111922] border border-[#23303E] text-sm text-[#F8FAFC] leading-relaxed">
                        <TappableText
                          text={grade.studyExcerpt}
                          activeWord={wordLookup.lookup?.word}
                          onWordTap={(w) =>
                            void wordLookup.lookUpWord(`gist-tx-${activeClip.id}`, w, grade.studyExcerpt || '')
                          }
                        />
                      </div>

                      {wordLookup.lookup && (
                        <WordLookupPopover
                          lookup={wordLookup.lookup}
                          onClose={wordLookup.close}
                          onRetry={wordLookup.retry}
                          onSave={wordLookup.save}
                        />
                      )}
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-t border-[#23303E] bg-[#0B1117]">
          {stage === 'listen' && (
            <>
              <span className="text-xs text-[#94A3B8]">Listen once · then 60s to summarize</span>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 min-h-[44px] rounded-xl text-xs sm:text-sm font-medium text-[#94A3B8] hover:text-white transition-colors"
              >
                Cancel
              </button>
            </>
          )}

          {stage === 'write' && (
            <>
              <span className="font-mono text-xs text-[#94A3B8] tabular-nums">
                {formatGistCountdown(secondsLeft)} remaining
              </span>
              <button
                type="button"
                data-testid="gist-submit-btn"
                onClick={() => void submitGist(false)}
                className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[44px] rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
              >
                <Send className="w-4 h-4" />
                <span>Submit gist</span>
              </button>
            </>
          )}

          {stage === 'grading' && <span className="text-xs text-[#94A3B8]">Comparing against source transcript…</span>}

          {stage === 'result' && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="gist-model-btn"
                  onClick={() => setShowModelPanel((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[44px] rounded-xl border border-[#7DD3FC]/45 bg-[#7DD3FC]/10 text-xs sm:text-sm font-semibold text-[#7DD3FC] hover:bg-[#7DD3FC]/20 transition-colors"
                >
                  <Headphones className="w-4 h-4" />
                  <span>{showModelPanel ? 'Hide model gist' : 'Model gist + audio'}</span>
                </button>

                {nextClip && (
                  <button
                    type="button"
                    data-testid="gist-next-clip-btn"
                    onClick={handleOpenNextClip}
                    className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[44px] rounded-xl bg-[#D99B26] text-[#0B1117] text-xs sm:text-sm font-semibold hover:bg-[#E5AE42] transition-colors"
                  >
                    <span>Next clip</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
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
    </div>
  );
};
