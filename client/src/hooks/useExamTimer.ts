import { useEffect, useState } from 'react';

/**
 * Server-anchored exam countdown. Returns the remaining seconds, which can
 * be negative if the timer has expired. The server is the source of truth
 * for `examStartedAt` — this hook just computes against wall clock. Survives
 * tab close / reload: on remount, the remaining time is correctly recomputed.
 */
export function useExamTimer(
  examStartedAt: number | null,
  durationMinutes: number
): number {
  const [remaining, setRemaining] = useState<number>(() => {
    if (!examStartedAt) return durationMinutes * 60;
    return durationMinutes * 60 - (Date.now() - examStartedAt) / 1000;
  });

  useEffect(() => {
    if (!examStartedAt) return;
    const tick = () => {
      setRemaining(durationMinutes * 60 - (Date.now() - examStartedAt) / 1000);
    };
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [examStartedAt, durationMinutes]);

  return remaining;
}

/**
 * Format a signed second count as M:SS or -M:SS.
 */
export function formatExamTime(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(Math.floor(seconds));
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Tailwind color class for the timer based on remaining seconds.
 * Green > 5min, orange ≤ 5min, red at 0 or below.
 */
export function examTimerColor(seconds: number): string {
  if (seconds <= 0) return 'text-red-500';
  if (seconds <= 300) return 'text-orange-400';
  return 'text-green-400';
}
