import React, {useRef, useState} from 'react';
import {Clock, Play, Volume2} from 'lucide-react';
import type {BriefItem} from '../../../types';
import {ModalBody, ModalFooter} from '../modalLayout';

interface GistListenStageProps {
  clip: BriefItem;
  /** The clip ended, or the learner chose to start the 60-second summary. */
  onBeginSummary: () => void;
  onCancel: () => void;
}

/** Setup stage: play the broadcast once, then the 60-second summary starts. */
export const GistListenStage: React.FC<GistListenStageProps> = ({clip, onBeginSummary, onCancel}) => {
  const listenAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlayingClip, setIsPlayingClip] = useState(false);
  const [audioError, setAudioError] = useState(false);

  const handlePlayOnce = () => {
    if (isPlayingClip) return;
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
    onBeginSummary();
  };

  return (
    <>
      <ModalBody>
        <div className="space-y-5">
          <div className="rounded-xl border border-[#23303E] bg-[#0B1117] p-5 space-y-4">
            <div className="space-y-1">
              <p className="font-mono text-xs uppercase tracking-wider text-[#7DD3FC]">Step 1 of 2 · Listen once</p>
              <p className="text-sm text-[#CBD5E1] leading-relaxed">
                Play the broadcast once without notes or replay. As soon as the clip ends, a 60-second timer will start
                for your 3-sentence English summary.
              </p>
            </div>

            {clip.audioUrl && (
              <audio
                ref={listenAudioRef}
                key={`gist-listen-${clip.id}`}
                src={clip.audioUrl}
                preload="none"
                onPlay={() => setIsPlayingClip(true)}
                onEnded={onBeginSummary}
                onError={() => {
                  setIsPlayingClip(false);
                  setAudioError(true);
                }}
              >
                <track kind="captions" />
              </audio>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {/* Plays once: the stage ends when the clip does, so there is no "played" state to show. */}
              <button
                type="button"
                data-testid="gist-play-once-btn"
                disabled={isPlayingClip || !clip.audioUrl}
                onClick={handlePlayOnce}
                className={`inline-flex items-center gap-2 px-5 py-3 min-h-[52px] rounded-xl text-sm font-semibold transition-colors ${
                  isPlayingClip
                    ? 'bg-[#7DD3FC]/20 text-[#7DD3FC] border border-[#7DD3FC]/40 cursor-wait'
                    : 'bg-[#D99B26] text-[#0B1117] hover:bg-[#E5AE42]'
                }`}
              >
                {isPlayingClip ? <Volume2 className="w-4 h-4 animate-pulse" /> : <Play className="w-4 h-4 ml-0.5" />}
                <span>{isPlayingClip ? 'Playing clip (1 play only)…' : 'Play clip once'}</span>
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
                <a href={clip.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline text-[#7DD3FC]">
                  {clip.sourceName}
                </a>
                , then tap “Start 60s summary now”.
              </p>
            )}
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <span className="text-xs text-[#94A3B8]">Listen once · then 60s to summarize</span>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 min-h-[44px] rounded-xl text-xs sm:text-sm font-medium text-[#94A3B8] hover:text-white transition-colors"
        >
          Cancel
        </button>
      </ModalFooter>
    </>
  );
};
