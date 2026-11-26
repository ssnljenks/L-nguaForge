import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {
  ChatRegisterMode,
  GeminiLiveVoice,
  MilitaryDomain,
  TalkCorrectionMode,
  TalkPickedUpItem,
  TargetLanguage,
} from '../types';
import {base64PcmToFloat32, computeRmsLevel, mergeTranscriptChunk, pcm16BytesToFloat32} from '../utils/liveAudio';
import {type MicCapture, startMicCapture} from '../audio/micCapture';

export type {GeminiLiveVoice};

export type GeminiLiveStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error';

export interface LiveSessionStartOptions {
  language: TargetLanguage;
  dialect: string;
  domain?: MilitaryDomain;
  registerMode?: ChatRegisterMode;
  voiceName: GeminiLiveVoice;
  tutorId?: string;
  sceneId?: string;
  workTalk?: boolean;
  slangLevel?: number;
  correctionMode?: TalkCorrectionMode;
}

export interface TalkNotePayload {
  recastNote?: string;
  pickedUp: TalkPickedUpItem[];
}

export interface UseGeminiLiveCallbacks {
  onTurnComplete?: (role: 'user' | 'assistant', text: string) => void;
  onTalkNote?: (note: TalkNotePayload) => void;
}

function createResilientAudioContext(AudioCtxCtor: typeof AudioContext, preferredSampleRate: number): AudioContext {
  try {
    return new AudioCtxCtor({sampleRate: preferredSampleRate});
  } catch {
    return new AudioCtxCtor();
  }
}

