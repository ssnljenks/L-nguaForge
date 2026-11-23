import {useCallback, useEffect, useRef, useState} from 'react';

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

export function useSpeechSynthesis() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [supported] = useState(() => typeof window !== 'undefined' && 'speechSynthesis' in window);

  useEffect(() => {
    if (!supported) return;
    const loadVoices = () => {
      const list = window.speechSynthesis.getVoices();
      if (list.length > 0) setVoices(list);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [supported]);

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [supported]);

  const speak = useCallback(
    (
      text: string | undefined | null,
      options: {
        lang: string;
        rate?: number;
        voiceURI?: string;
        onEnd?: () => void;
      }
    ) => {
      const safeText = typeof text === 'string' ? text.trim() : '';
      if (!supported || !safeText) {
        options.onEnd?.();
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(safeText);
      utterance.lang = options.lang;
      utterance.rate = options.rate ?? 1.0;

      const available = window.speechSynthesis.getVoices();
      const chosen =
        (options.voiceURI ? available.find((v) => v.voiceURI === options.voiceURI) : undefined) ??
        available.find((v) => v.lang.toLowerCase() === options.lang.toLowerCase()) ??
        available.find((v) => v.lang.toLowerCase().startsWith(options.lang.slice(0, 2).toLowerCase()));

      if (chosen) utterance.voice = chosen;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => {
        setIsSpeaking(false);
        options.onEnd?.();
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        options.onEnd?.();
      };
      window.speechSynthesis.speak(utterance);
    },
    [supported]
  );

  return {voices, isSpeaking, supported, speak, stop};
}

export function useSpeechRecognition() {
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [supported] = useState(() => Boolean(getSpeechRecognitionCtor()));
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const onFinalCallbackRef = useRef<((text: string) => void) | null>(null);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore already-stopped errors
      }
    }
    setIsListening(false);
  }, []);

  const resetTranscript = useCallback(() => {
    setFinalTranscript('');
    setInterimTranscript('');
    setError(null);
  }, []);

  const startListening = useCallback(
    (options: {lang: string; continuous?: boolean; onFinalSegment?: (segment: string) => void}) => {
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) {
        setError('Web Speech Recognition is unavailable in this browser. Type your response below.');
        return false;
      }

      stopListening();
      setError(null);
      setInterimTranscript('');
      onFinalCallbackRef.current = options.onFinalSegment ?? null;

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
          setInterimTranscript(interim);
          if (finalAddition.trim()) {
            const cleanSegment = finalAddition.trim();
            setFinalTranscript((prev) => (prev ? `${prev} ${cleanSegment}` : cleanSegment));
            onFinalCallbackRef.current?.(cleanSegment);
          }
        };

        recognition.onerror = (event) => {
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            setError('Microphone permission denied. Allow microphone access or use keyboard input.');
          } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
            setError(`Speech recognition notice: ${event.error}`);
          }
          setIsListening(false);
        };

        recognition.onend = () => {
          setIsListening(false);
          setInterimTranscript('');
        };

        recognitionRef.current = recognition;
        recognition.start();
        setIsListening(true);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unable to start speech recognition.');
        setIsListening(false);
        return false;
      }
    },
    [stopListening]
  );

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore cleanup errors
        }
      }
    };
  }, []);

  return {
    isListening,
    interimTranscript,
    finalTranscript,
    setFinalTranscript,
    error,
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
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {type: recorder.mimeType || 'audio/webm'});
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      return true;
    } catch {
      setRecorderError('Microphone unavailable for audio playback capture (text & speech recognition still work).');
      setIsRecording(false);
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
