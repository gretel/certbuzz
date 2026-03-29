import { useCallback, useRef, useEffect, useMemo } from 'react';

// Sound URLs - can be replaced with actual sound files
const SOUND_URLS = {
  buzz: '/sounds/buzz.mp3',
  correct: '/sounds/correct.mp3',
  wrong: '/sounds/wrong.mp3',
  tick: '/sounds/tick.mp3',
  countdown: '/sounds/countdown.mp3',
  gameStart: '/sounds/game-start.mp3',
};

type SoundName = keyof typeof SOUND_URLS;

// Generate synthetic sounds using Web Audio API as fallback
function createSyntheticSound(type: SoundName): () => void {
  return () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      switch (type) {
        case 'buzz':
          // Sharp buzzer sound
          oscillator.type = 'square';
          oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
          oscillator.frequency.exponentialRampToValueAtTime(880, audioContext.currentTime + 0.1);
          gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.2);
          break;
          
        case 'correct':
          // Pleasant ascending chime
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
          oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.1); // E5
          oscillator.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.2); // G5
          gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.4);
          break;
          
        case 'wrong':
          // Descending buzzer
          oscillator.type = 'sawtooth';
          oscillator.frequency.setValueAtTime(400, audioContext.currentTime);
          oscillator.frequency.exponentialRampToValueAtTime(100, audioContext.currentTime + 0.3);
          gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.3);
          break;
          
        case 'tick':
          // Short click
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(1000, audioContext.currentTime);
          gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.05);
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.05);
          break;
          
        case 'countdown':
          // Warning beep
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
          gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.15);
          break;
          
        case 'gameStart':
          // Exciting game start fanfare - three ascending notes
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
          gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
          
          // Create additional oscillators for chord effect
          const osc2 = audioContext.createOscillator();
          const osc3 = audioContext.createOscillator();
          osc2.connect(gainNode);
          osc3.connect(gainNode);
          osc2.type = 'sine';
          osc3.type = 'sine';
          
          // Play ascending chord: C-E-G
          oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime);
          osc2.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.15);
          osc3.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.3);
          
          gainNode.gain.setValueAtTime(0.4, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.8);
          
          oscillator.start(audioContext.currentTime);
          osc2.start(audioContext.currentTime + 0.15);
          osc3.start(audioContext.currentTime + 0.3);
          
          oscillator.stop(audioContext.currentTime + 0.8);
          osc2.stop(audioContext.currentTime + 0.8);
          osc3.stop(audioContext.currentTime + 0.8);
          break;
      }
    } catch (e) {
      console.warn('Could not play synthetic sound:', e);
    }
  };
}

export function useSounds() {
  const audioCache = useRef<Map<SoundName, HTMLAudioElement>>(new Map());
  const syntheticSounds = useRef<Map<SoundName, () => void>>(new Map());
  const soundEnabled = useRef(true);

  // Initialize synthetic sounds as fallback
  useEffect(() => {
    (Object.keys(SOUND_URLS) as SoundName[]).forEach(name => {
      syntheticSounds.current.set(name, createSyntheticSound(name));
    });
  }, []);

  const playSound = useCallback((name: SoundName) => {
    if (!soundEnabled.current) return;

    // Try to play cached audio first
    let audio = audioCache.current.get(name);
    
    if (!audio) {
      // Try to load the audio file
      audio = new Audio(SOUND_URLS[name]);
      audio.preload = 'auto';
      
      audio.onerror = () => {
        // Fall back to synthetic sound
        const synth = syntheticSounds.current.get(name);
        if (synth) synth();
      };
      
      audioCache.current.set(name, audio);
    }

    // Clone and play to allow overlapping sounds
    const clone = audio.cloneNode() as HTMLAudioElement;
    clone.volume = 0.5;
    clone.play().catch(() => {
      // Fall back to synthetic sound if playback fails
      const synth = syntheticSounds.current.get(name);
      if (synth) synth();
    });
  }, []);

  const toggleSound = useCallback(() => {
    soundEnabled.current = !soundEnabled.current;
    return soundEnabled.current;
  }, []);

  const isSoundEnabled = useCallback(() => soundEnabled.current, []);

  const sounds = useMemo(() => ({
    buzz: () => playSound('buzz'),
    correct: () => playSound('correct'),
    wrong: () => playSound('wrong'),
    tick: () => playSound('tick'),
    countdown: () => playSound('countdown'),
    gameStart: () => playSound('gameStart'),
  }), [playSound]);

  return {
    playSound,
    toggleSound,
    isSoundEnabled,
    sounds,
  };
}
