import React, {useCallback, useEffect, useMemo, useRef} from 'react';
import {
  computeAnimatedBarHeights,
  computeWaveformProgress,
  formatAudioTime,
  generateWaveformEnvelope,
} from '../../utils/waveformMath';

export interface AudioWaveformProps {
  /** Deterministic seed (typically BriefItem.id) for the broadcast waveform contour. */
  seedId: string;
  /** True while the associated <audio> element is actively playing. */
  isPlaying: boolean;
  /** True after a single-play broadcast clip has finished playing. */
  playedOnce?: boolean;
  /** True when the remote audio stream failed to load/play. */
  hasError?: boolean;
  /** Current playback time in seconds from the <audio> element. */
  currentTime?: number;
  /** Finite audio duration in seconds from the <audio> element (0 if unknown/not yet loaded). */
  duration?: number;
  /** Optional fallback length hint (e.g., "~2 min") shown before audio metadata loads. */
  lengthHint?: string;
  /** Visual accent color matching the playback role. */
  accent?: 'sky' | 'amber';
  /** Compact height variant for secondary replay panels. */
  compact?: boolean;
  /** Optional custom status caption on the left of the header line. */
  statusLabel?: string;
  /** Stable data-testid for automated inspection. */
  testId?: string;
}

const ACCENT_PALETTE = {
  sky: {
    activeBar: '#7DD3FC',
    activePeak: '#BAE6FD',
    playhead: '#E0F2FE',
    dot: 'bg-[#7DD3FC]',
    text: 'text-[#7DD3FC]',
    borderPlaying: 'border-[#7DD3FC]/40',
  },
  amber: {
    activeBar: '#D99B26',
    activePeak: '#F3C669',
    playhead: '#FDE68A',
    dot: 'bg-[#D99B26]',
    text: 'text-[#F3C669]',
    borderPlaying: 'border-[#D99B26]/45',
  },
} as const;

function drawRoundedBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}

