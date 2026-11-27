import {useCallback, useEffect, useRef, useState} from 'react';
import {describeMicError, getBrowserEnv, pickRecorderMimeType} from '../audio/capabilities';
import {reportClientError} from '../services/errorReporter';
import {isSpeechRecognitionSupported} from './useSpeech';

export interface CallAudioController {
  isMuted: boolean;
  isRecording: boolean;
  micLevel: number;
  micAvailable: boolean;
  /** Why the microphone could not start, in words for the learner; null when fine or not attempted. */
  micError: string | null;
  startCapture: () => Promise<boolean>;
  stopCapture: () => Promise<Blob | null>;
  setMuted: (muted: boolean) => void;
  toggleMuted: () => boolean;
}

/**
 * Captures live microphone audio level (for the call waveform) and records the
 * learner's microphone audio locally into a Blob when the call ends.
 * Degrades gracefully when microphone permission is denied or unavailable.
 */
export function useCallAudio(): CallAudioController {
  const [isMuted, setIsMutedState] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [micAvailable, setMicAvailable] = useState(true);
  const [micError, setMicError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const mutedRef = useRef(false);

  const stopAnalyser = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    analyserRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setMicLevel(0);
  }, []);

  const stopTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    setIsMutedState(muted);
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
    if (muted) setMicLevel(0);
  }, []);

  const toggleMuted = useCallback(() => {
    const next = !mutedRef.current;
    setMuted(next);
    return next;
  }, [setMuted]);

  const startCapture = useCallback(async (): Promise<boolean> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMicAvailable(false);
      setMicError(describeMicError(null, {...getBrowserEnv(), secureContext: window.isSecureContext}));
      return false;
    }

    // On iPhone the browser's speech recognition and a second microphone stream compete for the same audio
    // session, and the loser goes silent. Voice input matters more than the waveform and the replay clip, so
    // where speech recognition exists, iOS gets neither. (Verify on a device: see TESTING.md.)
    if (getBrowserEnv().platform === 'ios' && isSpeechRecognitionSupported()) {
      setMicAvailable(true);
      return false;
    }

    // Create (and unlock) the AudioContext now, while we are still inside the tap that started the call:
    // iOS leaves a context created after the permission prompt suspended.
    let ctx: AudioContext | null = null;
    try {
      const AudioCtx =
        window.AudioContext || (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
      if (AudioCtx) {
        ctx = new AudioCtx();
        void ctx.resume().catch(() => {});
      }
    } catch {
      ctx = null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      streamRef.current = stream;
      setMicAvailable(true);
      setMicError(null);
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !mutedRef.current;
      });

      // Set up live RMS audio-level analyser for waveform
      try {
        if (ctx) {
          if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          audioCtxRef.current = ctx;
          analyserRef.current = analyser;
          const buffer = new Uint8Array(analyser.frequencyBinCount);

          const sample = () => {
            if (!analyserRef.current) return;
            if (mutedRef.current) {
              setMicLevel(0);
            } else {
              analyserRef.current.getByteTimeDomainData(buffer);
              let sumSq = 0;
              for (let i = 0; i < buffer.length; i++) {
                const centered = (buffer[i] - 128) / 128;
                sumSq += centered * centered;
              }
              const rms = Math.sqrt(sumSq / buffer.length);
              setMicLevel(Math.min(1, rms * 4.5));
            }
            rafRef.current = window.requestAnimationFrame(sample);
          };
          rafRef.current = window.requestAnimationFrame(sample);
        }
      } catch {
        // Analyser is optional visual enhancement; keep recording working.
      }

      // Set up MediaRecorder for local last-session clip playback. Optional: a browser that can't record
      // still gets a working call, just no replay clip in the debrief.
      if (typeof MediaRecorder !== 'undefined') {
        try {
          chunksRef.current = [];
          // Chrome/Android: webm. iOS Safari: mp4 (webm only from iOS 18.4).
          const preferredType = pickRecorderMimeType(MediaRecorder.isTypeSupported?.bind(MediaRecorder));
          const recorder = preferredType
            ? new MediaRecorder(stream, {mimeType: preferredType})
            : new MediaRecorder(stream);
          recorder.ondataavailable = (ev) => {
            if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
          };
          recorderRef.current = recorder;
          recorder.start(1000);
          setIsRecording(true);
        } catch (err) {
          recorderRef.current = null;
          setIsRecording(false);
          reportClientError('audio', err);
        }
      }

      return true;
    } catch (err) {
      // Release everything: a failed start must not leave the microphone indicator on.
      stopTracks();
      if (ctx && ctx !== audioCtxRef.current) ctx.close().catch(() => {});
      setMicAvailable(false);
      setIsRecording(false);
      setMicError(describeMicError(err, {...getBrowserEnv(), secureContext: window.isSecureContext}));
      if (!(err instanceof DOMException && err.name === 'NotAllowedError')) reportClientError('audio', err);
      return false;
    }
  }, [stopTracks]);

  const stopCapture = useCallback(async (): Promise<Blob | null> => {
    stopAnalyser();
    const recorder = recorderRef.current;
    recorderRef.current = null;

    if (recorder && recorder.state !== 'inactive') {
      const blob = await new Promise<Blob | null>((resolve) => {
        const mimeType = recorder.mimeType || 'audio/webm';
        recorder.onstop = () => {
          const finalBlob = chunksRef.current.length > 0 ? new Blob(chunksRef.current, {type: mimeType}) : null;
          chunksRef.current = [];
          resolve(finalBlob && finalBlob.size > 0 ? finalBlob : null);
        };
        try {
          recorder.stop();
        } catch {
          resolve(null);
        }
      });
      stopTracks();
      setIsRecording(false);
      return blob;
    }

    stopTracks();
    setIsRecording(false);
    return null;
  }, [stopAnalyser, stopTracks]);

  useEffect(() => {
    return () => {
      stopAnalyser();
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch {
          // Ignore unmount stop errors
        }
      }
      stopTracks();
    };
  }, [stopAnalyser, stopTracks]);

  return {
    isMuted,
    isRecording,
    micLevel,
    micAvailable,
    micError,
    startCapture,
    stopCapture,
    setMuted,
    toggleMuted,
  };
}
