import { useRef, useState, useCallback } from 'react';

export interface Vote {
  playerId: string;
  nickname?: string;
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
  'radial-gradient(ellipse at 0% 0%, #1d4ed8 0%, #3b82f6 50%, #93c5fd 100%)',
  'radial-gradient(ellipse at 100% 0%, #15803d 0%, #22c55e 50%, #86efac 100%)',
  'radial-gradient(ellipse at 0% 100%, #c2410c 0%, #f97316 50%, #fdba74 100%)',
  'radial-gradient(ellipse at 100% 100%, #7e22ce 0%, #a855f7 50%, #d8b4fe 100%)',
];

const ZONE_LABELS: Record<1 | 2 | 3, string> = {
  1: 'Unsicher',
  2: 'Sicher',
  3: 'Garantiert',
};

// Thresholds for zone detection (normalized distance from center)
// Zones sized so "Unsicher" (edge) is smaller, "Garantiert" (center) is larger
function getZone(normDist: number): 1 | 2 | 3 {
  if (normDist < 0.50) return 3; // center = Garantiert (2×)
  if (normDist < 0.80) return 2; // middle = Sicher (1.5×)
  return 1; // edge = Unsicher (1×)
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
  // Cursor position for floating emoji
  const [cursorPos, setCursorPos] = useState<{ nx: number; ny: number } | null>(null);

  const getEventCoords = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const dist = Math.hypot((nx - 0.5) * 2, (ny - 0.5) * 2);
    const normDist = Math.min(dist / 1.4, 1.0);
    const zone = getZone(normDist);
    const quadrant = getQuadrant(nx, ny);
    return { nx, ny, zone, quadrant };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    const coords = getEventCoords(e);
    if (coords) {
      setHoverZone({ quadrant: coords.quadrant, zone: coords.zone });
      setCursorPos({ nx: coords.nx, ny: coords.ny });
    }
  }, [disabled, getEventCoords]);

  const handleMouseLeave = useCallback(() => {
    setHoverZone(null);
    setCursorPos(null);
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    const coords = getEventCoords(e);
    if (!coords) return;
    const option = options[coords.quadrant];
    if (!option) return;
    onVote(option.id, coords.zone, coords.nx, coords.ny);
  }, [disabled, getEventCoords, options, onVote]);

  // Other players' badges (never includes own)
  const otherBadges = otherVotes.filter(v => v.playerId !== ownPlayerId);

  // Own emoji position:
  // - No vote yet: follow cursor (cursor hidden, emoji IS the pointer)
  // - Vote placed: stick at voted position; cursor restores to crosshair so
  //   the player can aim a re-vote precisely
  const followingCursor = !disabled && !ownVote && cursorPos !== null;
  const ownBadgePos = followingCursor
    ? cursorPos
    : ownVote
      ? { nx: ownVote.clickX, ny: ownVote.clickY }
      : null;

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none"
      style={{ aspectRatio: '4/3', cursor: disabled ? 'default' : ownVote ? 'crosshair' : 'none' }}
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
                opacity: disabled && !ownIsHere ? 0.7 : 1,
              }}
            >
              {/* Option text */}
              <span className="text-white font-semibold text-center text-base md:text-lg leading-tight drop-shadow-lg max-w-[90%] z-10 pointer-events-none">
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
        <div className="absolute top-0 bottom-0 left-1/2 w-1 bg-gray-900/60 -translate-x-1/2" />
        <div className="absolute left-0 right-0 top-1/2 h-1 bg-gray-900/60 -translate-y-1/2" />
        <div className="absolute top-1/2 left-1/2 w-4 h-4 rounded-full bg-gray-900/80 border-2 border-white/30 -translate-x-1/2 -translate-y-1/2" />
      </div>

      {/* Zone boundary rings with multiplier annotations */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 5 }}>
        {/* Inner ring — Garantiert ×2 (50% of normalized distance) */}
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-yellow-300/50"
          style={{ width: '50%', height: '50%' }}
        >
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-yellow-400/20 text-yellow-200 text-[10px] font-bold whitespace-nowrap backdrop-blur-sm">
            Garantiert ×2
          </span>
        </div>
        {/* Middle ring — Sicher ×1.5 (80% of normalized distance) */}
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-white/30"
          style={{ width: '80%', height: '80%' }}
        >
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-white/10 text-white/60 text-[10px] font-bold whitespace-nowrap backdrop-blur-sm">
            Sicher ×1.5
          </span>
        </div>
        {/* Outer label — Unsicher ×1 */}
        <span className="absolute top-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-white/5 text-white/40 text-[10px] font-bold whitespace-nowrap">
          Unsicher ×1
        </span>
      </div>

      {/* Other players' emoji badges */}
      {otherBadges.map((badge) => (
        <div
          key={badge.playerId}
          className="absolute pointer-events-none z-30 flex flex-col items-center"
          style={{
            left: `${badge.clickX * 100}%`,
            top: `${badge.clickY * 100}%`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div className="w-10 h-10 text-xl rounded-full flex items-center justify-center shadow-lg border-2 border-cyan-300/70 bg-cyan-900/40">
            {badge.emoji}
          </div>
          {badge.nickname && (
            <span className="text-[10px] text-white/80 bg-black/50 rounded px-1 mt-0.5 whitespace-nowrap max-w-[60px] truncate">
              {badge.nickname}
            </span>
          )}
        </div>
      ))}

      {/* Own emoji — follows cursor, falls back to voted position */}
      {ownBadgePos && (
        <div
          className="absolute pointer-events-none z-30 flex flex-col items-center"
          style={{
            left: `${ownBadgePos.nx * 100}%`,
            top: `${ownBadgePos.ny * 100}%`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div className="w-10 h-10 text-xl rounded-full flex items-center justify-center shadow-lg border-2 border-white bg-black/40">
            {ownEmoji}
          </div>
          {!followingCursor && (
            <span className="text-xs text-white bg-black/60 rounded px-1 mt-0.5 font-bold">Du</span>
          )}
        </div>
      )}
    </div>
  );
}
