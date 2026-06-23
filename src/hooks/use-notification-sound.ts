import { useCallback, useEffect, useRef, useState } from "react";

const MUTE_KEY = "hype-mute-notifications";

/**
 * Generates a tiny WAV file as a base64 data URI.
 * Two ascending tones (A5 ~880 Hz then C#6 ~1109 Hz) for a pleasant "ding-ding" chime.
 */
const buildNotificationDataUri = (): string => {
  const sampleRate = 44100;
  const duration = 0.35; // total seconds
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, numSamples * 2, true);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let freq: number;
    if (t < 0.12) {
      freq = 880; // A5
    } else if (t < 0.28) {
      freq = 1108.73; // C#6
    } else {
      freq = 0;
    }
    const envelope = Math.max(0, 1 - t / duration);
    const sample = Math.sin(2 * Math.PI * freq * t) * envelope * 0.4;
    const int16 = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    view.setInt16(44 + i * 2, int16, true);
  }

  const blob = new Blob([buffer], { type: "audio/wav" });
  return URL.createObjectURL(blob);
};

let cachedDataUri: string | null = null;
const getCachedDataUri = (): string => {
  if (!cachedDataUri) {
    cachedDataUri = buildNotificationDataUri();
  }
  return cachedDataUri;
};

export const useNotificationSound = () => {
  const [muted, setMuted] = useState(() => {
    try {
      const stored = localStorage.getItem(MUTE_KEY);
      return stored === "true";
    } catch {
      return false;
    }
  });
  const [soundReady, setSoundReady] = useState(false);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const unlockedRef = useRef(false);

  const unlock = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined") return false;

    try {
      // HTML5 Audio approach (more reliable for notifications)
      if (!audioElRef.current) {
        const audio = new Audio(getCachedDataUri());
        audio.preload = "auto";
        audio.volume = 0.7;
        audioElRef.current = audio;
      }

      // Force-load the audio buffer
      audioElRef.current.load();

      // Try to play a silent frame to unlock the audio context
      let unlocked = false;
      await audioElRef.current.play().then(() => {
        unlocked = true;
      }).catch(() => {
        unlocked = false;
      });
      if (!unlocked) {
        unlockedRef.current = false;
        setSoundReady(false);
        return false;
      }

      // Pause immediately and rewind
      audioElRef.current.pause();
      audioElRef.current.currentTime = 0;

      unlockedRef.current = true;
      setSoundReady(true);
      return true;
    } catch {
      setSoundReady(false);
      return false;
    }
  }, []);

  const play = useCallback(() => {
    if (muted) return;
    if (!audioElRef.current) {
      // Lazy init
      const audio = new Audio(getCachedDataUri());
      audio.preload = "auto";
      audio.volume = 0.7;
      audioElRef.current = audio;
    }

    const audio = audioElRef.current;

    // Reset and play
    audio.currentTime = 0;

    const doPlay = () => {
      audio.play().then(() => {
        setSoundReady(true);
      }).catch(() => {
        // Browser blocked it — flag as not ready so user knows to unlock manually
        setSoundReady(false);
        unlockedRef.current = false;
      });
    };

    // If the element was already loaded, just play
    if (audio.readyState >= 2) {
      doPlay();
    } else {
      audio.load();
      audio.addEventListener("canplaythrough", doPlay, { once: true });
    }
  }, [muted]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(MUTE_KEY, String(next));
      } catch {
        // Ignore storage errors.
      }
      return next;
    });
  }, []);

  // Eagerly unlock audio on first user interaction
  useEffect(() => {
    if (unlockedRef.current || soundReady) return;

    const handleFirstInteraction = () => {
      void unlock();
    };

    window.addEventListener("pointerdown", handleFirstInteraction, { once: true });
    window.addEventListener("keydown", handleFirstInteraction, { once: true });
    window.addEventListener("touchstart", handleFirstInteraction, { once: true });

    return () => {
      window.removeEventListener("pointerdown", handleFirstInteraction);
      window.removeEventListener("keydown", handleFirstInteraction);
      window.removeEventListener("touchstart", handleFirstInteraction);
    };
  }, [soundReady, unlock]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current.src = "";
        audioElRef.current = null;
      }
    };
  }, []);

  return { play, muted, toggleMute, soundReady, unlock };
};
