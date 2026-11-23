import React from 'react';
import {AudioLines, Loader2} from 'lucide-react';
import type {GeminiLiveStatus} from '../../hooks/useGeminiLive';

interface LiveVoiceOrbProps {
  status: GeminiLiveStatus;
  isLive: boolean;
  isMuted: boolean;
  micLevel: number;
  aiLevel: number;
}

/** Relative heights of the five reactive bars (a fixed visual pattern, never reordered). */
const BAR_MULTIPLIERS = [0.55, 0.85, 1.0, 0.85, 0.55] as const;

/** Reactive orb that pulses with mic input while listening and with model audio while speaking. */
export const LiveVoiceOrb: React.FC<LiveVoiceOrbProps> = ({status, isLive, isMuted, micLevel, aiLevel}) => {
  const listening = status === 'listening' && !isMuted;
  const energy = status === 'speaking' ? Math.max(0.22, aiLevel) : listening ? Math.max(0.08, micLevel) : 0;

  return (
    <div className="relative flex items-center justify-center w-36 h-36 sm:w-40 sm:h-40" aria-hidden="true">
      {/* Outer reactive pulse ring */}
      <div
        className={`absolute inset-0 rounded-full transition-all duration-150 ${
          status === 'speaking'
            ? 'bg-sky-400/12 border border-sky-400/40'
            : listening
              ? 'bg-[#D99B26]/12 border border-[#D99B26]/45'
              : status === 'connecting'
                ? 'bg-[#D99B26]/10 border border-[#D99B26]/30 animate-pulse'
                : 'bg-[#16202B]/70 border border-[#23303E]'
        }`}
        style={{transform: `scale(${1 + energy * 0.22})`}}
      />

      {/* Inner orb core */}
      <div
        className={`relative z-10 w-24 h-24 sm:w-28 sm:h-28 rounded-full flex items-center justify-center border transition-colors ${
          status === 'speaking'
            ? 'bg-[#0F1E2E] border-sky-400/60'
            : listening
              ? 'bg-[#1A1812] border-[#D99B26]/70'
              : 'bg-[#0D141C] border-[#2A394A]'
        }`}
      >
        {status === 'connecting' ? (
          <Loader2 className="w-8 h-8 text-[#D99B26] animate-spin" />
        ) : isLive ? (
          <div className="flex items-center gap-1.5 h-10">
            {BAR_MULTIPLIERS.map((mult, idx) => {
              const heightPx = isMuted ? 6 : Math.max(8, Math.round((0.18 + energy * mult) * 38));
              return (
                <span
                  // Fixed-length static pattern: index keys are correct here.
                  key={idx}
                  className={`w-1.5 rounded-full transition-all duration-100 ${
                    status === 'speaking' ? 'bg-sky-400' : isMuted ? 'bg-[#475569]' : 'bg-[#D99B26]'
                  }`}
                  style={{height: `${heightPx}px`}}
                />
              );
            })}
          </div>
        ) : (
          <AudioLines className="w-9 h-9 text-[#D99B26]" />
        )}
      </div>
    </div>
  );
};
