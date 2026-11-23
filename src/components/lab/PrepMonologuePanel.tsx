import React, {useEffect, useImperativeHandle, useState} from 'react';
import {CheckCircle2, Loader2, Mic, RefreshCw, RotateCcw, Square} from 'lucide-react';
import type {DrillHistoryEntry, MissionConfig, OpiSession, PrepEvaluation, PrepPromptItem} from '../../types';
import {SEED_PREP_PROMPTS} from '../../data/seedData';
import {
  formatSecondsClock,
  getDialectInfo,
  getDomainInfo,
  getPrepPhase,
  LANGUAGE_LABELS,
  PREP_PHASES,
} from '../../utils/ilrLogic';
import {generatePrepPrompt, gradePrepMonologue} from '../../services/api';
import {getCachedPrepPrompt, savePrepPromptCache} from '../../utils/lookupCacheStore';
import {useAudioRecorder, useSpeechRecognition} from '../../hooks/useSpeech';
import {createId} from '../../utils/ids';

const PREP_DURATION_SECONDS = 90;

export interface LabPanelHandle {
  /** Stops any recording, dictation or playback (called when the panel is hidden). */
  stop: () => void;
}

interface PrepMonologuePanelProps {
  config: MissionConfig;
  onSaveMonologueSession: (session: OpiSession) => void;
  onLogHistory: (entry: DrillHistoryEntry) => void;
  ref?: React.Ref<LabPanelHandle>;
}

function defaultPrepPrompt(config: MissionConfig): PrepPromptItem {
  return (
    getCachedPrepPrompt(config.language, config.domain) ??
    SEED_PREP_PROMPTS.find((p) => p.language === config.language && p.domain === config.domain) ??
    SEED_PREP_PROMPTS.find((p) => p.language === config.language) ??
    SEED_PREP_PROMPTS[0]
  );
}

/**
 * 90-second PREP (Point, Reason, Example, Pivot) monologue trainer with a phase pacing bar,
 * recording, live dictation and AI structure grading. Keyed by domain in the parent, so a domain
 * change starts fresh with that domain's prompt.
 */
