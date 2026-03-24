import { useRef, useState, useCallback } from "react";
import { AudioPlayer } from "../lib/audio-player";

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export { formatTime };

export interface PlaybackState {
  isPlaying: boolean;
  hasAudio: boolean;
  audioDuration: number;
  audioBuffer: AudioBuffer | null;
  currentTime: number;
}

export interface PlaybackActions {
  start: () => void;
  toggle: () => void;
  scrub: (t: number) => void;
  loadUrl: (url: string) => Promise<void>;
  loadFile: (file: File) => Promise<void>;
  getFFT: () => { bass: number; mid: number; high: number };
  /** Read current time at frame precision (no React lag) */
  getCurrentTime: () => number;
  /** Returns true if audio is actively playing through speakers */
  isAudioPlaying: () => boolean;
  /** Called every frame to update DOM time display and throttled React state */
  updateTime: () => void;
}

export interface PlaybackRefs {
  timeDisplayRef: React.RefObject<HTMLSpanElement | null>;
  scrubRef: React.RefObject<HTMLInputElement | null>;
}

export function usePlayback(): [PlaybackState, PlaybackActions, PlaybackRefs] {
  const audioRef = useRef<AudioPlayer | null>(null);
  const isPlayingRef = useRef(false);
  const playStartRef = useRef(0);
  const pauseOffsetRef = useRef(0);
  const currentTimeRef = useRef(0);
  const lastTimeUpdateRef = useRef(0);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  // Ensure AudioPlayer exists
  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new AudioPlayer();
    }
    return audioRef.current;
  }, []);

  // Compute current time from the appropriate source
  const computeTime = useCallback(() => {
    const audio = audioRef.current;
    if (isPlayingRef.current) {
      if (audio?.isPlaying) {
        return audio.currentTime;
      }
      return (
        pauseOffsetRef.current +
        (performance.now() - playStartRef.current) / 1000
      );
    }
    return currentTimeRef.current;
  }, []);

  // Called every frame by useFrame — updates DOM + throttled React state
  const updateTime = useCallback(() => {
    const t = computeTime();
    currentTimeRef.current = t;

    // Direct DOM updates (bypass React for 60fps)
    if (timeDisplayRef.current) {
      timeDisplayRef.current.textContent = formatTime(t);
    }
    if (scrubRef.current && !scrubRef.current.matches(":active")) {
      scrubRef.current.value = String(t);
    }

    // Throttled React state (250ms)
    const now = performance.now();
    if (now - lastTimeUpdateRef.current > 250) {
      lastTimeUpdateRef.current = now;
      setCurrentTime(t);
    }
  }, [computeTime]);

  const start = useCallback(() => {
    isPlayingRef.current = true;
    setIsPlaying(true);
    playStartRef.current = performance.now();
    pauseOffsetRef.current = 0;

    const audio = audioRef.current;
    if (audio?.loaded) {
      audio.play();
    }
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;

    if (isPlayingRef.current) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      if (audio?.isPlaying) {
        pauseOffsetRef.current = audio.currentTime;
        audio.pause();
      } else {
        pauseOffsetRef.current +=
          (performance.now() - playStartRef.current) / 1000;
      }
    } else {
      isPlayingRef.current = true;
      setIsPlaying(true);
      playStartRef.current = performance.now();
      if (audio?.loaded) {
        audio.play();
      }
    }
  }, []);

  const scrub = useCallback((t: number) => {
    const audio = audioRef.current;
    pauseOffsetRef.current = t;
    playStartRef.current = performance.now();
    currentTimeRef.current = t;
    setCurrentTime(t);

    if (audio?.loaded) {
      audio.seek(t);
    }
  }, []);

  const loadUrl = useCallback(
    async (url: string) => {
      const audio = getAudio();
      await audio.loadUrl(url);
      setHasAudio(true);
      setAudioDuration(audio.duration);
      setAudioBuffer(audio.audioBuffer);
    },
    [getAudio],
  );

  const loadFile = useCallback(
    async (file: File) => {
      const audio = getAudio();
      await audio.loadFile(file);
      setHasAudio(true);
      setAudioDuration(audio.duration);
      setAudioBuffer(audio.audioBuffer);
    },
    [getAudio],
  );

  const getFFT = useCallback(() => {
    return audioRef.current?.getFFT() ?? { bass: 0, mid: 0, high: 0 };
  }, []);

  const getCurrentTime = useCallback(() => currentTimeRef.current, []);

  const isAudioPlaying = useCallback(
    () => audioRef.current?.isPlaying ?? false,
    [],
  );

  const actions: PlaybackActions = {
    start,
    toggle,
    scrub,
    loadUrl,
    loadFile,
    getFFT,
    getCurrentTime,
    isAudioPlaying,
    updateTime,
  };

  const state: PlaybackState = {
    isPlaying,
    hasAudio,
    audioDuration,
    audioBuffer,
    currentTime,
  };

  return [state, actions, { timeDisplayRef, scrubRef }];
}
