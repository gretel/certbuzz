import { useRef, useState, useCallback } from 'react';

export interface Vote {
  playerId: string;
  emoji: string;
  answerId: string;
  confidenceZone: 1 | 2 | 3;
  clickX: number; // normalized 0–1 of full rectangle
  clickY: number;
}

interface ConfidenceGridProps {
  options: Array<{ id: string; text: string }>;
  disabled: boolean;
  ownPlayerId: string;
  ownEmoji: string;
  ownVote: Vote | null;
  otherVotes: Vote[];
  onVote: (answerId: string, zone: 1 | 2 | 3, clickX: number, clickY: number) => void;
}

// Colors per quadrant: TL=blue, TR=green, BL=orange, BR=purple
const QUADRANT_GRADIENTS = [
  'radial-gradient(ellipse at 100% 100%, #1d4ed8 0%, #3b82f6 50%, #93c5fd 100%)',
  'radial-gradient(ellipse at 0% 100%, #15803d 0%, #22c55e 50%, #86efac 100%)',
  'radial-gradient(ellipse at 100% 0%, #c2410c 0%, #f97316 50%, #fdba74 100%)',
  'radial-gradient(ellipse at 0% 0%, #7e22ce 0%, #a855f7 50%, #d8b4fe 100%)',
];

const ZONE_LABELS: Record<1 | 2 | 3, string> = {
  1: 'Unsicher',
  2: 'Sicher',
  3: 'Sehr sicher',
};

// Thresholds for zone detection (normalized distance from center)
function getZone(normDist: number): 1 | 2 | 3 {
  if (normDist < 0.35) return 1;
  if (normDist < 0.65) return 2;
  return 3;
}

// Which quadrant (0-3) does a normalized point (nx, ny) fall in?
function getQuadrant(nx: number, ny: number): number {
  if (nx < 0.5 && ny < 0.5) return 0; // TL
  if (nx >= 0.5 && ny < 0.5) return 1; // TR
  if (nx < 0.5 && ny >= 0.5) return 2; // BL
  return 3; // BR
}

export function ConfidenceGrid({
  options,
  disabled,
  ownPlayerId,
  ownEmoji,
  ownVote,
  otherVotes,
  onVote,
}: ConfidenceGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverZone, setHoverZone] = useState<{ quadrant: number; zone: 1 | 2 | 3 } | null>(null);

  // Compute normalized coords and zone from a mouse event
  const getEventCoords = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const dist = Math.hypot((nx - 0.5) * 2, (ny - 0.5) * 2); // 0 at center, ~1.4 at corner
    const normDist = Math.min(dist / 1.4, 1.0); // normalize to 0–1
    const zone = getZone(normDist);
    const quadrant = getQuadrant(nx, ny);
    return { nx, ny, zone, quadrant };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    const coords = getEventCoords(e);
    if (coords) {
      setHoverZone({ quadrant: coords.quadrant, zone: coords.zone });
    }
  }, [disabled, getEventCoords]);

  const handleMouseLeave = useCallback(() => {
    setHoverZone(null);
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    const coords = getEventCoords(e);
    if (!coords) return;
    const option = options[coords.quadrant];
    if (!option) return;
    onVote(option.id, coords.zone, coords.nx, coords.ny);
  }, [disabled, getEventCoords, options, onVote]);

  // All votes to render as badges (own + others)
  const allBadges = [
    ...(ownVote ? [{ ...ownVote, emoji: ownEmoji, isOwn: true }] : []),
    ...otherVotes.filter(v => v.playerId !== ownPlayerId).map(v => ({ ...v, isOwn: false })),
  ];

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none"
      style={{ aspectRatio: '4/3', cursor: disabled ? 'default' : 'crosshair' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {/* 2×2 grid of quadrants */}
      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 rounded-2xl overflow-hidden">
        {options.slice(0, 4).map((option, i) => {
          const isHovered = hoverZone?.quadrant === i;
          const ownIsHere = ownVote?.answerId === option.id;
          return (
            <div
              key={option.id}
              className="relative flex flex-col items-center justify-center p-4 transition-all duration-150"
              style={{
                background: QUADRANT_GRADIENTS[i],
                opacity: disabled && !ownIsHere && hoverZone === null ? 0.7 : 1,
              }}
            >
              {/* Option text */}
              <span className="text-white font-semibold text-center text-sm md:text-base leading-tight drop-shadow-lg max-w-[90%] z-10 pointer-events-none">
                {option.text}
              </span>

              {/* Zone label shown on hover */}
              {isHovered && hoverZone && !disabled && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-black/60 text-white text-xs font-bold whitespace-nowrap z-20">
                  {ZONE_LABELS[hoverZone.zone]}
                  <span className="ml-1 text-yellow-300">
                    ×{hoverZone.zone === 1 ? '1.0' : hoverZone.zone === 2 ? '1.5' : '2.0'}
                  </span>
                </div>
              )}

              {/* Subtle zone ring overlay on hover */}
              {isHovered && !disabled && (
                <div className="absolute inset-0 pointer-events-none z-10"
                  style={{
                    background: 'radial-gradient(ellipse at center, transparent 30%, rgba(255,255,255,0.12) 60%, rgba(255,255,255,0.25) 100%)',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Center dividers */}
      <div className="absolute inset-0 pointer-events-none z-10">
        {/* Vertical line */}
        <div className="absolute top-0 bottom-0 left-1/2 w-1 bg-gray-900/60 -translate-x-1/2" />
        {/* Horizontal line */}
        <div className="absolute left-0 right-0 top-1/2 h-1 bg-gray-900/60 -translate-y-1/2" />
        {/* Center dot */}
        <div className="absolute top-1/2 left-1/2 w-4 h-4 rounded-full bg-gray-900/80 border-2 border-white/30 -translate-x-1/2 -translate-y-1/2" />
      </div>

      {/* Zone boundary rings (visual hint) */}
      {!disabled && (
        <div className="absolute inset-0 pointer-events-none z-5">
          {/* Inner ring at 35% */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15"
            style={{ width: '35%', height: '35%' }} />
          {/* Middle ring at 65% */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10"
            style={{ width: '65%', height: '65%' }} />
        </div>
      )}

      {/* Player emoji badges */}
      {allBadges.map((badge) => (
        <div
          key={badge.playerId}
          className="absolute pointer-events-none z-30 flex flex-col items-center"
          style={{
            left: `${badge.clickX * 100}%`,
            top: `${badge.clickY * 100}%`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div
            className={`rounded-full flex items-center justify-center shadow-lg border-2 transition-all ${
              badge.isOwn
                ? 'w-10 h-10 text-xl border-white bg-black/40'
                : 'w-7 h-7 text-sm border-white/50 bg-black/30'
            }`}
          >
            {badge.emoji}
          </div>
          {badge.isOwn && (
            <span className="text-xs text-white bg-black/60 rounded px-1 mt-0.5 font-bold">Du</span>
          )}
        </div>
      ))}
    </div>
  );
}