export const PrepMonologuePanel: React.FC<PrepMonologuePanelProps> = ({
  config,
  onSaveMonologueSession,
  onLogHistory,
  ref,
}) => {
  const dialectInfo = getDialectInfo(config.language, config.dialect);
  const domainInfo = getDomainInfo(config.domain);

  const [prepPrompt, setPrepPrompt] = useState<PrepPromptItem>(() => defaultPrepPrompt(config));
  const [prepElapsed, setPrepElapsed] = useState(0);
  const [prepRunning, setPrepRunning] = useState(false);
  const [prepTranscript, setPrepTranscript] = useState('');
  const [prepEval, setPrepEval] = useState<PrepEvaluation | null>(null);
  const [prepLoading, setPrepLoading] = useState(false);
  const [prepGenerating, setPrepGenerating] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);

  const stt = useSpeechRecognition();
  const recorder = useAudioRecorder();
  const {stopListening, resetTranscript} = stt;
  const {stopRecording, clearAudio} = recorder;

  useImperativeHandle(
    ref,
    () => ({
      stop: () => {
        setPrepRunning(false);
        stopListening();
        stopRecording();
      },
    }),
    [stopListening, stopRecording]
  );

  // 90-Second PREP Timer. Elapsed time is derived from the wall clock (background tabs throttle
  // intervals), and the stop side effects run in the interval callback, not inside a state updater.
  useEffect(() => {
    if (!prepRunning) return;
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      const elapsed = Math.min(PREP_DURATION_SECONDS, Math.floor((Date.now() - startedAt) / 1000));
      setPrepElapsed(elapsed);
      if (elapsed >= PREP_DURATION_SECONDS) {
        window.clearInterval(id);
        setPrepRunning(false);
        stopListening();
        stopRecording();
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [prepRunning, stopListening, stopRecording]);

  // Mirror live dictation into the transcript while the monologue is running.
  useEffect(() => {
    const combined = `${stt.finalTranscript} ${stt.interimTranscript}`.trim();
    if (combined && prepRunning) setPrepTranscript(combined);
  }, [stt.finalTranscript, stt.interimTranscript, prepRunning]);

  const activePhase = getPrepPhase(prepElapsed);

  const handleStartStopPrep = async () => {
    if (prepRunning) {
      setPrepRunning(false);
      stopListening();
      stopRecording();
      return;
    }

    setPrepElapsed(0);
    setPrepEval(null);
    setPrepError(null);
    setPrepTranscript('');
    resetTranscript();
    await recorder.startRecording();
    stt.startListening({lang: dialectInfo.bcp47, continuous: true});
    setPrepRunning(true);
  };

  const handleReset = () => {
    setPrepRunning(false);
    setPrepElapsed(0);
    setPrepTranscript('');
    setPrepEval(null);
    stopListening();
    resetTranscript();
    clearAudio();
  };

  const handleGeneratePrepPrompt = async () => {
    setPrepGenerating(true);
    setPrepError(null);
    try {
      const fresh = await generatePrepPrompt({
        language: config.language,
        dialect: config.dialect,
        domain: config.domain,
      });
      savePrepPromptCache(config.language, config.domain, fresh);
      setPrepPrompt(fresh);
      setPrepElapsed(0);
      setPrepRunning(false);
      setPrepTranscript('');
      setPrepEval(null);
      clearAudio();
    } catch (err) {
      setPrepError(err instanceof Error ? err.message : 'Unable to generate PREP prompt.');
    } finally {
      setPrepGenerating(false);
    }
  };

  const handleGradePrep = async () => {
    const clean = prepTranscript.trim();
    if (!clean) {
      setPrepError('Record your 90-second monologue or type your response before grading.');
      return;
    }
    setPrepLoading(true);
    setPrepError(null);
    try {
      const durationSeconds = Math.max(prepElapsed, 30);
      const evaluation = await gradePrepMonologue({
        language: config.language,
        dialect: config.dialect,
        promptTarget: prepPrompt.promptTarget,
        transcript: clean,
        durationSeconds,
      });
      setPrepEval(evaluation);

      // Persist monologue so it is also inspectable inside the ILR Debrief module
      const nowIso = new Date().toISOString();
      onSaveMonologueSession({
        id: createId('prep-sess'),
        type: 'prep_monologue',
        language: config.language,
        dialect: config.dialect,
        domain: config.domain,
        startedAt: nowIso,
        durationSeconds,
        prepPrompt: prepPrompt.promptTarget,
        messages: [
          {
            id: createId('p-ex'),
            role: 'examiner',
            text: prepPrompt.promptTarget,
            timestamp: nowIso,
            probeLevel: 'level_3_probe',
          },
          {id: createId('p-cand'), role: 'candidate', text: clean, timestamp: nowIso, probeLevel: 'level_3_probe'},
        ],
      });
      onLogHistory({
        id: createId('hist-prep'),
        module: 'prep',
        language: config.language,
        dialect: config.dialect,
        domain: config.domain,
        completedAt: nowIso,
        summary: `90s PREP Monologue (${domainInfo.shortLabel})`,
        scoreLabel: `${evaluation.estimatedIlr} · ${evaluation.structureScore}/100`,
      });
    } catch (err) {
      setPrepError(err instanceof Error ? err.message : 'Unable to grade PREP monologue.');
    } finally {
      setPrepLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left 7 cols: Prompt + 90s Visual Pacing Bar + Recording */}
      <div className="lg:col-span-7 rounded-xl border border-[#23303E] bg-[#111922] p-5 sm:p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-[#94A3B8]">OPI 2+/3 Monologue Prompt · {domainInfo.label}</span>
          <button
            type="button"
            onClick={handleGeneratePrepPrompt}
            disabled={prepGenerating}
            className="flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-lg border border-[#23303E] text-xs font-medium text-[#CBD5E1] hover:text-white hover:border-[#35495E] transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${prepGenerating ? 'animate-spin' : ''}`} />
            <span>{prepGenerating ? 'Generating…' : 'New Domain Prompt'}</span>
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-lg sm:text-xl font-medium text-[#F8FAFC] leading-relaxed">{prepPrompt.promptTarget}</p>
          <p className="text-xs text-[#94A3B8]">{prepPrompt.promptEnglish}</p>
          <p className="text-xs text-[#7D8FA3] pt-1">
            Target connectors: <span className="text-[#CBD5E1]">{prepPrompt.recommendedConnectors.join(' · ')}</span>
          </p>
        </div>

        {/* 90-Second Visual Pacing Timer */}
        <div className="pt-5 border-t border-[#23303E] space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs text-[#94A3B8]">Active Pacing Phase</p>
              <p data-testid="prep-active-phase" className="text-xl font-semibold text-[#F3C669] mt-0.5">
                {activePhase.label}
              </p>
              <p className="text-xs text-[#CBD5E1] mt-1">{activePhase.guidance}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-[#7D8FA3]">Elapsed / 1:30</p>
              <p data-testid="prep-timer-display" className="font-mono text-3xl font-bold text-[#F8FAFC] tabular-nums">
                {formatSecondsClock(prepElapsed)}
              </p>
            </div>
          </div>

          {/* 4-Segment Visual Track (0:15 -> 0:40 -> 1:10 -> 1:30) */}
          <div className="grid grid-cols-12 gap-1.5" aria-label="PREP 90-second phase timeline">
            {PREP_PHASES.map((phase) => {
              const colSpan =
                phase.id === 'point'
                  ? 'col-span-2'
                  : phase.id === 'reason'
                    ? 'col-span-3'
                    : phase.id === 'example'
                      ? 'col-span-4'
                      : 'col-span-3';
              const spanDur = phase.endSec - phase.startSec;
              const fillPct =
                prepElapsed <= phase.startSec
                  ? 0
                  : prepElapsed >= phase.endSec
                    ? 100
                    : Math.round(((prepElapsed - phase.startSec) / spanDur) * 100);
              const isCurrent = activePhase.id === phase.id && prepRunning;

              return (
                <div key={phase.id} className={`${colSpan} space-y-1.5`}>
                  <div className="h-2.5 w-full rounded-full bg-[#1C2836] overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        isCurrent ? 'bg-[#D99B26]' : fillPct === 100 ? 'bg-emerald-500' : 'bg-[#D99B26]/70'
                      }`}
                      style={{width: `${fillPct}%`}}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#7D8FA3] font-mono tabular-nums">
                    <span
                      className={activePhase.id === phase.id ? 'text-[#F8FAFC] font-semibold font-sans' : 'font-sans'}
                    >
                      {phase.label.split(' ')[0]}
                    </span>
                    <span>{formatSecondsClock(phase.endSec)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleStartStopPrep}
              className={`flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                prepRunning
                  ? 'bg-red-600 text-white hover:bg-red-500'
                  : 'bg-[#D99B26] text-[#0B1117] hover:bg-[#E5AE42]'
              }`}
            >
              {prepRunning ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              <span>{prepRunning ? 'Stop 90s Recording' : 'Start 90s Monologue'}</span>
            </button>

            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3.5 py-2.5 min-h-[44px] rounded-lg border border-[#23303E] text-xs font-medium text-[#CBD5E1] hover:text-white"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>

            <button
              type="button"
              onClick={handleGradePrep}
              disabled={prepLoading || !prepTranscript.trim()}
              className="ml-auto flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg border border-sky-500/40 bg-sky-500/12 text-xs font-semibold text-sky-300 hover:bg-sky-500/20 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {prepLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              <span>{prepLoading ? 'Grading Structure…' : 'Grade PREP Structure'}</span>
            </button>
          </div>
        </div>

        {recorder.audioUrl && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-2">
            <span className="text-xs text-[#94A3B8] shrink-0">Recorded Monologue:</span>
            <audio controls src={recorder.audioUrl} className="h-9 w-full max-w-md" />
          </div>
        )}

        {/* Editable Live Transcript */}
        <div className="space-y-1.5">
          <label htmlFor="prep-transcript-area" className="text-xs font-medium text-[#94A3B8]">
            Spoken Transcript (auto-captured via mic, or type directly to practice)
          </label>
          <textarea
            id="prep-transcript-area"
            rows={5}
            value={prepTranscript}
            onChange={(e) => setPrepTranscript(e.target.value)}
            placeholder={`Speak your 90-second ${LANGUAGE_LABELS[config.language]} PREP monologue or enter your draft here…`}
            className="w-full rounded-lg border border-[#23303E] bg-[#0B1117] px-3.5 py-3 text-sm text-[#E6EDF3] placeholder:text-[#64748B] focus:outline-none focus:border-[#D99B26] leading-relaxed"
          />
        </div>

        {prepError && <p className="text-xs text-red-300">{prepError}</p>}
      </div>

      {/* Right 5 cols: PREP Structure Evaluation */}
      <div className="lg:col-span-5 rounded-xl border border-[#23303E] bg-[#111922] p-5 sm:p-6 space-y-5">
        <h2 className="text-sm font-semibold text-[#F8FAFC]">PREP Structural Evaluation</h2>
        {!prepEval ? (
          <div className="space-y-4 text-sm text-[#94A3B8]">
            <p className="leading-relaxed">
              Complete your 90-second monologue and click{' '}
              <strong className="text-[#E6EDF3]">Grade PREP Structure</strong> to receive phase-by-phase ILR feedback
              and a polished closing pivot.
            </p>
            <div className="space-y-2.5 pt-3 border-t border-[#23303E] text-xs">
              {PREP_PHASES.map((p) => (
                <div key={p.id} className="flex items-start justify-between gap-3">
                  <span className="font-medium text-[#CBD5E1]">{p.label}</span>
                  <span className="font-mono text-[#7D8FA3] tabular-nums shrink-0">
                    {formatSecondsClock(p.startSec)}–{formatSecondsClock(p.endSec)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-baseline justify-between gap-4 pb-4 border-b border-[#23303E]">
              <div>
                <p className="text-xs text-[#94A3B8]">Monologue Rating</p>
                <p className="text-2xl font-bold text-[#F8FAFC]">{prepEval.estimatedIlr}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-[#94A3B8]">PREP Structure</p>
                <p className="font-mono text-2xl font-bold text-[#D99B26] tabular-nums">
                  {prepEval.structureScore}/100
                </p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              {(
                [
                  ['Point (0:00–0:15)', prepEval.phaseFeedback.point],
                  ['Reason (0:15–0:40)', prepEval.phaseFeedback.reason],
                  ['Example (0:40–1:10)', prepEval.phaseFeedback.example],
                  ['Pivot / Conclusion (1:10–1:30)', prepEval.phaseFeedback.pivot],
                ] as const
              ).map(([label, feedback]) => (
                <div key={label} className="space-y-0.5">
                  <p className="font-semibold text-[#E6EDF3]">{label}</p>
                  <p className="text-[#94A3B8] leading-relaxed">{feedback}</p>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-[#23303E] space-y-2">
              <p className="text-xs font-semibold text-sky-300">Subjunctive &amp; Register Note</p>
              <p className="text-xs text-[#CBD5E1] leading-relaxed">{prepEval.subjunctiveNote}</p>
            </div>

            <div className="pt-4 border-t border-[#23303E] space-y-1.5">
              <p className="text-xs font-semibold text-emerald-400">Model ILR 2+/3 Pivot Conclusion</p>
              <p className="text-sm text-[#F8FAFC] italic leading-relaxed">
                &ldquo;{prepEval.upgradedConclusion}&rdquo;
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