export function useGeminiLive(callbacks?: UseGeminiLiveCallbacks) {
  const [status, setStatus] = useState<GeminiLiveStatus>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [aiLevel, setAiLevel] = useState(0);
  const [liveUserTranscript, setLiveUserTranscript] = useState('');
  const [livePartnerTranscript, setLivePartnerTranscript] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const captureRef = useRef<MicCapture | null>(null);

  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const statusRef = useRef<GeminiLiveStatus>('idle');
  const isMutedRef = useRef(false);
  const isReadyRef = useRef(false);
  const userEndedRef = useRef(false);
  const lastMicEmitAtRef = useRef(0);
  const lastAiEmitAtRef = useRef(0);

  const userDraftRef = useRef('');
  const partnerDraftRef = useRef('');
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const updateStatus = useCallback((next: GeminiLiveStatus | ((prev: GeminiLiveStatus) => GeminiLiveStatus)) => {
    setStatus((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      statusRef.current = resolved;
      return resolved;
    });
  }, []);

  const stopQueuedPlayback = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        // Already stopped
      }
      try {
        src.disconnect();
      } catch {
        // Already disconnected
      }
    }
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setAiLevel(0);
  }, []);

  const flushUserDraft = useCallback(() => {
    const text = userDraftRef.current.trim();
    if (text) {
      userDraftRef.current = '';
      setLiveUserTranscript('');
      callbacksRef.current?.onTurnComplete?.('user', text);
    }
  }, []);

  const flushPartnerDraft = useCallback(() => {
    const text = partnerDraftRef.current.trim();
    if (text) {
      partnerDraftRef.current = '';
      setLivePartnerTranscript('');
      callbacksRef.current?.onTurnComplete?.('assistant', text);
    }
  }, []);

  const cleanupResources = useCallback(() => {
    isReadyRef.current = false;
    stopQueuedPlayback();

    captureRef.current?.stop();
    captureRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      streamRef.current = null;
    }

    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.onstatechange = null;
      inputAudioCtxRef.current.close().catch(() => {});
      inputAudioCtxRef.current = null;
    }

    if (outputAudioCtxRef.current) {
      outputAudioCtxRef.current.onstatechange = null;
      outputAudioCtxRef.current.close().catch(() => {});
      outputAudioCtxRef.current = null;
    }

    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({type: 'stop'}));
        } catch {
          // Ignore send errors on teardown
        }
      }
      try {
        ws.close();
      } catch {
        // Ignore
      }
    }

    setMicLevel(0);
    setAiLevel(0);
  }, [stopQueuedPlayback]);

  /** Queues a chunk of 24 kHz model audio for gapless playback. */
  const scheduleAudioChunk = useCallback(
    (floats: Float32Array) => {
      const ctx = outputAudioCtxRef.current;
      if (!ctx || ctx.state === 'closed') return;

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      if (floats.length === 0) return;

      const nowMs = performance.now();
      if (nowMs - lastAiEmitAtRef.current >= 90) {
        lastAiEmitAtRef.current = nowMs;
        setAiLevel(computeRmsLevel(floats));
      }
      if (statusRef.current !== 'speaking') {
        updateStatus('speaking');
      }

      try {
        const audioBuffer = ctx.createBuffer(1, floats.length, 24000);
        audioBuffer.getChannelData(0).set(floats);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        const now = ctx.currentTime;
        const startAt = Math.max(now + 0.015, nextStartTimeRef.current);
        nextStartTimeRef.current = startAt + audioBuffer.duration;

        activeSourcesRef.current.add(source);
        source.onended = () => {
          activeSourcesRef.current.delete(source);
          if (activeSourcesRef.current.size === 0) {
            setAiLevel(0);
            updateStatus((prev) => (prev === 'speaking' ? 'listening' : prev));
          }
        };
        source.start(startAt);
      } catch {
        // Guard against transient closed/interrupted AudioContext states on mobile browsers
      }
    },
    [updateStatus]
  );

  const endSession = useCallback(() => {
    userEndedRef.current = true;
    flushUserDraft();
    flushPartnerDraft();
    cleanupResources();
    setIsMuted(false);
    isMutedRef.current = false;
    updateStatus('idle');
    setError(null);
  }, [cleanupResources, flushPartnerDraft, flushUserDraft, updateStatus]);

  const startSession = useCallback(
    async (options: LiveSessionStartOptions) => {
      userEndedRef.current = true;
      cleanupResources();
      userEndedRef.current = false;
      setError(null);
      setIsMuted(false);
      isMutedRef.current = false;
      userDraftRef.current = '';
      partnerDraftRef.current = '';
      setLiveUserTranscript('');
      setLivePartnerTranscript('');
      updateStatus('connecting');

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setError('Microphone access is not available in this browser.');
        updateStatus('error');
        return;
      }

      try {
        // 1. Capture microphone with echo cancellation so speaker output doesn't barge-in falsely
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        streamRef.current = stream;

        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.onended = () => {
            if (!userEndedRef.current) {
              flushUserDraft();
              flushPartnerDraft();
              cleanupResources();
              setError('Microphone input stopped unexpectedly. Tap Start Live Voice to resume.');
              updateStatus('error');
            }
          };
        }

        // 2. Initialize separate 16kHz input and 24kHz output AudioContexts (with safe hardware fallback)
        const AudioCtxCtor =
          window.AudioContext || (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
        const inputCtx = createResilientAudioContext(AudioCtxCtor, 16000);
        const outputCtx = createResilientAudioContext(AudioCtxCtor, 24000);
        inputAudioCtxRef.current = inputCtx;
        outputAudioCtxRef.current = outputCtx;

        const keepAwake = (ctx: AudioContext) => {
          ctx.onstatechange = () => {
            if (!userEndedRef.current && ctx.state === 'suspended') {
              ctx.resume().catch(() => {});
            }
          };
        };
        keepAwake(inputCtx);
        keepAwake(outputCtx);

        if (inputCtx.state === 'suspended') await inputCtx.resume();
        if (outputCtx.state === 'suspended') await outputCtx.resume();

        // 3. Open WebSocket to our server-side Gemini Live bridge
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live`);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              type: 'start',
              language: options.language,
              dialect: options.dialect,
              ...(options.domain ? {domain: options.domain} : {}),
              ...(options.registerMode ? {registerMode: options.registerMode} : {}),
              voiceName: options.voiceName,
              ...(options.tutorId ? {tutorId: options.tutorId} : {}),
              ...(options.sceneId ? {sceneId: options.sceneId} : {}),
              ...(typeof options.workTalk === 'boolean' ? {workTalk: options.workTalk} : {}),
              ...(typeof options.slangLevel === 'number' ? {slangLevel: options.slangLevel} : {}),
              ...(options.correctionMode ? {correctionMode: options.correctionMode} : {}),
              // Ask the server for raw binary PCM frames instead of base64-in-JSON (~33% smaller).
              binaryAudio: true,
            })
          );
        };

        ws.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            // Binary frame: model audio as 24 kHz Int16 PCM.
            flushUserDraft();
            scheduleAudioChunk(pcm16BytesToFloat32(new Uint8Array(event.data)));
            return;
          }

          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(String(event.data));
          } catch {
            return;
          }

          if (payload.type === 'ready') {
            isReadyRef.current = true;
            updateStatus('listening');
            return;
          }

          if (payload.type === 'audio' && typeof payload.data === 'string') {
            // Legacy JSON/base64 audio (servers without binary support).
            flushUserDraft();
            scheduleAudioChunk(base64PcmToFloat32(payload.data));
            return;
          }

          if (payload.type === 'input_transcript' && typeof payload.text === 'string') {
            userDraftRef.current = mergeTranscriptChunk(userDraftRef.current, payload.text);
            setLiveUserTranscript(userDraftRef.current);
            return;
          }

          if (payload.type === 'output_transcript' && typeof payload.text === 'string') {
            flushUserDraft();
            partnerDraftRef.current = mergeTranscriptChunk(partnerDraftRef.current, payload.text);
            setLivePartnerTranscript(partnerDraftRef.current);
            return;
          }

          if (payload.type === 'interrupted') {
            stopQueuedPlayback();
            flushPartnerDraft();
            updateStatus('listening');
            return;
          }

          if (payload.type === 'turn_complete') {
            flushUserDraft();
            flushPartnerDraft();
            if (activeSourcesRef.current.size === 0) {
              updateStatus('listening');
            }
            return;
          }

          if (payload.type === 'talk_note') {
            const recastNote = typeof payload.recastNote === 'string' ? payload.recastNote.trim() : '';
            const pickedUp = Array.isArray(payload.pickedUp) ? (payload.pickedUp as TalkPickedUpItem[]) : [];
            if (recastNote || pickedUp.length > 0) {
              callbacksRef.current?.onTalkNote?.({
                ...(recastNote ? {recastNote} : {}),
                pickedUp,
              });
            }
            return;
          }

          if (payload.type === 'error' && typeof payload.error === 'string') {
            userEndedRef.current = true;
            flushUserDraft();
            flushPartnerDraft();
            setError(payload.error);
            cleanupResources();
            updateStatus('error');
            return;
          }

          if (payload.type === 'closed') {
            const wasUserEnded = userEndedRef.current;
            const reason = typeof payload.reason === 'string' && payload.reason.trim() ? payload.reason.trim() : '';
            flushUserDraft();
            flushPartnerDraft();
            cleanupResources();
            if (!wasUserEnded && statusRef.current !== 'error') {
              setError(
                reason
                  ? `Live voice session ended (${reason}). Tap Start Live Voice to continue.`
                  : 'Live voice session closed by the server. Tap Start Live Voice to continue.'
              );
              updateStatus('error');
            } else {
              updateStatus((prev) => (prev === 'error' ? 'error' : 'idle'));
            }
          }
        };

        ws.onerror = () => {
          userEndedRef.current = true;
          flushUserDraft();
          flushPartnerDraft();
          setError('Live voice connection interrupted. Tap Start Live Voice to reconnect.');
          cleanupResources();
          updateStatus('error');
        };

        ws.onclose = (closeEvent) => {
          const wasUserEnded = userEndedRef.current;
          flushUserDraft();
          flushPartnerDraft();
          cleanupResources();
          if (!wasUserEnded && statusRef.current !== 'error') {
            const suffix = closeEvent.code && closeEvent.code !== 1000 ? ` (code ${closeEvent.code})` : '';
            setError(`Live voice connection dropped${suffix}. Tap Start Live Voice to reconnect.`);
            updateStatus('error');
          } else {
            updateStatus((prev) => (prev === 'error' ? 'error' : 'idle'));
          }
        };

        // 4. Stream mic audio as binary 16 kHz Int16 PCM frames (AudioWorklet, off the main thread)
        const source = inputCtx.createMediaStreamSource(stream);
        const capture = await startMicCapture(inputCtx, source, (pcm, rms) => {
          if (isMutedRef.current) return;
          const nowMs = performance.now();
          if (nowMs - lastMicEmitAtRef.current >= 100) {
            lastMicEmitAtRef.current = nowMs;
            setMicLevel(rms);
          }
          if (!isReadyRef.current || pcm.length === 0) return;
          const activeWs = wsRef.current;
          if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return;
          // Drop audio rather than queue it if the network can't keep up (keeps latency bounded).
          if (activeWs.bufferedAmount > 256 * 1024) return;
          activeWs.send(pcm as Int16Array<ArrayBuffer>);
        });
        // The session may have been ended while the worklet module was loading.
        if (inputAudioCtxRef.current !== inputCtx) {
          capture.stop();
          return;
        }
        captureRef.current = capture;
      } catch (err) {
        userEndedRef.current = true;
        cleanupResources();
        const message =
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Microphone permission was blocked. Allow mic access in your browser to use Live Voice.'
            : err instanceof Error
              ? err.message
              : 'Unable to start live voice session.';
        setError(message);
        updateStatus('error');
      }
    },
    [cleanupResources, flushPartnerDraft, flushUserDraft, scheduleAudioChunk, stopQueuedPlayback, updateStatus]
  );

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      if (next) setMicLevel(0);
      return next;
    });
  }, []);

  const sendLiveText = useCallback(
    (text: string): boolean => {
      const clean = text.trim();
      const activeWs = wsRef.current;
      if (!clean || !isReadyRef.current || !activeWs || activeWs.readyState !== WebSocket.OPEN) {
        return false;
      }
      stopQueuedPlayback();
      flushPartnerDraft();
      activeWs.send(JSON.stringify({type: 'text', text: clean}));
      callbacksRef.current?.onTurnComplete?.('user', clean);
      return true;
    },
    [flushPartnerDraft, stopQueuedPlayback]
  );

  useEffect(() => {
    return () => {
      userEndedRef.current = true;
      cleanupResources();
    };
  }, [cleanupResources]);

  const isLive = status === 'connecting' || status === 'listening' || status === 'speaking';

  return useMemo(
    () => ({
      status,
      isLive,
      isMuted,
      error,
      micLevel,
      aiLevel,
      liveUserTranscript,
      livePartnerTranscript,
      startSession,
      endSession,
      toggleMute,
      sendLiveText,
    }),
    [
      aiLevel,
      endSession,
      error,
      isLive,
      isMuted,
      livePartnerTranscript,
      liveUserTranscript,
      micLevel,
      sendLiveText,
      startSession,
      status,
      toggleMute,
    ]
  );
}
