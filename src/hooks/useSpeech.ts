import {useCallback, useEffect, useRef, useState} from 'react';
import {
  describeMicError,
  describeSpeechRecognitionError,
  getBrowserEnv,
  pickRecorderMimeType,
} from '../audio/capabilities';
import {reportClientError, reportClientEvent} from '../services/errorReporter';

interface BrowserSpeechRecognitionEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [altIndex: number]: {transcript: string};
    };
  };
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: {error: string}) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => BrowserSpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// iOS Safari only lets speechSynthesis speak after a speak() made during a tap. The examiner's lines arrive
// after a network request, outside any tap, so the first tap anywhere "unlocks" speech with a silent utterance.
let speechUnlockInstalled = false;
function installSpeechUnlock(): void {
  if (speechUnlockInstalled || typeof document === 'undefined' || !('speechSynthesis' in window)) return;
  speechUnlockInstalled = true;
  const events = ['touchend', 'click', 'keydown'] as const;
  const unlock = () => {
    for (const name of events) document.removeEventListener(name, unlock, true);
    try {
      const silent = new SpeechSynthesisUtterance('');
      silent.volume = 0;
      window.speechSynthesis.speak(silent);
    } catch {
      // Speech is optional; the tap-to-hear fallback covers a browser that refuses.
    }
  };
  for (const name of events) document.addEventListener(name, unlock, {capture: true});
}

/** How long to wait for an utterance to begin before deciding the browser blocked it. */
const SPEECH_START_TIMEOUT_MS = 3000;
/** Upper bound for one utterance: some browsers never fire `end`, which would stall a call waiting on it. */
export function estimateSpeechTimeoutMs(text: string, rate: number): number {
  const charsPerSecond = 12 * Math.max(0.5, rate);
  return Math.max(8000, Math.round((text.length / charsPerSecond) * 1000) + 4000);
}

interface SpeakOptions {
  lang: string;
  rate?: number;
  voiceURI?: string;
  onEnd?: () => void;
}

/** Whether this browser has speech recognition at all (it may still fail at runtime). */
export function isSpeechRecognitionSupported(): boolean {
  return Boolean(getSpeechRecognitionCtor());
}

