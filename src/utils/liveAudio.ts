/**
 * Pure PCM audio conversion and streaming transcript helpers for Gemini Live API.
 * Input audio to Gemini Live: 16kHz, 16-bit signed little-endian PCM (mono).
 * Output audio from Gemini Live: 24kHz, 16-bit signed little-endian PCM (mono).
 */

export function downsampleFloat32ToInt16Pcm(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate = 16000
): Int16Array {
  if (input.length === 0) return new Int16Array(0);
  if (inputSampleRate <= 0 || targetSampleRate <= 0) return new Int16Array(0);

  if (inputSampleRate === targetSampleRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const clamped = Math.max(-1, Math.min(1, input[i]));
      out[i] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    }
    return out;
  }

  const ratio = inputSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += input[j];
      count++;
    }
    const sample = count > 0 ? sum / count : input[Math.min(start, input.length - 1)];
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
  }

  return out;
}

export function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

export function base64PcmToFloat32(base64: string): Float32Array {
  if (typeof base64 !== 'string' || !base64.trim()) return new Float32Array(0);
  const normalized = base64.trim().replace(/-/g, '+').replace(/_/g, '/');
  const padLen = normalized.length % 4;
  const padded = padLen === 0 ? normalized : `${normalized}${'='.repeat(4 - padLen)}`;

  let bytes: Uint8Array;
  try {
    if (typeof atob === 'function') {
      const binary = atob(padded);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
    } else {
      const buf = Buffer.from(padded, 'base64');
      bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
  } catch {
    return new Float32Array(0);
  }

  const sampleCount = Math.floor(bytes.byteLength / 2);
  if (sampleCount <= 0) return new Float32Array(0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  const floats = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const sample = view.getInt16(i * 2, true);
    floats[i] = sample / 32768;
  }
  return floats;
}

export function computeRmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / samples.length);
  return Math.max(0, Math.min(1, rms * 3.5));
}

export function mergeTranscriptChunk(existing: string, incoming: string): string {
  const base = typeof existing === 'string' ? existing : '';
  const next = typeof incoming === 'string' ? incoming : '';
  if (!next) return base;
  if (!base) return next.trimStart();

  // If Gemini emits cumulative text starting with existing, replace cleanly
  if (next.startsWith(base)) return next;

  const needsSpace = !/\s$/.test(base) && !/^\s/.test(next) && !/^[.,!?;:)\]]/.test(next);

  return needsSpace ? `${base} ${next}` : `${base}${next}`;
}
