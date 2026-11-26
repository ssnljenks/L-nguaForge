import React from 'react';
import {ExternalLink, Flag, Headphones, Play, RotateCcw, Volume2} from 'lucide-react';
import type {BriefDrill, BriefItem} from '../../../types';
import type {useWordLookup} from '../../../hooks/useWordLookup';
import {TappableText} from '../../shared/TappableText';
import {WordLookupPopover} from '../../shared/WordLookupPopover';
import type {DrillAudio} from './useDrillAudio';

interface DrillPassageCardProps {
  passage: BriefItem;
  drill: BriefDrill | null;
  allowFlag: boolean;
  flagged: boolean;
  onToggleFlag: (flagged: boolean) => void;
  audio: DrillAudio;
  showFeedback: boolean;
  wordLookup: ReturnType<typeof useWordLookup>;
}

/** Orientation line, title, optional flag, single-play listening audio or the reading excerpt. */
export const DrillPassageCard: React.FC<DrillPassageCardProps> = ({
  passage,
  drill,
  allowFlag,
  flagged,
  onToggleFlag,
  audio,
  showFeedback,
  wordLookup,
}) => {
  const hasPlayedAudioOnce = Boolean(audio.playedOnce[passage.id]);
  const isPlayingCurrentAudio = audio.playingId === passage.id;
  const hasAudioError = Boolean(audio.errorById[passage.id]);

  return (
    <div className="rounded-xl border border-[#23303E] bg-[#0B1117] p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1 min-w-0 flex-1">
          <p data-testid="dlpt-orientation-line" className="text-xs sm:text-sm italic text-[#CBD5E1] leading-relaxed">
            {drill?.orientationLine || passage.orientationLine}
          </p>
          <h2 id="brief-drill-title" className="text-sm sm:text-base font-semibold text-[#F8FAFC]">
            {passage.title}
          </h2>
          <p className="text-xs text-[#7D8FA3]">
            {passage.sourceName} · {passage.lengthLabel}
          </p>
        </div>

        {/* PT DLPT5 Lower-Range: Flag to return checkbox */}
        {allowFlag && (
          <label className="inline-flex items-center gap-2 px-3 py-2 min-h-[44px] rounded-lg border border-[#23303E] bg-[#111922] hover:border-[#D99B26]/50 cursor-pointer shrink-0 transition-colors">
            <input
              type="checkbox"
              checked={flagged}
              onChange={(e) => onToggleFlag(e.target.checked)}
              className="h-4 w-4 accent-[#D99B26] cursor-pointer"
            />
            <Flag className={`w-3.5 h-3.5 ${flagged ? 'text-[#D99B26]' : 'text-[#94A3B8]'}`} />
            <span className="text-xs font-medium text-[#E2E8F0]">Flag to return</span>
          </label>
        )}
      </div>

      {/* Listening Single-Play Audio Control */}
      {passage.mediaType === 'audio' && passage.audioUrl && (
        <div className="pt-2 border-t border-[#23303E] space-y-2.5">
          <audio
            ref={audio.audioRef}
            key={`single-${passage.id}`}
            src={passage.audioUrl}
            preload="none"
            onPlay={() => audio.onMainPlay(passage.id)}
            onEnded={() => audio.onMainEnded(passage.id)}
            onError={() => audio.onMainError(passage.id)}
          >
            <track kind="captions" />
          </audio>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="dlpt-play-audio-btn"
              disabled={hasPlayedAudioOnce || isPlayingCurrentAudio}
              onClick={() => audio.playOnce(passage.id)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 min-h-[52px] rounded-xl text-xs sm:text-sm font-semibold transition-colors ${
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
                href={passage.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-[#7DD3FC]"
              >
                {passage.sourceName}
              </a>
              .
            </p>
          )}

          {/* Practice mode post-check: Replay with transcript */}
          {showFeedback && drill?.studyExcerpt && (
            <div className="pt-2 border-t border-[#23303E]/70 space-y-3">
              <audio
                ref={audio.replayAudioRef}
                key={`replay-${passage.id}`}
                src={passage.audioUrl}
                preload="none"
                onEnded={audio.onReplayStopped}
                onPause={audio.onReplayStopped}
              >
                <track kind="captions" />
              </audio>
              <button
                type="button"
                onClick={() => audio.replayWithTranscript(passage.id)}
                className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-xl border border-[#7DD3FC]/45 bg-[#7DD3FC]/10 text-xs sm:text-sm font-semibold text-[#7DD3FC] hover:bg-[#7DD3FC]/20 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                <span>
                  {audio.replayPlayingId === passage.id ? 'Replaying with transcript…' : 'Replay with transcript'}
                </span>
              </button>

              {audio.transcriptOpenById[passage.id] && (
                <div className="space-y-2">
                  <p className="text-xs text-[#94A3B8]">
                    Short study transcript (tap any word to inspect &amp; save to Vocab):
                  </p>
                  <div className="p-3.5 rounded-xl bg-[#111922] border border-[#23303E] text-sm text-[#F8FAFC] leading-relaxed">
                    <TappableText
                      text={drill.studyExcerpt}
                      activeWord={wordLookup.lookup?.word}
                      onWordTap={(w) =>
                        void wordLookup.lookUpWord(`drill-tx-${passage.id}`, w, drill.studyExcerpt || '')
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
      {passage.mediaType === 'text' && drill?.studyExcerpt && (
        <div className="pt-2 border-t border-[#23303E] space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-[#94A3B8]">
              Reading Passage Excerpt
            </span>
            {passage.sourceUrl ? (
              <a
                href={passage.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-[#7DD3FC] hover:underline"
              >
                <span>Original at {passage.sourceName}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            ) : (
              <span className="text-xs text-[#94A3B8]">{passage.sourceName}</span>
            )}
          </div>
          <div className="p-3.5 sm:p-4 rounded-xl bg-[#111922] border border-[#23303E] text-sm sm:text-[15px] text-[#F8FAFC] leading-relaxed">
            {showFeedback ? (
              <TappableText
                text={drill.studyExcerpt}
                activeWord={wordLookup.lookup?.word}
                onWordTap={(w) => void wordLookup.lookUpWord(`drill-rd-${passage.id}`, w, drill.studyExcerpt || '')}
              />
            ) : (
              <p>{drill.studyExcerpt}</p>
            )}
          </div>
          {showFeedback && (
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
  );
};
