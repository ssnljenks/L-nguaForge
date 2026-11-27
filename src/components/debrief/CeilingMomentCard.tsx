import {getBrowserEnv} from '../../audio/capabilities';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {AlertTriangle, Play, RotateCcw, Square} from 'lucide-react';
import type {AppendErrorEventsFn, DebriefReport, OpiRedoRecord, OpiSession} from '../../types';
import {formatSecondsClock} from '../../utils/ilrLogic';
import {extractClipWindow, splitProblemSpan} from '../../utils/opiLogic';
import {loadOpiAudioForSession, type StoredOpiAudio} from '../../utils/opiAudioStore';
import {CeilingRedoPanel} from './CeilingRedoPanel';

interface CeilingMomentCardProps {
  activeSession: OpiSession;
  ceiling: NonNullable<DebriefReport['ceilingMoment']>;
  onSaveRedo?: (sessionId: string, record: OpiRedoRecord) => void;
  onAppendErrorEvents?: AppendErrorEventsFn;
}

/** "Where it broke down": the ceiling moment, the local mic clip (IndexedDB) and Redo this answer. */
export const CeilingMomentCard: React.FC<CeilingMomentCardProps> = ({
  activeSession,
  ceiling,
  onSaveRedo,
  onAppendErrorEvents,
}) => {
  const [redoOpen, setRedoOpen] = useState(false);

  // Local IndexedDB clip playback state
  const [storedAudio, setStoredAudio] = useState<StoredOpiAudio | null>(null);
  const [isPlayingClip, setIsPlayingClip] = useState(false);
  const [clipNotice, setClipNotice] = useState<string | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

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

  useEffect(() => stopClipPlayback, [stopClipPlayback]);

  // Mic audio of the most recent recorded call, if this is that session.
  const sessionId = activeSession.id;
  useEffect(() => {
    let cancelled = false;
    void loadOpiAudioForSession(sessionId).then((audio) => {
      if (!cancelled) setStoredAudio(audio);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const splitSpan = splitProblemSpan(ceiling.candidateUtterance, ceiling.problemSpan);

  const handlePlayBreakdownClip = () => {
    if (isPlayingClip) {
      stopClipPlayback();
      return;
    }
    if (!storedAudio) {
      setClipNotice(
        getBrowserEnv().platform === 'ios'
          ? "Replay clips aren't recorded on iPhone yet: the microphone is kept free for voice input."
          : 'Mic audio is stored locally for your most recent recorded call only.'
      );
      return;
    }
    setClipNotice(null);
    const url = URL.createObjectURL(storedAudio.blob);
    audioUrlRef.current = url;
    const audio = new Audio(url);
    audioElRef.current = audio;

    const {startSec, endSec} = extractClipWindow(
      ceiling.timestampSeconds,
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

  return (
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

          {ceiling.explanation && <p className="text-xs text-[#94A3B8] leading-relaxed">{ceiling.explanation}</p>}
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
  );
};
