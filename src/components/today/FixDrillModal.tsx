import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  Volume2,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import {getTaxonomyEntry} from '../../data/errorTaxonomy';
import type {DrillHistoryEntry, ErrorTaxonomyKey, FixDrillPayload, FixGradeResult, MissionConfig} from '../../types';
import {generateFixDrill, gradeFixTurn} from '../../services/api';
import {useSpeechRecognition, useSpeechSynthesis} from '../../hooks/useSpeech';
import {getDialectInfo, LANGUAGE_LABELS} from '../../utils/ilrLogic';
import {createId} from '../../utils/ids';

interface FixDrillModalProps {
  errorKey: ErrorTaxonomyKey;
  config: MissionConfig;
  onClose: () => void;
  onLogHistory: (entry: DrillHistoryEntry) => void;
}

interface CompletedTurn {
  promptTarget: string;
  userAnswer: string;
  result: FixGradeResult;
}

const TARGET_SECONDS = 120;

function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const FixDrillModal: React.FC<FixDrillModalProps> = ({errorKey, config, onClose, onLogHistory}) => {
  const entry = getTaxonomyEntry(errorKey);
  const dialectInfo = getDialectInfo(config.language, config.dialect);
  const tts = useSpeechSynthesis();
  const stt = useSpeechRecognition();

  const [drill, setDrill] = useState<FixDrillPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answerText, setAnswerText] = useState('');
  const [grading, setGrading] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [currentResult, setCurrentResult] = useState<FixGradeResult | null>(null);
  const [completedTurns, setCompletedTurns] = useState<CompletedTurn[]>([]);
  const [finished, setFinished] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const loggedRef = useRef(false);
  const {stop: stopTts} = tts;
  const {stopListening: stopStt} = stt;

  const loadDrill = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setCurrentIndex(0);
    setAnswerText('');
    setCurrentResult(null);
    setCompletedTurns([]);
    setFinished(false);
    setElapsedSeconds(0);
    loggedRef.current = false;
    try {
      const payload = await generateFixDrill({
        language: config.language,
        dialect: config.dialect,
        errorKey,
      });
      setDrill(payload);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to generate 2-minute fix drill.');
    } finally {
      setLoading(false);
    }
  }, [config.language, config.dialect, errorKey]);

  useEffect(() => {
    void loadDrill();
  }, [loadDrill]);

  // Mirror speech recognition transcript while mic is active
  useEffect(() => {
    const combined = `${stt.finalTranscript} ${stt.interimTranscript}`.trim();
    if (combined && stt.isListening) {
      setAnswerText(combined);
    }
  }, [stt.finalTranscript, stt.interimTranscript, stt.isListening]);

  // Elapsed timer while drill is active
  useEffect(() => {
    if (loading || loadError || !drill || finished) return;
    const id = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [loading, loadError, drill, finished]);

  // Close on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopTts();
        stopStt();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, stopTts, stopStt]);

  // Stop speech cleanly on unmount
  useEffect(() => {
    return () => {
      stopTts();
      stopStt();
    };
  }, [stopTts, stopStt]);

  const prompts = drill?.prompts ?? [];
  const totalPrompts = prompts.length || 8;
  const activePrompt = prompts[currentIndex];

  const handleToggleMic = () => {
    if (stt.isListening) {
      stt.stopListening();
    } else {
      tts.stop();
      stt.resetTranscript();
      stt.startListening({lang: dialectInfo.bcp47, continuous: false});
    }
  };

  const handleSpeakPrompt = () => {
    if (!activePrompt) return;
    tts.speak(activePrompt.promptTarget, {
      lang: dialectInfo.bcp47,
      rate: config.speechRate,
      voiceURI: config.voiceURI,
    });
  };

  const handleSubmitAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = answerText.trim();
    if (!clean || !activePrompt || grading || currentResult) return;

    stt.stopListening();
    tts.stop();
    setGrading(true);
    setGradeError(null);
    try {
      const result = await gradeFixTurn({
        language: config.language,
        dialect: config.dialect,
        errorKey,
        promptTarget: activePrompt.promptTarget,
        userAnswer: clean,
      });
      setCurrentResult(result);
      setCompletedTurns((prev) => [
        ...prev,
        {
          promptTarget: activePrompt.promptTarget,
          userAnswer: clean,
          result,
        },
      ]);
    } catch (err) {
      setGradeError(err instanceof Error ? err.message : 'Unable to grade answer right now.');
    } finally {
      setGrading(false);
    }
  };

  const handleNext = () => {
    stt.stopListening();
    stt.resetTranscript();
    tts.stop();
    setGradeError(null);

    if (currentIndex + 1 >= prompts.length) {
      setFinished(true);
      if (!loggedRef.current) {
        loggedRef.current = true;
        const passedCount = completedTurns.filter((t) => t.result.passed).length;
        onLogHistory({
          id: createId('hist-fix'),
          module: 'fix_drill',
          language: config.language,
          dialect: config.dialect,
          domain: config.domain,
          completedAt: new Date().toISOString(),
          summary: `2-min Fix: ${entry.label} (${passedCount}/${prompts.length})`,
          scoreLabel: `${passedCount} / ${prompts.length}`,
        });
      }
      return;
    }

    setCurrentIndex((prev) => prev + 1);
    setAnswerText('');
    setCurrentResult(null);
  };

  const handleClose = () => {
    stopTts();
    stopStt();
    onClose();
  };

  const passedCount = completedTurns.filter((t) => t.result.passed).length;
  const remainingSeconds = Math.max(0, TARGET_SECONDS - elapsedSeconds);
  const progressPct = Math.min(
    100,
    Math.round(((finished ? totalPrompts : currentIndex + (currentResult ? 1 : 0)) / totalPrompts) * 100)
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fix-drill-title"
      data-testid="fix-drill-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5"
    >
      <button
        type="button"
        aria-label="Close 2-minute fix drill"
        onClick={handleClose}
        className="fixed inset-0 bg-[#05090E]/80 backdrop-blur-sm cursor-default"
      />

      <div className="relative z-10 w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl border border-[#23303E] bg-[#111922] shadow-2xl">
        {/* Top Bar */}
        <div className="sticky top-0 z-10 border-b border-[#23303E] bg-[#0E151D]/95 backdrop-blur-md px-5 py-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#F3C669]">
                <Zap className="w-3.5 h-3.5 text-[#D99B26] shrink-0" />
                <span>2-Minute Fix</span>
                <span aria-hidden="true" className="text-[#556980]">
                  ·
                </span>
                <span className="text-[#94A3B8]">{LANGUAGE_LABELS[config.language]}</span>
              </div>
              <h2 id="fix-drill-title" className="font-display text-lg font-semibold text-[#F8FAFC] mt-0.5 truncate">
                {entry.label}
              </h2>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {!loading && !loadError && (
                <div className="flex items-center gap-2 rounded-lg border border-[#23303E] bg-[#0B1117] px-2.5 py-1.5">
                  <span
                    data-testid="fix-progress-counter"
                    className="font-mono text-xs font-semibold text-[#F8FAFC] tabular-nums"
                  >
                    {finished ? `${totalPrompts} / ${totalPrompts}` : `${currentIndex + 1} / ${totalPrompts}`}
                  </span>
                  <span aria-hidden="true" className="text-[#35495E]">
                    |
                  </span>
                  <span className="inline-flex items-center gap-1 font-mono text-xs text-[#94A3B8] tabular-nums">
                    <Clock className="w-3 h-3 text-[#D99B26]" />
                    {formatClock(remainingSeconds)}
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={handleClose}
                aria-label="Close drill"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-[#23303E] bg-[#111922] text-[#94A3B8] hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="h-1.5 w-full rounded-full bg-[#0B1117] overflow-hidden">
            <div className="h-full bg-[#D99B26] transition-all duration-300" style={{width: `${progressPct}%`}} />
          </div>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 space-y-5">
          {loading ? (
            <div className="py-14 flex flex-col items-center justify-center gap-3 text-center">
              <Loader2 className="w-6 h-6 text-[#D99B26] animate-spin" />
              <p className="text-sm font-medium text-[#E6EDF3]">Building 8 everyday prompts for {entry.label}…</p>
              <p className="text-xs text-[#94A3B8] max-w-sm">{entry.explanation}</p>
            </div>
          ) : loadError ? (
            <div className="rounded-xl border border-[#F87171]/40 bg-[#F87171]/10 p-5 text-center space-y-3">
              <AlertCircle className="w-6 h-6 text-[#F87171] mx-auto" />
              <p className="text-sm text-[#FECACA]">{loadError}</p>
              <button
                type="button"
                onClick={() => void loadDrill()}
                className="inline-flex items-center gap-2 min-h-[52px] px-4 rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
            </div>
          ) : finished ? (
            /* Completion Summary */
            <div data-testid="fix-drill-summary" className="space-y-5">
              <div className="rounded-xl border border-[#D99B26]/50 bg-[#0B1117] p-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-[#F3C669]">Drill Complete</p>
                  <p className="font-display text-2xl font-bold text-[#F8FAFC] tabular-nums mt-0.5">
                    {passedCount} / {prompts.length} nailed
                  </p>
                  <p className="text-xs text-[#94A3B8] mt-1">
                    Elapsed:{' '}
                    <span className="font-mono tabular-nums text-[#CBD5E1]">{formatClock(elapsedSeconds)}</span> ·
                    Target: {entry.label}
                  </p>
                </div>
                <CheckCircle2 className="w-9 h-9 text-[#7DD3FC] shrink-0" />
              </div>

              <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {completedTurns.map((turn, idx) => (
                  <li
                    key={`${turn.promptTarget}-${idx}`}
                    className="rounded-lg border border-[#23303E] bg-[#0B1117] p-3 space-y-1 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[#94A3B8] font-mono tabular-nums">
                        {idx + 1}. {turn.promptTarget}
                      </span>
                      {turn.result.passed ? (
                        <Check className="w-4 h-4 text-[#7DD3FC] shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-[#F87171] shrink-0" />
                      )}
                    </div>
                    <p className="text-[#E6EDF3]">
                      <span
                        className={turn.result.passed ? 'text-[#7DD3FC] font-medium' : 'text-[#FECACA] font-medium'}
                      >
                        {turn.result.matchedSpan}
                      </span>{' '}
                      <span className="text-[#94A3B8]">
                        {turn.result.passed ? '✓' : '—'} {turn.result.feedback}
                      </span>
                    </p>
                    {turn.result.correction && <p className="text-[#7DD3FC]">Fix: {turn.result.correction}</p>}
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => void loadDrill()}
                  className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl border border-[#23303E] bg-[#0B1117] text-xs font-semibold text-[#CBD5E1] hover:text-white transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Run another 8</span>
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="inline-flex items-center gap-1.5 min-h-[52px] px-5 rounded-xl bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] transition-colors"
                >
                  <span>Done</span>
                </button>
              </div>
            </div>
          ) : activePrompt ? (
            /* Active Prompt Step */
            <div className="space-y-4">
              {/* Target Focus Reminder */}
              <div className="rounded-xl border border-[#23303E] bg-[#0B1117] p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#7DD3FC]">
                    Target: {activePrompt.targetStructureHint}
                  </span>
                  <button
                    type="button"
                    onClick={handleSpeakPrompt}
                    className="inline-flex items-center gap-1.5 min-h-[44px] px-2.5 rounded-lg border border-[#23303E] bg-[#111922] text-xs font-medium text-[#CBD5E1] hover:text-white transition-colors"
                  >
                    <Volume2 className="w-3.5 h-3.5 text-[#D99B26]" />
                    <span>Listen</span>
                  </button>
                </div>

                <p className="font-display text-lg sm:text-xl font-semibold text-[#F8FAFC] leading-snug">
                  {activePrompt.promptTarget}
                </p>

                {activePrompt.promptEnglishHint && (
                  <p className="text-xs text-[#94A3B8] italic">{activePrompt.promptEnglishHint}</p>
                )}
              </div>

              {/* Voice + Typed Answer Form */}
              <form onSubmit={handleSubmitAnswer} className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="fix-answer-input" className="text-xs font-medium text-[#CBD5E1]">
                    Answer aloud or type one sentence
                  </label>
                  <button
                    type="button"
                    onClick={handleToggleMic}
                    disabled={Boolean(currentResult) || grading}
                    className={`inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-40 ${
                      stt.isListening
                        ? 'border-[#F87171] bg-[#F87171] text-[#0B1117]'
                        : 'border-[#D99B26]/50 bg-[#D99B26]/10 text-[#F3C669] hover:bg-[#D99B26]/20'
                    }`}
                  >
                    {stt.isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    <span>{stt.isListening ? 'Stop mic' : 'Answer by voice'}</span>
                  </button>
                </div>

                <textarea
                  id="fix-answer-input"
                  rows={2}
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  disabled={Boolean(currentResult) || grading}
                  placeholder={`Speak or type your ${LANGUAGE_LABELS[config.language]} answer…`}
                  className="w-full rounded-xl border border-[#23303E] bg-[#0B1117] px-3.5 py-3 text-sm text-[#F8FAFC] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#D99B26] disabled:opacity-75"
                />

                {stt.error && <p className="text-xs text-amber-300">{stt.error}</p>}
                {gradeError && (
                  <p role="alert" className="text-xs text-[#F87171]">
                    {gradeError}
                  </p>
                )}

                {!currentResult && (
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      data-testid="fix-submit-answer"
                      disabled={!answerText.trim() || grading}
                      className="inline-flex items-center justify-center gap-2 min-h-[52px] px-5 rounded-xl bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] disabled:opacity-40 transition-colors"
                    >
                      {grading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      <span>{grading ? 'Checking structure…' : 'Check answer'}</span>
                    </button>
                  </div>
                )}
              </form>

              {/* Instant Structure-Only Feedback */}
              {currentResult && (
                <div
                  data-testid="fix-turn-feedback"
                  className={`rounded-xl border p-4 space-y-2.5 ${
                    currentResult.passed ? 'border-[#7DD3FC]/50 bg-[#7DD3FC]/10' : 'border-[#D99B26]/50 bg-[#D99B26]/10'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {currentResult.passed ? (
                      <CheckCircle2 className="w-5 h-5 text-[#7DD3FC] shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-[#F3C669] shrink-0 mt-0.5" />
                    )}
                    <div className="space-y-1 min-w-0">
                      <p className="text-sm font-semibold text-[#F8FAFC]">
                        <span className={currentResult.passed ? 'text-[#7DD3FC]' : 'text-[#F3C669]'}>
                          “{currentResult.matchedSpan}”
                        </span>{' '}
                        {currentResult.passed ? '✓' : '—'}{' '}
                        <span className="font-normal text-[#E6EDF3]">{currentResult.feedback}</span>
                      </p>
                      {currentResult.correction && (
                        <p className="text-xs text-[#CBD5E1]">
                          <span className="font-semibold text-[#7DD3FC]">Try:</span> {currentResult.correction}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      data-testid="fix-next-prompt"
                      onClick={handleNext}
                      className="inline-flex items-center gap-1.5 min-h-[52px] px-4 rounded-xl bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] transition-colors"
                    >
                      <span>{currentIndex + 1 >= prompts.length ? 'Finish 8 / 8' : 'Next prompt'}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
