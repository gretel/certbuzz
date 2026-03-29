import { useEffect, useCallback, useState } from 'react';

interface BuzzerButtonProps {
  onBuzz: () => void;
  disabled: boolean;
  hasBuzzed: boolean;
  timeRemaining: number; // seconds
}

// Trigger device vibration if supported
function vibrate(pattern: number | number[]) {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {
      // Vibration not supported or blocked
    }
  }
}

export function BuzzerButton({ onBuzz, disabled, hasBuzzed, timeRemaining }: BuzzerButtonProps) {
  const [isPressed, setIsPressed] = useState(false);
  const [showFlash, setShowFlash] = useState(false);

  const handleBuzz = useCallback(() => {
    if (!disabled && !hasBuzzed) {
      setIsPressed(true);
      setShowFlash(true);
      
      // Vibrate on buzz
      vibrate([100, 50, 100]);
      
      onBuzz();
      
      // Reset pressed state
      setTimeout(() => setIsPressed(false), 150);
      setTimeout(() => setShowFlash(false), 300);
    }
  }, [disabled, hasBuzzed, onBuzz]);

  // Keyboard handler for B key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'b' || e.key === 'B') && !disabled && !hasBuzzed) {
        e.preventDefault();
        handleBuzz();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBuzz, disabled, hasBuzzed]);

  // Warning vibration when time is low
  useEffect(() => {
    if (!disabled && !hasBuzzed && timeRemaining <= 3 && timeRemaining > 0) {
      vibrate(50);
    }
  }, [Math.floor(timeRemaining), disabled, hasBuzzed]);

  if (hasBuzzed) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="w-48 h-48 rounded-full bg-green-500 flex items-center justify-center shadow-lg animate-bounce">
          <span className="text-6xl">✓</span>
        </div>
        <p className="text-xl font-bold text-green-400 animate-pulse">Du bist dabei!</p>
      </div>
    );
  }

  if (disabled) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="w-48 h-48 rounded-full bg-white/20 flex items-center justify-center shadow-lg opacity-50">
          <span className="text-6xl">🔔</span>
        </div>
        <p className="text-xl font-bold text-white/50">Warte auf Frage...</p>
      </div>
    );
  }

  const isLowTime = timeRemaining <= 3;

  return (
    <div className="flex flex-col items-center gap-4 relative">
      {/* Flash overlay */}
      {showFlash && (
        <div className="absolute inset-0 bg-yellow-400 rounded-full animate-ping opacity-50" 
             style={{ width: '12rem', height: '12rem' }} />
      )}
      
      <button
        onClick={handleBuzz}
        onTouchStart={(e) => { e.preventDefault(); handleBuzz(); }}
        className={`w-48 h-48 rounded-full flex items-center justify-center shadow-lg transition-all duration-100 focus:outline-none focus:ring-4 focus:ring-red-300 ${
          isPressed 
            ? 'bg-red-700 scale-90' 
            : isLowTime
              ? 'bg-red-500 hover:bg-red-600 animate-pulse'
              : 'bg-red-500 hover:bg-red-600 active:bg-red-700 active:scale-95'
        }`}
        style={{
          boxShadow: isPressed 
            ? '0 5px 15px rgba(239, 68, 68, 0.4)' 
            : '0 10px 30px rgba(239, 68, 68, 0.5)',
        }}
      >
        <span className={`text-6xl transition-transform ${isPressed ? 'scale-90' : ''}`}>
          🔔
        </span>
      </button>
      <div className="text-center">
        <p className={`text-xl font-bold ${isLowTime ? 'text-red-400 animate-pulse' : 'text-white'}`}>
          Drück den Buzzer!
        </p>
        <p className="text-sm text-white/60">[B] oder Tippen</p>
        <p className={`text-lg font-mono mt-2 ${isLowTime ? 'text-red-400 font-bold animate-pulse' : 'text-orange-400'}`}>
          {timeRemaining.toFixed(1)}s
        </p>
      </div>
    </div>
  );
}
