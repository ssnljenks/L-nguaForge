import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {GeminiLiveVoice, MilitaryDomain, TalkCorrectionMode, TalkPickedUpItem, TargetLanguage} from '../types';
import {base64PcmToFloat32, computeRmsLevel, mergeTranscriptChunk, pcm16BytesToFloat32} from '../utils/liveAudio';
import {describeMicError, getBrowserEnv} from '../audio/capabilities';
import {type MicCapture, startMicCapture} from '../audio/micCapture';
import {reportClientError, reportClientEvent} from '../services/errorReporter';

export type {GeminiLiveVoice};

export type GeminiLiveStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error';

export interface LiveSessionStartOptions {
  language: TargetLanguage;
  dialect: string;
  domain?: MilitaryDomain;
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

/** How long to wait for the server's `ready` before giving up on a connection that never completes. */
export const LIVE_CONNECT_TIMEOUT_MS = 15_000;

/** After the app returns to the foreground, how long to wait for the microphone to come back before ending. */
const RESUME_GRACE_MS = 2_000;

/**
 * iOS silences Web Audio when the ring/silent switch is on unless the page declares a playback session.
 * `play-and-record` keeps the call audible (and routes it like a call). No-op where the API doesn't exist.
 */
function declareCallAudioSession(): void {
  try {
    const session = (navigator as unknown as {audioSession?: {type: string}}).audioSession;
    if (session) session.type = 'play-and-record';
  } catch {
    // Not supported: nothing to do
  }
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
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }

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
        // 1. Create and unlock both AudioContexts first, while we are still inside the tap that started the
        //    call: iOS leaves a context created after the permission prompt suspended, and Chrome Android
        //    applies the same autoplay rule. Separate 16 kHz input and 24 kHz output contexts, with a safe
        //    fallback to the hardware rate.
        declareCallAudioSession();
        const AudioCtxCtor =
          window.AudioContext || (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
        const inputCtx = createResilientAudioContext(AudioCtxCtor, 16000);
        const outputCtx = createResilientAudioContext(AudioCtxCtor, 24000);
        inputAudioCtxRef.current = inputCtx;
        outputAudioCtxRef.current = outputCtx;
        const unlocking = Promise.all([inputCtx.resume(), outputCtx.resume()]).catch(() => {});

        // 2. Capture microphone with echo cancellation so speaker output doesn't barge-in falsely
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
              setError(
                'Microphone input stopped unexpectedly. Your conversation so far is saved. Tap Start Live Voice to resume.'
              );
              updateStatus('error');
              reportClientEvent('live', 'microphone track ended unexpectedly');
            }
          };
        }

        const keepAwake = (ctx: AudioContext) => {
          ctx.onstatechange = () => {
            // iOS reports 'interrupted' (a call, Siri, an alarm) as well as 'suspended'.
            const state = ctx.state as AudioContextState | 'interrupted';
            if (!userEndedRef.current && (state === 'suspended' || state === 'interrupted')) {
              ctx.resume().catch(() => {});
            }
          };
        };
        keepAwake(inputCtx);
        keepAwake(outputCtx);

        await unlocking;
        if (inputCtx.state === 'suspended') await inputCtx.resume();
        if (outputCtx.state === 'suspended') await outputCtx.resume();

        // 3. Open WebSocket to our server-side Gemini Live bridge
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live`);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;
        // A connection that never completes (captive Wi-Fi, a dead tunnel) would sit on "Connecting…" forever.
        connectTimerRef.current = setTimeout(() => {
          connectTimerRef.current = null;
          if (isReadyRef.current || userEndedRef.current) return;
          userEndedRef.current = true;
          flushUserDraft();
          flushPartnerDraft();
          cleanupResources();
          setError(
            "Couldn't connect to live voice. Check your connection and tap Start Live Voice to try again, or use the text box."
          );
          updateStatus('error');
          reportClientEvent('live', 'connect timeout');
        }, LIVE_CONNECT_TIMEOUT_MS);

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              type: 'start',
              language: options.language,
              dialect: options.dialect,
              ...(options.domain ? {domain: options.domain} : {}),
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
            if (connectTimerRef.current) {
              clearTimeout(connectTimerRef.current);
              connectTimerRef.current = null;
            }
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

          if (payload.type === 'text_rejected' && typeof payload.error === 'string') {
            // Typed text blocked by the server's classification guard; the call keeps running.
            setError(payload.error);
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
          setError(
            'Live voice connection interrupted. Your conversation so far is saved. Tap Start Live Voice to reconnect.'
          );
          cleanupResources();
          updateStatus('error');
          reportClientEvent('live', 'websocket error');
        };

        ws.onclose = (closeEvent) => {
          const wasUserEnded = userEndedRef.current;
          flushUserDraft();
          flushPartnerDraft();
          cleanupResources();
          if (!wasUserEnded && statusRef.current !== 'error') {
            const suffix = closeEvent.code && closeEvent.code !== 1000 ? ` (code ${closeEvent.code})` : '';
            setError(
              `Live voice connection dropped${suffix}. Your conversation so far is saved. Tap Start Live Voice to reconnect.`
            );
            updateStatus('error');
            reportClientEvent('live', `websocket closed unexpectedly (${closeEvent.code || 'no code'})`);
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
        setError(describeMicError(err, {...getBrowserEnv(), secureContext: window.isSecureContext}));
        updateStatus('error');
        if (!(err instanceof DOMException && err.name === 'NotAllowedError')) reportClientError('live', err);
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

  // Network loss and the phone being locked or backgrounded don't always close the socket promptly, so the
  // call can look alive while nothing is flowing. Detect both and say so, instead of leaving a dead call.
  useEffect(() => {
    if (!isLive) return;
    const endWith = (message: string, reason: string) => {
      if (userEndedRef.current) return;
      userEndedRef.current = true;
      flushUserDraft();
      flushPartnerDraft();
      cleanupResources();
      setError(message);
      updateStatus('error');
      reportClientEvent('live', reason);
    };
    const onOffline = () =>
      endWith(
        "You went offline, so live voice stopped. Your conversation so far is saved. Tap Start Live Voice when you're back online, or use the text box.",
        'went offline during live call'
      );
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      for (const ctx of [inputAudioCtxRef.current, outputAudioCtxRef.current]) {
        if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {});
      }
      // A locked or backgrounded phone usually pauses or ends the microphone; give it a moment to come back.
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = setTimeout(() => {
        resumeTimerRef.current = null;
        const track = streamRef.current?.getAudioTracks()[0];
        const socketOpen = wsRef.current?.readyState === WebSocket.OPEN;
        if (!socketOpen || !track || track.readyState === 'ended' || track.muted) {
          endWith(
            'Live voice paused while the app was in the background. Your conversation so far is saved. Tap Start Live Voice to continue.',
            'live call paused by background or screen lock'
          );
        }
      }, RESUME_GRACE_MS);
    };
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isLive, cleanupResources, flushPartnerDraft, flushUserDraft, updateStatus]);

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