export function useSpeechSynthesis() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [supported] = useState(() => typeof window !== 'undefined' && 'speechSynthesis' in window);
  // Set when the browser refused to speak (autoplay policy, silent failure): the UI offers "tap to hear".
  const [blockedText, setBlockedText] = useState<string | null>(null);
  const blockedOptionsRef = useRef<SpeakOptions | null>(null);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    if (!supported) return;
    installSpeechUnlock();
    const loadVoices = () => {
      const list = window.speechSynthesis.getVoices();
      if (list.length > 0) setVoices(list);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    const timers = timersRef.current;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      // Stop speech when the owning module unmounts (tab or language switch).
      window.speechSynthesis.cancel();
    };
  }, [supported]);

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [supported]);

  const speak = useCallback(
    (text: string | undefined | null, options: SpeakOptions) => {
      const safeText = typeof text === 'string' ? text.trim() : '';
      if (!supported || !safeText) {
        options.onEnd?.();
        return;
      }
      window.speechSynthesis.cancel();
      setBlockedText(null);
      const utterance = new SpeechSynthesisUtterance(safeText);
      utterance.lang = options.lang;
      utterance.rate = options.rate ?? 1.0;

      const available = window.speechSynthesis.getVoices();
      const chosen =
        (options.voiceURI ? available.find((v) => v.voiceURI === options.voiceURI) : undefined) ??
        available.find((v) => v.lang.toLowerCase() === options.lang.toLowerCase()) ??
        available.find((v) => v.lang.toLowerCase().startsWith(options.lang.slice(0, 2).toLowerCase()));

      if (chosen) utterance.voice = chosen;

      let started = false;
      let finished = false;
      const pending = new Set<ReturnType<typeof setTimeout>>();
      const later = (fn: () => void, ms: number) => {
        const t = setTimeout(fn, ms);
        pending.add(t);
        timersRef.current.add(t);
      };
      const finish = () => {
        if (finished) return;
        finished = true;
        for (const t of pending) {
          clearTimeout(t);
          timersRef.current.delete(t);
        }
        setIsSpeaking(false);
        options.onEnd?.();
      };
      const markBlocked = () => {
        // The call flow must not wait on audio that will never play: carry on (finish) and offer tap-to-hear.
        blockedOptionsRef.current = {...options, onEnd: undefined};
        setBlockedText(safeText);
        reportClientEvent('audio', 'speech synthesis blocked or silent');
      };

      utterance.onstart = () => {
        started = true;
        setIsSpeaking(true);
        // Some browsers never fire `end`; stop waiting after a generous estimate of the utterance length.
        later(
          () => {
            window.speechSynthesis.cancel();
            finish();
          },
          estimateSpeechTimeoutMs(safeText, utterance.rate)
        );
      };
      utterance.onend = finish;
      utterance.onerror = (event) => {
        const code = (event as SpeechSynthesisErrorEvent).error;
        if (code === 'not-allowed') markBlocked();
        finish();
      };
      later(() => {
        if (started || window.speechSynthesis.speaking) return;
        window.speechSynthesis.cancel();
        markBlocked();
        finish();
      }, SPEECH_START_TIMEOUT_MS);
      window.speechSynthesis.speak(utterance);
    },
    [supported]
  );

  /** Speaks the line the browser blocked. Call it from a tap handler. */
  const playBlocked = useCallback(() => {
    const text = blockedText;
    const options = blockedOptionsRef.current;
    if (!text || !options) return;
    setBlockedText(null);
    speak(text, options);
  }, [blockedText, speak]);

  return {voices, isSpeaking, supported, blocked: blockedText !== null, speak, stop, playBlocked};
}

/** Fatal for voice input: retrying won't help, so the UI should move typing to the front. */
const FATAL_RECOGNITION_ERRORS = new Set([
  'not-allowed',
  'service-not-allowed',
  'audio-capture',
  'language-not-supported',
]);