export const AudioWaveform: React.FC<AudioWaveformProps> = ({
  seedId,
  isPlaying,
  playedOnce = false,
  hasError = false,
  currentTime = 0,
  duration = 0,
  lengthHint,
  accent = 'sky',
  compact = false,
  statusLabel,
  testId = 'brief-audio-waveform',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reducedMotionRef = useRef(false);
  const animStartMsRef = useRef<number>(0);
  const envelopeCacheRef = useRef<{seedId: string; barCount: number; values: number[]} | null>(null);
  const latestPropsRef = useRef({
    seedId,
    isPlaying,
    playedOnce,
    hasError,
    currentTime,
    duration,
    accent,
    compact,
  });

  const palette = ACCENT_PALETTE[accent];
  const hasFiniteDuration = Number.isFinite(duration) && duration > 0;

  const status: 'error' | 'playing' | 'played' | 'idle' = hasError
    ? 'error'
    : isPlaying
      ? 'playing'
      : playedOnce
        ? 'played'
        : 'idle';

  const resolvedStatusLabel = useMemo(() => {
    if (statusLabel) return statusLabel;
    if (hasError) return 'Stream unavailable';
    if (isPlaying) return 'Live broadcast audio';
    if (playedOnce) return 'Broadcast played';
    return 'Audio waveform · ready';
  }, [hasError, isPlaying, playedOnce, statusLabel]);

  const timeReadout = useMemo(() => {
    if (hasError) return '—';
    if (hasFiniteDuration) {
      const displayCurrent = playedOnce && !isPlaying ? duration : currentTime;
      return `${formatAudioTime(displayCurrent)} / ${formatAudioTime(duration)}`;
    }
    if (isPlaying && currentTime > 0) {
      return `${formatAudioTime(currentTime)} · live`;
    }
    if (playedOnce) return 'Completed';
    return lengthHint ? lengthHint : '0:00';
  }, [currentTime, duration, hasError, hasFiniteDuration, isPlaying, lengthHint, playedOnce]);

  const drawFrame = useCallback((nowMs: number) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const props = latestPropsRef.current;
    const canvasHeight = props.compact ? 36 : 52;
    const rect = container.getBoundingClientRect();
    const width = Math.max(160, Math.floor(rect.width));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const targetPixelW = Math.floor(width * dpr);
    const targetPixelH = Math.floor(canvasHeight * dpr);
    if (canvas.width !== targetPixelW || canvas.height !== targetPixelH) {
      canvas.width = targetPixelW;
      canvas.height = targetPixelH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, canvasHeight);

    const activePalette = ACCENT_PALETTE[props.accent];
    const barWidth = props.compact ? 2.5 : 3;
    const barGap = props.compact ? 2.5 : 3;
    const step = barWidth + barGap;
    const barCount = Math.max(24, Math.min(110, Math.floor((width + barGap) / step)));

    let envelope: number[];
    if (
      envelopeCacheRef.current &&
      envelopeCacheRef.current.seedId === props.seedId &&
      envelopeCacheRef.current.barCount === barCount
    ) {
      envelope = envelopeCacheRef.current.values;
    } else {
      envelope = generateWaveformEnvelope(props.seedId, barCount);
      envelopeCacheRef.current = {seedId: props.seedId, barCount, values: envelope};
    }

    const elapsedSec = animStartMsRef.current > 0 ? Math.max(0, (nowMs - animStartMsRef.current) / 1000) : 0;
    const currentProgress = computeWaveformProgress(
      props.currentTime,
      props.duration,
      props.playedOnce,
      props.isPlaying
    );
    const hasDuration = Number.isFinite(props.duration) && props.duration > 0;
    const heights = computeAnimatedBarHeights({
      envelope,
      elapsedSec,
      isPlaying: props.isPlaying,
      reducedMotion: reducedMotionRef.current,
      progress: hasDuration ? currentProgress : undefined,
      hasError: props.hasError,
    });

    const totalWaveformWidth = barCount * barWidth + (barCount - 1) * barGap;
    const offsetX = Math.max(0, (width - totalWaveformWidth) / 2);
    const centerY = canvasHeight / 2;
    const maxBarHeight = canvasHeight - 6;

    // Subtle center reference axis
    ctx.fillStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.fillRect(0, centerY - 0.5, width, 1);

    // Traveling highlight wave when streaming without a known duration
    const streamCenter = (elapsedSec * 0.22) % 1;

    for (let i = 0; i < barCount; i += 1) {
      const normPos = barCount > 1 ? i / (barCount - 1) : 0;
      const barH = Math.max(4, heights[i] * maxBarHeight);
      const x = offsetX + i * step;
      const y = centerY - barH / 2;

      if (props.hasError) {
        ctx.fillStyle = '#3B2830';
      } else if (props.isPlaying) {
        if (hasDuration) {
          if (normPos <= currentProgress) {
            const distFromHead = currentProgress - normPos;
            ctx.fillStyle = distFromHead < 0.08 ? activePalette.activePeak : activePalette.activeBar;
          } else {
            ctx.fillStyle = '#2B3D50';
          }
        } else {
          const dist = Math.min(Math.abs(normPos - streamCenter), 1 - Math.abs(normPos - streamCenter));
          ctx.fillStyle = dist < 0.12 ? activePalette.activePeak : dist < 0.3 ? activePalette.activeBar : '#2F455C';
        }
      } else if (props.playedOnce) {
        ctx.fillStyle = 'rgba(125, 211, 252, 0.35)';
      } else {
        ctx.fillStyle = '#263647';
      }

      drawRoundedBar(ctx, x, y, barWidth, barH, barWidth / 2);
    }

    // Crisp vertical playhead needle when playing with known duration
    if (props.isPlaying && hasDuration && currentProgress > 0 && currentProgress < 1) {
      const headX = offsetX + currentProgress * totalWaveformWidth;
      ctx.fillStyle = activePalette.playhead;
      ctx.fillRect(Math.round(headX) - 0.75, 2, 1.5, canvasHeight - 4);
    }

    ctx.restore();
  }, []);

  // Sync latest props for rAF and repaint immediately when idle/paused state changes
  useEffect(() => {
    latestPropsRef.current = {
      seedId,
      isPlaying,
      playedOnce,
      hasError,
      currentTime,
      duration,
      accent,
      compact,
    };
    if (!isPlaying || reducedMotionRef.current) {
      drawFrame(performance.now());
    }
  }, [accent, compact, currentTime, drawFrame, duration, hasError, isPlaying, playedOnce, seedId]);

  // Track prefers-reduced-motion preference
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const onChange = (event: MediaQueryListEvent) => {
      reducedMotionRef.current = event.matches;
      drawFrame(performance.now());
    };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [drawFrame]);

  // Observe responsive container width changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    drawFrame(performance.now());

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      drawFrame(performance.now());
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [drawFrame]);

  // Continuous 60fps animation strictly while playing and reduced-motion is off
  useEffect(() => {
    if (!isPlaying || reducedMotionRef.current) {
      return;
    }

    animStartMsRef.current = performance.now();
    let rafId: number | null = null;
    const tick = (nowMs: number) => {
      drawFrame(nowMs);
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [drawFrame, isPlaying]);

  return (
    <div
      data-testid={testId}
      data-playing={isPlaying ? 'true' : 'false'}
      data-status={status}
      role="img"
      aria-label={`${resolvedStatusLabel} (${timeReadout})`}
      className={`rounded-xl border bg-[#090E14] transition-colors ${
        compact ? 'px-3 py-2 space-y-1.5' : 'px-3.5 py-2.5 space-y-2'
      } ${hasError ? 'border-[#F87171]/35' : isPlaying ? palette.borderPlaying : 'border-[#23303E]'}`}
    >
      <div className="flex items-center justify-between gap-3 text-[11px] font-mono">
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden="true"
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              hasError
                ? 'bg-[#F87171]'
                : isPlaying
                  ? `${palette.dot} motion-safe:animate-pulse`
                  : playedOnce
                    ? 'bg-[#7DD3FC]/50'
                    : 'bg-[#475569]'
            }`}
          />
          <span
            className={`uppercase tracking-wider truncate ${
              hasError ? 'text-[#F87171]' : isPlaying ? palette.text : 'text-[#94A3B8]'
            }`}
          >
            {resolvedStatusLabel}
          </span>
        </div>

        <span className="tabular-nums text-[#CBD5E1] shrink-0">{timeReadout}</span>
      </div>

      <div ref={containerRef} className="w-full overflow-hidden">
        <canvas
          ref={canvasRef}
          data-testid={`${testId}-canvas`}
          aria-hidden="true"
          className={`block w-full ${compact ? 'h-9' : 'h-[52px]'}`}
        />
      </div>
    </div>
  );
};
