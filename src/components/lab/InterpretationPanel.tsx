import React, {useEffect, useImperativeHandle, useState} from 'react';
import {CheckCircle2, Eye, EyeOff, Loader2, Mic, MicOff, Play, RefreshCw, Square, Volume2} from 'lucide-react';
import type {DrillHistoryEntry, InterpBriefing, InterpEvaluation, MissionConfig} from '../../types';
import {SEED_INTERP_BRIEFINGS} from '../../data/seedData';
import {getDialectInfo, LANGUAGE_LABELS} from '../../utils/ilrLogic';
import {generateInterpBriefing, gradeInterpretation} from '../../services/api';
import {getCachedInterpBriefing, saveInterpBriefingCache} from '../../utils/lookupCacheStore';
import {useSpeechRecognition, useSpeechSynthesis} from '../../hooks/useSpeech';
import {createId} from '../../utils/ids';
import type {LabPanelHandle} from './PrepMonologuePanel';

const CHUNKING_SYMBOLS = [
  {symbol: '→', label: 'Cause / Result'},
  {symbol: '≠', label: 'Contrast'},
  {symbol: '↑', label: 'Increase'},
  {symbol: '↓', label: 'Decrease'},
  {symbol: '⚖', label: 'Policy / Legal'},
  {symbol: '⏱', label: 'Deadline'},
  {symbol: '✓', label: 'Commitment'},
];

interface InterpretationPanelProps {
  config: MissionConfig;
  onLogHistory: (entry: DrillHistoryEntry) => void;
  ref?: React.Ref<LabPanelHandle>;
}

function defaultBriefing(config: MissionConfig): InterpBriefing {
  return (
    getCachedInterpBriefing(config.language, config.dialect, config.domain) ??
    SEED_INTERP_BRIEFINGS.find((b) => b.language === config.language) ??
    SEED_INTERP_BRIEFINGS[0]
  );
}

/**
 * Consecutive interpretation drill: listen to a briefing (optionally blind), take idea-chunking
 * notes, deliver a rendition and get a fidelity/register audit. Keyed by dialect + domain in the parent.
 */
