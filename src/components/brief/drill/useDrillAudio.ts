import {useCallback, useEffect, useRef, useState} from 'react';

/**
 * Listening audio for a DLPT drill: the single-play broadcast and the Practice-mode replay with
 * transcript. State is keyed by passage id so "played once" survives moving between passages.
 */
export function useDrillAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const replayAudioRef = useRef<HTMLAudioElement | null>(null);
  const [playedOnce, setPlayedOnce] = useState<Record<string, boolean>>({});
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, boolean>>({});
  const [transcriptOpenById, setTranscriptOpenById] = useState<Record<string, boolean>>({});
  const [replayPlayingId, setReplayPlayingId] = useState<string | null>(null);

  // Stop audio cleanly on unmount.
  useEffect(
    () => () => {
      audioRef.current?.pause();
      replayAudioRef.current?.pause();
    },
    []
  );

  /** Pauses both players (main and replay). */
  const pauseAll = useCallback(() => {
    audioRef.current?.pause();
    replayAudioRef.current?.pause();
    setPlayingId(null);
    setReplayPlayingId(null);
  }, []);

  /** Pauses only the single-play broadcast. */
  const pauseMain = useCallback(() => {
    audioRef.current?.pause();
    setPlayingId(null);
  }, []);

  const playOnce = (id: string) => {
    if (playedOnce[id] || playingId === id) return;
    if (!audioRef.current) return;
    setErrorById((prev) => ({...prev, [id]: false}));
    setPlayingId(id);
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {
      setPlayingId(null);
      setErrorById((prev) => ({...prev, [id]: true}));
    });
  };

  const replayWithTranscript = (id: string) => {
    setTranscriptOpenById((prev) => ({...prev, [id]: true}));
    if (replayAudioRef.current) {
      replayAudioRef.current.currentTime = 0;
      setReplayPlayingId(id);
      replayAudioRef.current.play().catch(() => {
        setReplayPlayingId(null);
      });
    }
  };

  const reset = () => {
    audioRef.current?.pause();
    replayAudioRef.current?.pause();
    setPlayedOnce({});
    setPlayingId(null);
    setErrorById({});
    setTranscriptOpenById({});
    setReplayPlayingId(null);
  };

  return {
    audioRef,
    replayAudioRef,
    playedOnce,
    playingId,
    errorById,
    transcriptOpenById,
    replayPlayingId,
    pauseAll,
    pauseMain,
    playOnce,
    replayWithTranscript,
    reset,
    onMainPlay: (id: string) => setPlayingId(id),
    onMainEnded: (id: string) => {
      setPlayingId(null);
      setPlayedOnce((prev) => ({...prev, [id]: true}));
    },
    onMainError: (id: string) => {
      setPlayingId(null);
      setErrorById((prev) => ({...prev, [id]: true}));
    },
    onReplayStopped: () => setReplayPlayingId(null),
  };
}

export type DrillAudio = ReturnType<typeof useDrillAudio>;