export function useSpeechRecognition() {
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  // True after a failure that retrying won't fix (permission, service off, no mic).
  const [failed, setFailed] = useState(false);
  const [supported] = useState(() => Boolean(getSpeechRecognitionCtor()));
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const onFinalCallbackRef = useRef<((text: string) => void) | null>(null);
  // Recognition ends by itself after a pause (Android Chrome after a few seconds, iOS after each phrase).
  // While the caller still wants it, a new session is started so the learner isn't left talking to nothing.
  const wantListeningRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rapidEndsRef = useRef(0);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    wantListeningRef.current = false;
    clearRestartTimer();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore already-stopped errors
      }
    }
    setIsListening(false);
  }, [clearRestartTimer]);

  const resetTranscript = useCallback(() => {
    setFinalTranscript('');
    setInterimTranscript('');
    setError(null);
  }, []);

  const startListening = useCallback(
    (options: {lang: string; continuous?: boolean; onFinalSegment?: (segment: string) => void}) => {
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) {
        setError(
          'Voice input is not available in this browser. Type your response below' +
            (getBrowserEnv().platform === 'ios' ? ', or use the microphone key on your keyboard.' : '.')
        );
        return false;
      }

      stopListening();
      clearRestartTimer();
      setError(null);
      setInterimTranscript('');
      onFinalCallbackRef.current = options.onFinalSegment ?? null;
      wantListeningRef.current = true;
      rapidEndsRef.current = 0;

      const begin = (): boolean => {
        const startedAt = Date.now();
        try {
          const recognition = new Ctor();
          recognition.lang = options.lang;
          recognition.continuous = Boolean(options.continuous);
          recognition.interimResults = true;

          recognition.onresult = (event) => {
            let interim = '';
            let finalAddition = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const res = event.results[i];
              if (res.isFinal) {
                finalAddition += res[0].transcript + ' ';
              } else {
                interim += res[0].transcript;
              }
            }
            setFailed(false);
            setInterimTranscript(interim);
            if (finalAddition.trim()) {
              const cleanSegment = finalAddition.trim();
              setFinalTranscript((prev) => (prev ? `${prev} ${cleanSegment}` : cleanSegment));
              onFinalCallbackRef.current?.(cleanSegment);
            }
          };

          recognition.onerror = (event) => {
            const message = describeSpeechRecognitionError(event.error, getBrowserEnv());
            if (message) {
              setError(message);
              reportClientEvent('speech', `recognition error: ${event.error}`);
            }
            if (FATAL_RECOGNITION_ERRORS.has(event.error)) {
              wantListeningRef.current = false;
              setFailed(true);
            }
            setIsListening(false);
          };

          recognition.onend = () => {
            setInterimTranscript('');
            if (recognitionRef.current !== recognition) return;
            // Ending immediately, over and over, means it can't run here: stop instead of spinning.
            rapidEndsRef.current = Date.now() - startedAt < 800 ? rapidEndsRef.current + 1 : 0;
            if (wantListeningRef.current && options.continuous && rapidEndsRef.current < 3) {
              restartTimerRef.current = setTimeout(() => {
                restartTimerRef.current = null;
                if (wantListeningRef.current && !begin()) setIsListening(false);
              }, 250);
              return;
            }
            if (wantListeningRef.current && options.continuous) {
              wantListeningRef.current = false;
              setFailed(true);
              setError('Voice input keeps stopping on this device. Type your answer instead.');
              reportClientEvent('speech', 'recognition restarted too fast and was stopped');
            }
            setIsListening(false);
          };

          recognitionRef.current = recognition;
          recognition.start();
          setIsListening(true);
          return true;
        } catch (e) {
          wantListeningRef.current = false;
          setError(e instanceof Error ? e.message : 'Unable to start voice input. Type your response instead.');
          setIsListening(false);
          reportClientError('speech', e);
          return false;
        }
      };
      return begin();
    },
    [clearRestartTimer, stopListening]
  );

  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      clearRestartTimer();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore cleanup errors
        }
      }
    };
  }, [clearRestartTimer]);

  return {
    isListening,
    interimTranscript,
    finalTranscript,
    setFinalTranscript,
    error,
    failed,
    supported,
    startListening,
    stopListening,
    resetTranscript,
  };
}

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recorderError, setRecorderError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const clearAudio = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setRecorderError(null);
  }, [audioUrl]);

  const startRecording = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setRecorderError('Audio recording is not supported in this browser.');
      return false;
    }
    try {
      setRecorderError(null);
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
        setAudioUrl(null);
      }
      if (typeof MediaRecorder === 'undefined') {
        setRecorderError('Audio recording is not supported in this browser. Speech-to-text and typing still work.');
        return false;
      }
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      streamRef.current = stream;
      chunksRef.current = [];
      // iOS Safari records audio/mp4, Chrome and Firefox webm: ask for what this browser can actually record.
      const mimeType = pickRecorderMimeType(MediaRecorder.isTypeSupported?.bind(MediaRecorder));
      const recorder = mimeType ? new MediaRecorder(stream, {mimeType}) : new MediaRecorder(stream);
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {type: recorder.mimeType || mimeType || 'audio/mp4'});
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      return true;
    } catch (err) {
      // Don't leave the microphone open (and the browser's recording indicator on) after a failed start.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setRecorderError(describeMicError(err, getBrowserEnv()));
      setIsRecording(false);
      reportClientError('audio', err);
      return false;
    }
  }, [audioUrl]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return {isRecording, audioUrl, recorderError, startRecording, stopRecording, clearAudio};
}