export const InterpretationPanel: React.FC<InterpretationPanelProps> = ({config, onLogHistory, ref}) => {
  const dialectInfo = getDialectInfo(config.language, config.dialect);

  const [briefing, setBriefing] = useState<InterpBriefing>(() => defaultBriefing(config));
  const [blindMode, setBlindMode] = useState(true);
  const [direction, setDirection] = useState<'target_to_en' | 'en_to_target'>('target_to_en');
  const [chunkNotes, setChunkNotes] = useState('');
  const [renditionText, setRenditionText] = useState('');
  const [interpEval, setInterpEval] = useState<InterpEvaluation | null>(null);
  const [interpLoading, setInterpLoading] = useState(false);
  const [interpGenerating, setInterpGenerating] = useState(false);
  const [interpError, setInterpError] = useState<string | null>(null);

  const tts = useSpeechSynthesis();
  const stt = useSpeechRecognition();
  const {stop: stopSpeaking} = tts;
  const {stopListening} = stt;

  useImperativeHandle(
    ref,
    () => ({
      stop: () => {
        stopSpeaking();
        stopListening();
      },
    }),
    [stopSpeaking, stopListening]
  );

  // Mirror live dictation into the rendition while the mic is on.
  useEffect(() => {
    const combined = `${stt.finalTranscript} ${stt.interimTranscript}`.trim();
    if (combined && stt.isListening) setRenditionText(combined);
  }, [stt.finalTranscript, stt.interimTranscript, stt.isListening]);

  const handleGenerateBriefing = async () => {
    setInterpGenerating(true);
    setInterpError(null);
    stopSpeaking();
    try {
      const fresh = await generateInterpBriefing({
        language: config.language,
        dialect: config.dialect,
        domain: config.domain,
      });
      saveInterpBriefingCache(config.language, config.dialect, config.domain, fresh);
      setBriefing(fresh);
      setChunkNotes('');
      setRenditionText('');
      setInterpEval(null);
    } catch (err) {
      setInterpError(err instanceof Error ? err.message : 'Unable to generate interpretation briefing.');
    } finally {
      setInterpGenerating(false);
    }
  };

  const handleToggleRenditionMic = () => {
    if (stt.isListening) {
      stopListening();
      return;
    }
    stopSpeaking();
    stt.resetTranscript();
    const targetLangBcp = direction === 'target_to_en' ? 'en-US' : dialectInfo.bcp47;
    stt.startListening({lang: targetLangBcp, continuous: true});
  };

  const handleGradeInterp = async () => {
    if (!renditionText.trim()) {
      setInterpError('Speak or type your consecutive interpretation before grading.');
      return;
    }
    setInterpLoading(true);
    setInterpError(null);
    try {
      const res = await gradeInterpretation({
        language: config.language,
        briefingText: briefing.briefingText,
        candidateRendition: renditionText.trim(),
        chunkNotes,
        direction,
      });
      setInterpEval(res);
      onLogHistory({
        id: createId('hist-interp'),
        module: 'interp',
        language: config.language,
        dialect: config.dialect,
        domain: config.domain,
        completedAt: new Date().toISOString(),
        summary: `Consecutive Interp: ${briefing.scenarioTitle}`,
        scoreLabel: `${res.fidelityScore}% fidelity`,
      });
    } catch (err) {
      setInterpError(err instanceof Error ? err.message : 'Unable to grade interpretation.');
    } finally {
      setInterpLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left 7 cols: Briefing Audio Player + Digital Chunking Scratchpad + Rendition */}
      <div className="lg:col-span-7 rounded-xl border border-[#23303E] bg-[#111922] p-5 sm:p-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-[#94A3B8]">
              {briefing.speakerRole} · ~{briefing.estimatedSeconds}s briefing clip
            </p>
            <h2 className="text-lg font-semibold text-[#F8FAFC] mt-0.5">{briefing.scenarioTitle}</h2>
          </div>

          <button
            type="button"
            onClick={handleGenerateBriefing}
            disabled={interpGenerating}
            className="flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-lg border border-[#23303E] text-xs font-medium text-[#CBD5E1] hover:text-white hover:border-[#35495E] whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${interpGenerating ? 'animate-spin' : ''}`} />
            <span>{interpGenerating ? 'Generating…' : 'New Delegation Clip'}</span>
          </button>
        </div>

        {/* Playback Controls + Blind Listen Toggle */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() =>
              tts.isSpeaking
                ? tts.stop()
                : tts.speak(briefing.briefingText, {
                    lang: dialectInfo.bcp47,
                    rate: config.speechRate,
                    voiceURI: config.voiceURI,
                  })
            }
            className="flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] transition-colors whitespace-nowrap"
          >
            {tts.isSpeaking ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            <span>{tts.isSpeaking ? 'Stop Briefing Clip' : 'Play Briefing Audio'}</span>
          </button>

          <button
            type="button"
            onClick={() => setBlindMode((b) => !b)}
            className="flex items-center gap-1.5 px-3.5 py-2.5 min-h-[44px] rounded-lg border border-[#23303E] bg-[#0B1117] text-xs font-medium text-[#CBD5E1] hover:text-white whitespace-nowrap"
          >
            {blindMode ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>{blindMode ? 'Reveal Source Script' : 'Hide Script (Blind Listen)'}</span>
          </button>

          <div className="flex items-center rounded-lg bg-[#0B1117] p-0.5 border border-[#23303E] ml-auto">
            <button
              type="button"
              onClick={() => setDirection('target_to_en')}
              className={`px-2.5 py-1.5 text-xs rounded-md ${
                direction === 'target_to_en' ? 'bg-[#1D2B3A] text-white font-medium' : 'text-[#8B9BB0]'
              }`}
            >
              {config.language.toUpperCase()} → EN
            </button>
            <button
              type="button"
              onClick={() => setDirection('en_to_target')}
              className={`px-2.5 py-1.5 text-xs rounded-md ${
                direction === 'en_to_target' ? 'bg-[#1D2B3A] text-white font-medium' : 'text-[#8B9BB0]'
              }`}
            >
              EN → {config.language.toUpperCase()}
            </button>
          </div>
        </div>

        {!blindMode && (
          <div className="rounded-lg border border-[#23303E] bg-[#0B1117] p-4 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-[#7D8FA3]">
              <span>Source Briefing Script</span>
              <button
                type="button"
                onClick={() =>
                  tts.speak(briefing.briefingText, {
                    lang: dialectInfo.bcp47,
                    rate: config.speechRate,
                    voiceURI: config.voiceURI,
                  })
                }
                className="inline-flex items-center gap-1 text-[#CBD5E1] hover:text-[#F3C669]"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Replay</span>
              </button>
            </div>
            <p className="text-sm text-[#E6EDF3] leading-relaxed">{briefing.briefingText}</p>
          </div>
        )}

        {/* Digital Idea-Chunking Scratchpad */}
        <div className="space-y-2.5 pt-4 border-t border-[#23303E]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="interp-scratchpad" className="text-xs font-semibold text-[#E6EDF3]">
              Digital Scratchpad — Idea-Chunking Notes
            </label>
            <div className="flex flex-wrap items-center gap-1">
              {CHUNKING_SYMBOLS.map((item) => (
                <button
                  key={item.symbol}
                  type="button"
                  title={item.label}
                  aria-label={`Insert ${item.label} symbol`}
                  onClick={() =>
                    setChunkNotes((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${item.symbol} `)
                  }
                  className="px-2 py-1 rounded border border-[#23303E] bg-[#0B1117] text-xs text-[#CBD5E1] hover:border-[#D99B26] hover:text-[#F3C669] transition-colors"
                >
                  {item.symbol}
                </button>
              ))}
            </div>
          </div>
          <textarea
            id="interp-scratchpad"
            rows={4}
            value={chunkNotes}
            onChange={(e) => setChunkNotes(e.target.value)}
            placeholder="Jot down diagonal Rozan-style chunks while listening (numbers, actors, → causes, ≠ caveats, ⏱ deadlines)…"
            className="w-full rounded-lg border border-[#23303E] bg-[#0B1117] px-3.5 py-2.5 font-mono text-xs text-[#E6EDF3] placeholder:text-[#64748B] focus:outline-none focus:border-[#D99B26] leading-relaxed"
          />
        </div>

        {/* Consecutive Rendition Capture */}
        <div className="space-y-2.5 pt-4 border-t border-[#23303E]">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="interp-rendition" className="text-xs font-semibold text-[#E6EDF3]">
              Your Consecutive Rendition ({direction === 'target_to_en' ? 'English' : LANGUAGE_LABELS[config.language]})
            </label>
            <button
              type="button"
              onClick={handleToggleRenditionMic}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                stt.isListening
                  ? 'bg-red-600 text-white'
                  : 'border border-[#2E4054] bg-[#16202B] text-[#E6EDF3] hover:bg-[#1E2C3A]'
              }`}
            >
              {stt.isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              <span>{stt.isListening ? 'Stop Dictation' : 'Record Rendition'}</span>
            </button>
          </div>
          <textarea
            id="interp-rendition"
            rows={4}
            value={renditionText}
            onChange={(e) => setRenditionText(e.target.value)}
            placeholder="Deliver your consecutive interpretation aloud using your chunking notes, or type it here…"
            className="w-full rounded-lg border border-[#23303E] bg-[#0B1117] px-3.5 py-2.5 text-sm text-[#E6EDF3] placeholder:text-[#64748B] focus:outline-none focus:border-[#D99B26] leading-relaxed"
          />

          {interpError && <p className="text-xs text-red-300">{interpError}</p>}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleGradeInterp}
              disabled={interpLoading || !renditionText.trim()}
              className="flex items-center gap-2 px-5 py-2.5 min-h-[44px] rounded-lg bg-[#D99B26] text-[#0B1117] text-sm font-semibold hover:bg-[#E5AE42] disabled:opacity-40 transition-colors"
            >
              {interpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              <span>{interpLoading ? 'Evaluating Fidelity…' : 'Grade Interpretation'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Right 5 cols: Fidelity & Register Evaluation */}
      <div className="lg:col-span-5 rounded-xl border border-[#23303E] bg-[#111922] p-5 sm:p-6 space-y-5">
        <h2 className="text-sm font-semibold text-[#F8FAFC]">Consecutive Fidelity Audit</h2>
        {!interpEval ? (
          <div className="space-y-4 text-sm text-[#94A3B8]">
            <p className="leading-relaxed">
              Play the briefing clip in Blind Listen mode, capture numbers and caveats on your idea-chunking scratchpad,
              and deliver your consecutive rendition.
            </p>
            <div className="pt-3 border-t border-[#23303E] space-y-1.5 text-xs">
              <p className="font-semibold text-[#CBD5E1]">Key Fact Count in Clip</p>
              <p className="font-mono text-[#E6EDF3] tabular-nums">
                {briefing.keyFacts.length} operational anchors to capture
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 pb-4 border-b border-[#23303E]">
              <div>
                <p className="text-xs text-[#94A3B8]">Fidelity Score</p>
                <p className="font-mono text-2xl font-bold text-[#F8FAFC] tabular-nums">{interpEval.fidelityScore}%</p>
              </div>
              <div>
                <p className="text-xs text-[#94A3B8]">Diplomatic Register</p>
                <p className="font-mono text-2xl font-bold text-[#D99B26] tabular-nums">{interpEval.registerScore}%</p>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <p className="font-semibold text-emerald-400">Captured Operational Facts</p>
              <ul className="space-y-1 text-[#CBD5E1]">
                {/* Read-only list replaced wholesale per evaluation; items may repeat, so index keys are safe here. */}
                {interpEval.capturedPoints.map((pt, i) => (
                  <li key={i}>• {pt}</li>
                ))}
              </ul>
            </div>

            {interpEval.missedOrDistorted.length > 0 && (
              <div className="space-y-2 text-xs">
                <p className="font-semibold text-red-300">Omissions or Distortions</p>
                <ul className="space-y-1 text-[#CBD5E1]">
                  {interpEval.missedOrDistorted.map((pt, i) => (
                    <li key={i}>• {pt}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="pt-4 border-t border-[#23303E] space-y-1.5 text-xs">
              <p className="font-semibold text-sky-300">Terminology Feedback</p>
              <p className="text-[#CBD5E1] leading-relaxed">{interpEval.terminologyFeedback}</p>
            </div>

            <div className="pt-4 border-t border-[#23303E] space-y-1.5">
              <p className="text-xs font-semibold text-[#CBD5E1]">Model Diplomatic Rendition</p>
              <p className="text-sm text-[#F8FAFC] leading-relaxed">{interpEval.modelRendition}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
