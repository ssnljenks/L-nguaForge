/**
 * Pure math helpers for the Brief listening audio waveform visualization.
 *
 * Brief audio streams come from external publisher feeds that frequently omit CORS headers,
 * so we must not silence audio via Web Audio createMediaElementSource(). Instead, we build
 * a deterministic per-broadcast speech-cadence envelope and animate it smoothly in sync with
 * real <audio> playback state and progress.
 */

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Deterministic 32-bit FNV-1a hash used to seed the waveform envelope per clip ID.
 */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  const input = seed || 'brief-audio';
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Mulberry32 deterministic PRNG returning values in [0, 1).
 */
function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates a realistic broadcast speech-cadence envelope with phrase swells,
 * brief breath pauses, and natural dynamic peaks. All values are clamped in [0.14, 0.94].
 */
export function generateWaveformEnvelope(seed: string, barCount: number): number[] {
  const safeCount = Math.max(8, Math.min(256, Math.floor(barCount)));
  const rand = createPrng(hashSeed(seed));
  const raw: number[] = new Array(safeCount);

  // Build organic speech phrases: 4–9 bars of vocal activity separated by short 1–3 bar breath pauses.
  let remainingInPhase = 0;
  let inPause = false;
  let phraseEnergy = 0.72;

  for (let i = 0; i < safeCount; i += 1) {
    if (remainingInPhase <= 0) {
      inPause = !inPause && i > 2 && i < safeCount - 3 ? rand() < 0.44 : false;
      if (inPause) {
        remainingInPhase = 1 + Math.floor(rand() * 3);
      } else {
        remainingInPhase = 4 + Math.floor(rand() * 7);
        phraseEnergy = 0.56 + rand() * 0.42;
      }
    }
    remainingInPhase -= 1;

    // Gentle fade-in / fade-out at clip edges
    const edgeFactor = i < 2 ? 0.5 + i * 0.25 : i >= safeCount - 2 ? 0.5 + (safeCount - 1 - i) * 0.25 : 1;

    if (inPause) {
      raw[i] = clamp((0.14 + rand() * 0.1) * edgeFactor, 0.14, 0.28);
    } else {
      const syllableAccent = 0.42 + rand() * 0.72;
      raw[i] = clamp(phraseEnergy * syllableAccent * edgeFactor, 0.14, 0.94);
    }
  }

  // Subtle smoothing that preserves sharp consonant peaks and breath troughs
  return raw.map((val, idx) => {
    const prev = idx > 0 ? raw[idx - 1] : val;
    const next = idx < safeCount - 1 ? raw[idx + 1] : val;
    const smoothed = prev * 0.1 + val * 0.8 + next * 0.1;
    return clamp(smoothed, 0.14, 0.94);
  });
}

export interface AnimatedBarOptions {
  envelope: readonly number[];
  elapsedSec: number;
  isPlaying: boolean;
  reducedMotion?: boolean;
  /** Optional 0..1 playback progress; boosts live vocal energy right around the playhead. */
  progress?: number;
  hasError?: boolean;
}

/**
 * Computes per-bar normalized heights in [0.1, 1.0] for the current animation frame.
 * - Idle: clean resting broadcast contour.
 * - Error: low, flattened bars to convey unavailable stream without relying solely on color.
 * - Playing + reducedMotion: elevated static contour (no rapid oscillation).
 * - Playing: smooth multi-harmonic vocal modulation + playhead energy focus.
 */
export function computeAnimatedBarHeights({
  envelope,
  elapsedSec,
  isPlaying,
  reducedMotion = false,
  progress,
  hasError = false,
}: AnimatedBarOptions): number[] {
  const count = envelope.length;
  if (count === 0) return [];

  if (hasError) {
    return envelope.map((v) => clamp(0.14 + v * 0.16, 0.12, 0.3));
  }

  if (!isPlaying) {
    return envelope.map((v) => clamp(v * 0.84, 0.12, 0.88));
  }

  if (reducedMotion) {
    return envelope.map((v) => clamp(v * 0.94, 0.16, 0.96));
  }

  const t = Number.isFinite(elapsedSec) ? elapsedSec : 0;
  const hasProgress = typeof progress === 'number' && Number.isFinite(progress) && progress > 0 && progress < 1;

  return envelope.map((base, idx) => {
    const normX = count > 1 ? idx / (count - 1) : 0;

    // Combine three incommensurate speech-cadence harmonics so bars breathe organically
    const waveA = Math.sin(t * 7.4 + idx * 0.68);
    const waveB = Math.sin(t * 11.8 - idx * 1.15 + base * 5.0);
    const waveC = Math.cos(t * 4.3 + idx * 0.34);
    const modulation = 0.84 + 0.18 * waveA + 0.11 * waveB + 0.08 * waveC;

    // Emphasize active region near playhead (or a gentle traveling scan when duration is unknown)
    const focusCenter = hasProgress ? progress : (t * 0.22) % 1;
    const dist = Math.abs(normX - focusCenter);
    const focusBoost = dist < 0.16 ? 1 + (1 - dist / 0.16) * 0.26 : 1;

    return clamp(base * modulation * focusBoost, 0.12, 1.0);
  });
}

/**
 * Computes normalized 0..1 playback progress for coloring played vs. unplayed bars.
 */
export function computeWaveformProgress(
  currentTime: number,
  duration: number,
  playedOnce: boolean,
  isPlaying: boolean
): number {
  if (playedOnce && !isPlaying) return 1;
  if (Number.isFinite(duration) && duration > 0 && Number.isFinite(currentTime) && currentTime >= 0) {
    return clamp(currentTime / duration, 0, 1);
  }
  return 0;
}

/**
 * Formats seconds as m:ss (e.g. 0:00, 1:45). Non-finite or negative inputs return "0:00".
 */
export function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const totalSec = Math.floor(seconds);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
