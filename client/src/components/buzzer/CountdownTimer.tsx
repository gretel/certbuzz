import { useEffect, useState } from 'react';

interface CountdownTimerProps {
  durationMs: number;
  startTime: number;
  onTimeout?: () => void;
  label: string;
  warningThreshold?: number; // seconds - when to show warning color
}

export function CountdownTimer({ 
  durationMs, 
  startTime, 
  onTimeout, 
  label,
  warningThreshold = 5 
}: CountdownTimerProps) {
  const [remaining, setRemaining] = useState(durationMs);

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const newRemaining = Math.max(0, durationMs - elapsed);
      setRemaining(newRemaining);

      if (newRemaining === 0 && onTimeout) {
        onTimeout();
      }
    }, 100);

    return () => clearInterval(interval);
  }, [durationMs, startTime, onTimeout]);

  const seconds = remaining / 1000;
  const percentage = (remaining / durationMs) * 100;
  const isWarning = seconds <= warningThreshold;

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-medium text-gray-600">{label}</span>
        <span className={`text-lg font-mono font-bold ${
          isWarning ? 'text-red-600 animate-pulse' : 'text-gray-800'
        }`}>
          {seconds.toFixed(1)}s
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-100 ${
            isWarning ? 'bg-red-500' : 'bg-azure-blue'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
