import React, {useRef, useState} from 'react';
import {BookOpen, ExternalLink, FileCheck2, MessageSquare, Pause, Play, Sparkles, Volume2} from 'lucide-react';
import type {BriefItem} from '../../types';
import {getTopicLabel, isBriefItemDrillable} from '../../utils/briefLogic';
import {getMaxQuestionsForPassage} from '../../utils/dlptRules';
import {getDialectInfo} from '../../utils/ilrLogic';

interface BriefFeedCardProps {
  item: BriefItem;
  onOpenDrill: (item: BriefItem) => void;
  onOpenGist?: (item: BriefItem) => void;
  onBriefItBack: (item: BriefItem) => void;
  onOpenStudy: (item: BriefItem) => void;
}

export const BriefFeedCard: React.FC<BriefFeedCardProps> = ({
  item,
  onOpenDrill,
  onOpenGist,
  onBriefItBack,
  onOpenStudy,
}) => {
  const drillable = isBriefItemDrillable(item);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const dialect = getDialectInfo(item.language, item.dialectId);

  const toggleAudio = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      setAudioError(false);
      audioRef.current.play().catch(() => {
        setIsPlaying(false);
        setAudioError(true);
      });
      setIsPlaying(true);
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
  };

  return (
    <article
      data-testid={`brief-card-${item.id}`}
      className="rounded-xl border border-[#23303E] bg-[#111922] p-5 space-y-3.5 hover:border-[#35495E] transition-colors"
    >
      {/* 1. Italic DLPT Orientation Line */}
      <p className="text-xs sm:text-sm italic text-[#94A3B8] leading-relaxed">{item.orientationLine}</p>

      {/* 2. Target-Language Headline */}
      <div className="space-y-1">
        <h2 className="text-base sm:text-lg font-semibold text-[#F8FAFC] tracking-tight leading-snug">{item.title}</h2>
        <p className="text-xs sm:text-sm text-[#CBD5E1] line-clamp-2 leading-relaxed">{item.summary}</p>
      </div>

      {/* 3. Unboxed Zero-Pill Metadata with · Dividers */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#94A3B8]">
        <span className="font-semibold text-[#D99B26]">ILR Level {item.ilrLevel}</span>
        <span aria-hidden="true" className="text-[#35495E]">
          ·
        </span>
        <span>{item.lengthLabel}</span>
        <span aria-hidden="true" className="text-[#35495E]">
          ·
        </span>
        <span>{getTopicLabel(item.topic)}</span>
        <span aria-hidden="true" className="text-[#35495E]">
          ·
        </span>
        <span>{dialect.short}</span>
        <span aria-hidden="true" className="text-[#35495E]">
          ·
        </span>
        <span className="text-[#7DD3FC]">{item.sourceName}</span>
      </div>

      {/* 4. Audio Stream Player (if mediaType is audio) */}
      {item.mediaType === 'audio' && item.audioUrl && (
        <div className="flex items-center gap-3 p-2.5 rounded-lg bg-[#0B1117] border border-[#23303E]">
          <audio
            ref={audioRef}
            src={item.audioUrl}
            preload="none"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={handleAudioEnded}
            onError={() => {
              setIsPlaying(false);
              setAudioError(true);
            }}
          >
            <track kind="captions" />
          </audio>
          <button
            type="button"
            onClick={toggleAudio}
            aria-label={isPlaying ? 'Pause broadcast stream' : 'Play broadcast stream from source'}
            className="flex items-center justify-center w-11 h-11 rounded-full bg-[#D99B26] text-[#0B1117] hover:bg-[#E5AE42] transition-colors shrink-0"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-medium text-[#F8FAFC]">
              <Volume2 className="w-3.5 h-3.5 text-[#7DD3FC]" />
              <span className="truncate">Publisher stream</span>
            </div>
            {audioError ? (
              <p className="text-[11px] text-[#F87171] truncate">
                Stream unavailable inline — open at{' '}
                <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline text-[#7DD3FC]">
                  {item.sourceName}
                </a>
              </p>
            ) : (
              <p className="text-[11px] text-[#7D8FA3] truncate">Streams directly from {item.sourceName}</p>
            )}
          </div>
        </div>
      )}

      {/* 5. Actions: DLPT drill, Brief it back, Gist (Phase 7), Study */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#23303E]">
        <div className="flex flex-wrap items-center gap-2">
          {/* DLPT Drill: only when there is real source text to test against (REVIEW C-2) */}
          {drillable ? (
            <button
              type="button"
              onClick={() => onOpenDrill(item)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[52px] rounded-lg bg-[#D99B26] text-[#0B1117] text-xs font-semibold hover:bg-[#E5AE42] transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>DLPT drill · up to {getMaxQuestionsForPassage(item.language, item.mediaType)} Q</span>
            </button>
          ) : (
            <p className="text-xs text-[#94A3B8]" data-testid={`brief-no-drill-${item.id}`}>
              No transcript yet: listen at the source. Drills need the real source text.
            </p>
          )}

          {/* Brief it back (wires to OPI) */}
          <button
            type="button"
            onClick={() => onBriefItBack(item)}
            className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg border border-[#23303E] bg-[#0B1117] text-xs font-semibold text-[#CBD5E1] hover:text-white hover:border-[#35495E] transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5 text-[#7DD3FC]" />
            <span>Brief it back</span>
          </button>

          {/* Gist drill (Audio items only) */}
          {item.mediaType === 'audio' && drillable && onOpenGist && (
            <button
              type="button"
              data-testid={`brief-gist-btn-${item.id}`}
              onClick={() => onOpenGist(item)}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg border border-[#7DD3FC]/40 bg-[#7DD3FC]/10 text-xs font-semibold text-[#7DD3FC] hover:bg-[#7DD3FC]/20 transition-colors"
            >
              <FileCheck2 className="w-3.5 h-3.5" />
              <span>Gist</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Study / Excerpt lookup */}
          <button
            type="button"
            onClick={() => onOpenStudy(item)}
            title="Read short study excerpt & lookup vocabulary"
            aria-label="Open study excerpt"
            className="inline-flex items-center justify-center w-11 h-11 rounded-lg border border-[#23303E] bg-[#0B1117] text-[#94A3B8] hover:text-[#7DD3FC] hover:border-[#7DD3FC]/50 transition-colors"
          >
            <BookOpen className="w-4 h-4" />
          </button>

          {/* Publisher source external link (practice stories have none) */}
          {item.sourceUrl && (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={`Read original at ${item.sourceName}`}
              aria-label={`Open source article on ${item.sourceName}`}
              className="inline-flex items-center justify-center w-11 h-11 rounded-lg border border-[#23303E] bg-[#0B1117] text-[#94A3B8] hover:text-white hover:border-[#35495E] transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>
    </article>
  );
};
