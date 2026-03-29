# Team Training Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `training` game mode with a 4-quadrant confidence-grid UI, real-time emoji heatmap, and dozent-controlled round reveal.

**Architecture:** New `trainingGame.ts` server module (mirrors `buzzerGame.ts`), new React components `ConfidenceGrid` + `TrainingReveal` + `TrainingGameSession`, wired into existing socket/routing/dozent infrastructure via minimal additive changes.

**Tech Stack:** TypeScript, React 18, Tailwind CSS, Socket.IO, plain 2D Canvas API (reveal animation), SQLite (sql.js)

---

## File Map

| Action | File |
|--------|------|
| Modify | `server/src/db/schema.ts` — add `'training'` to CHECK constraints + migration |
| Modify | `server/src/db/queries.ts` — extend `GameMode` type |
| Create | `server/src/socket/trainingGame.ts` — in-memory state, scoring, socket logic |
| Modify | `server/src/socket/events.ts` — register training socket handlers |
| Modify | `server/src/routes/dozent.ts` — accept `'training'` gameMode, filter 4-option Qs |
| Create | `client/src/components/game/ConfidenceGrid.tsx` — interactive 4-quadrant surface |
| Create | `client/src/components/game/TrainingReveal.tsx` — canvas reveal animation |
| Create | `client/src/pages/TrainingGameSession.tsx` — top-level player session page |
| Modify | `client/src/pages/GameSession.tsx` — route to TrainingGameSession |
| Modify | `client/src/components/dozent/DozentPanel.tsx` — add training mode UI + controls |

---

## Task 1: Git branch

**Files:** none

- [ ] **Create feature branch**

```bash
git checkout -b feature/team-training
```

- [ ] **Verify**

```bash
git branch --show-current
# expected: feature/team-training
```

---

## Task 2: DB schema — add `'training'` to CHECK constraints

**Files:**
- Modify: `server/src/db/schema.ts`

The `sessions` table has two CHECK constraints that need `'training'` added. Do this via a migration block that rebuilds the table (same pattern as the existing `enrolling` migration at line 101).

- [ ] **Edit `server/src/db/schema.ts`**

Change the `CREATE TABLE IF NOT EXISTS sessions` statement's `game_mode` CHECK to:
```sql
game_mode TEXT NOT NULL DEFAULT 'racing' CHECK(game_mode IN ('racing', 'buzzer', 'training'))
```

Then add a migration block after the existing `enrolling` migration (after line 126):

```typescript
  // Migration: Add 'training' to game_mode CHECK constraint
  const tableInfo2 = db.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'`);
  const tableSql2 = tableInfo2.length > 0 ? (tableInfo2[0].values[0][0] as string) : '';
  const needsTrainingMigration = tableSql2.includes('game_mode') && !tableSql2.includes('training');
  if (needsTrainingMigration) {
    console.log('🔄 Migrating database: adding training game_mode...');
    try {
      db.run(`ALTER TABLE sessions RENAME TO sessions_old`);
      db.run(`
        CREATE TABLE sessions (
          session_code TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          started_at INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('active', 'finished')),
          total_questions INTEGER NOT NULL,
          question_ids TEXT NOT NULL,
          game_mode TEXT NOT NULL DEFAULT 'racing' CHECK(game_mode IN ('racing', 'buzzer', 'training')),
          game_state TEXT DEFAULT 'lobby' CHECK(game_state IN ('lobby', 'question', 'enrolling', 'answering', 'result', 'finished')),
          current_question_index INTEGER DEFAULT 0,
          question_bank TEXT NOT NULL DEFAULT 'azure-az104'
        )
      `);
      db.run(`INSERT INTO sessions SELECT * FROM sessions_old`);
      db.run(`DROP TABLE sessions_old`);
      console.log('✅ training game_mode migration complete');
    } catch (e) {
      console.error('❌ training migration failed:', e);
    }
  }
```

- [ ] **Commit**

```bash
git add server/src/db/schema.ts
git commit -m "feat: add training to sessions game_mode CHECK constraint"
```

---

## Task 3: `queries.ts` — extend `GameMode` type

**Files:**
- Modify: `server/src/db/queries.ts` line 3

- [ ] **Edit `queries.ts`**

```typescript
// line 3 — change:
export type GameMode = 'racing' | 'buzzer';
// to:
export type GameMode = 'racing' | 'buzzer' | 'training';
```

- [ ] **Commit**

```bash
git add server/src/db/queries.ts
git commit -m "feat: extend GameMode type with training"
```

---

## Task 4: `trainingGame.ts` — server game logic

**Files:**
- Create: `server/src/socket/trainingGame.ts`

- [ ] **Create `server/src/socket/trainingGame.ts`** with this full content:

```typescript
import { Server } from 'socket.io';
import { queries } from '../db/queries.js';
import { getQuestion, type Question } from '../questions/questionBank.js';

export interface TrainingVote {
  playerId: string;
  nickname: string;
  emoji: string;
  answerId: string;
  confidenceZone: 1 | 2 | 3;
  clickX: number; // normalized 0–1 within full rectangle
  clickY: number;
}

interface TrainingGameState {
  sessionCode: string;
  votes: Map<string, TrainingVote>; // keyed by playerId
  timers: {
    roundTimeout?: NodeJS.Timeout;
    transitionTimeout?: NodeJS.Timeout;
  };
}

const trainingGames = new Map<string, TrainingGameState>();

function getQuestionForSession(sessionCode: string, questionId: string): Question | undefined {
  const session = queries.getSession(sessionCode);
  if (!session) return undefined;
  return getQuestion(session.questionBank, questionId);
}

function getBasePoints(difficulty: string): number {
  switch (difficulty) {
    case 'easy': return 500;
    case 'hard': return 1500;
    default: return 1000;
  }
}

function getMultiplier(zone: 1 | 2 | 3): number {
  switch (zone) {
    case 1: return 1.0;
    case 2: return 1.5;
    case 3: return 2.0;
  }
}

export function initTrainingGame(sessionCode: string): TrainingGameState {
  const state: TrainingGameState = {
    sessionCode,
    votes: new Map(),
    timers: {},
  };
  trainingGames.set(sessionCode, state);
  return state;
}

export function getTrainingGame(sessionCode: string): TrainingGameState | undefined {
  return trainingGames.get(sessionCode);
}

export function cleanupTrainingGame(sessionCode: string) {
  const state = trainingGames.get(sessionCode);
  if (state) {
    if (state.timers.roundTimeout) clearTimeout(state.timers.roundTimeout);
    if (state.timers.transitionTimeout) clearTimeout(state.timers.transitionTimeout);
    trainingGames.delete(sessionCode);
  }
}

export function startTrainingGame(io: Server, sessionCode: string) {
  const session = queries.getSession(sessionCode);
  if (!session || session.gameMode !== 'training') return;

  let state = trainingGames.get(sessionCode);
  if (!state) state = initTrainingGame(sessionCode);

  queries.updateSessionGameState(sessionCode, 'question', 0);
  showTrainingQuestion(io, sessionCode, 0);
}

function showTrainingQuestion(io: Server, sessionCode: string, questionIndex: number) {
  const session = queries.getSession(sessionCode);
  if (!session) return;

  const state = trainingGames.get(sessionCode);
  if (!state) return;

  if (state.timers.roundTimeout) clearTimeout(state.timers.roundTimeout);
  if (state.timers.transitionTimeout) clearTimeout(state.timers.transitionTimeout);
  state.votes.clear();

  const questionId = session.questionIds[questionIndex];
  const question = getQuestionForSession(sessionCode, questionId);
  if (!question) return;

  queries.updateSessionGameState(sessionCode, 'question', questionIndex);

  const { correctAnswers, explanation, references, ...questionWithoutAnswer } = question;

  io.to(sessionCode).emit('training-question', {
    questionIndex,
    totalQuestions: session.totalQuestions,
    question: questionWithoutAnswer,
  });

  // 3-minute safety timeout — dozent normally closes manually
  state.timers.roundTimeout = setTimeout(() => {
    closeTrainingRound(io, sessionCode);
  }, 3 * 60 * 1000);
}

export function handleTrainingVote(
  io: Server,
  sessionCode: string,
  vote: TrainingVote
) {
  const state = trainingGames.get(sessionCode);
  if (!state) return;

  const session = queries.getSession(sessionCode);
  if (!session || session.gameState !== 'question') return;

  // Last vote wins — replace previous
  state.votes.set(vote.playerId, vote);

  // Broadcast to room (all players + dozent)
  io.to(sessionCode).emit('training-vote-update', {
    playerId: vote.playerId,
    emoji: vote.emoji,
    answerId: vote.answerId,
    confidenceZone: vote.confidenceZone,
    clickX: vote.clickX,
    clickY: vote.clickY,
  });

  // Send vote count to dozent (without answer breakdown)
  const players = queries.getSessionPlayers(sessionCode);
  io.to(sessionCode).emit('training-vote-count', {
    voted: state.votes.size,
    total: players.length,
  });
}

export function closeTrainingRound(io: Server, sessionCode: string) {
  const state = trainingGames.get(sessionCode);
  if (!state) return;

  const session = queries.getSession(sessionCode);
  if (!session) return;

  if (state.timers.roundTimeout) clearTimeout(state.timers.roundTimeout);

  const questionId = session.questionIds[session.currentQuestionIndex];
  const question = getQuestionForSession(sessionCode, questionId);
  if (!question) return;

  queries.updateSessionGameState(sessionCode, 'result');

  const correctAnswerId = question.correctAnswers[0]; // single-choice
  const resultVotes: Array<{
    playerId: string;
    nickname: string;
    emoji: string;
    answerId: string;
    confidenceZone: 1 | 2 | 3;
    clickX: number;
    clickY: number;
    correct: boolean;
    pointsAwarded: number;
  }> = [];

  for (const vote of state.votes.values()) {
    const correct = vote.answerId === correctAnswerId;
    const points = correct
      ? Math.round(getBasePoints(question.difficulty) * getMultiplier(vote.confidenceZone))
      : 0;

    const player = queries.getPlayer(vote.playerId);
    if (player) {
      const newScore = player.score + points;
      const newCorrect = player.correctAnswers + (correct ? 1 : 0);
      queries.updatePlayerScore(vote.playerId, newCorrect, newScore);
      queries.saveAnswer({
        playerId: vote.playerId,
        questionId,
        answeredAt: Date.now(),
        timeSeconds: 0,
        correct,
        selectedAnswers: JSON.stringify([vote.answerId]),
      });
    }

    resultVotes.push({
      playerId: vote.playerId,
      nickname: vote.nickname,
      emoji: vote.emoji,
      answerId: vote.answerId,
      confidenceZone: vote.confidenceZone,
      clickX: vote.clickX,
      clickY: vote.clickY,
      correct,
      pointsAwarded: points,
    });
  }

  io.to(sessionCode).emit('training-result', {
    correctAnswerId,
    question: {
      id: question.id,
      options: question.options,
      explanation: question.explanation,
      references: question.references,
    },
    votes: resultVotes,
    leaderboard: queries.getLeaderboard(sessionCode),
  });

  transitionToNextTrainingQuestion(io, sessionCode);
}

function transitionToNextTrainingQuestion(io: Server, sessionCode: string) {
  const session = queries.getSession(sessionCode);
  if (!session) return;

  const state = trainingGames.get(sessionCode);
  if (!state) return;

  const nextIndex = session.currentQuestionIndex + 1;
  const transitionMs = 20000;
  const transitionStartedAt = Date.now();

  if (nextIndex >= session.totalQuestions) {
    io.to(sessionCode).emit('training-transition', {
      nextQuestionIndex: -1,
      nextQuestionIn: transitionMs,
      transitionStartedAt,
      isGameOver: true,
      leaderboard: queries.getLeaderboard(sessionCode),
    });

    state.timers.transitionTimeout = setTimeout(() => {
      endTrainingGame(io, sessionCode);
    }, transitionMs);
  } else {
    io.to(sessionCode).emit('training-transition', {
      nextQuestionIndex: nextIndex,
      nextQuestionIn: transitionMs,
      transitionStartedAt,
      isGameOver: false,
      leaderboard: queries.getLeaderboard(sessionCode),
    });

    state.timers.transitionTimeout = setTimeout(() => {
      showTrainingQuestion(io, sessionCode, nextIndex);
    }, transitionMs);
  }
}

function endTrainingGame(io: Server, sessionCode: string) {
  const state = trainingGames.get(sessionCode);
  if (state) {
    if (state.timers.roundTimeout) clearTimeout(state.timers.roundTimeout);
    if (state.timers.transitionTimeout) clearTimeout(state.timers.transitionTimeout);
  }

  queries.updateSessionGameState(sessionCode, 'finished');

  io.to(sessionCode).emit('training-game-over', {
    leaderboard: queries.getLeaderboard(sessionCode),
  });

  cleanupTrainingGame(sessionCode);
}

export function forceNextTrainingQuestion(io: Server, sessionCode: string) {
  const state = trainingGames.get(sessionCode);
  const session = queries.getSession(sessionCode);
  if (!session) return;

  if (!state) {
    initTrainingGame(sessionCode);
  } else {
    if (state.timers.roundTimeout) clearTimeout(state.timers.roundTimeout);
    if (state.timers.transitionTimeout) clearTimeout(state.timers.transitionTimeout);
  }

  const nextIndex = session.currentQuestionIndex + 1;
  if (nextIndex >= session.totalQuestions) {
    endTrainingGame(io, sessionCode);
  } else {
    showTrainingQuestion(io, sessionCode, nextIndex);
  }
}

export function forceEndTrainingGame(io: Server, sessionCode: string) {
  const session = queries.getSession(sessionCode);
  if (!session) return;

  const state = trainingGames.get(sessionCode);
  if (state) {
    if (state.timers.roundTimeout) clearTimeout(state.timers.roundTimeout);
    if (state.timers.transitionTimeout) clearTimeout(state.timers.transitionTimeout);
  }

  queries.updateSessionGameState(sessionCode, 'finished');

  io.to(sessionCode).emit('training-game-over', {
    leaderboard: queries.getLeaderboard(sessionCode),
  });

  cleanupTrainingGame(sessionCode);
}

export function getTrainingGameState(sessionCode: string) {
  const state = trainingGames.get(sessionCode);
  const session = queries.getSession(sessionCode);
  if (!session) return null;

  return {
    gameState: session.gameState,
    currentQuestionIndex: session.currentQuestionIndex,
    totalQuestions: session.totalQuestions,
    votes: state
      ? Array.from(state.votes.values()).map(v => ({
          playerId: v.playerId,
          emoji: v.emoji,
          answerId: v.answerId,
          confidenceZone: v.confidenceZone,
          clickX: v.clickX,
          clickY: v.clickY,
        }))
      : [],
    leaderboard: queries.getLeaderboard(sessionCode),
  };
}
```

- [ ] **Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
# expected: no errors
```

- [ ] **Commit**

```bash
git add server/src/socket/trainingGame.ts
git commit -m "feat: add trainingGame server module"
```

---

## Task 5: `events.ts` — register training handlers

**Files:**
- Modify: `server/src/socket/events.ts`

- [ ] **Add import at top of `events.ts`** (after existing imports):

```typescript
import {
  startTrainingGame,
  handleTrainingVote,
  closeTrainingRound,
  forceNextTrainingQuestion,
  forceEndTrainingGame,
  getTrainingGameState,
  getTrainingGame,
  initTrainingGame,
} from './trainingGame.js';
```

- [ ] **Add training handlers inside `io.on('connection', ...)` block**, after the `// ========== BUZZER MODE EVENTS ==========` section:

```typescript
    // ========== TRAINING MODE EVENTS ==========

    socket.on('training-start-game', (sessionCode: string) => {
      if (!requireDozent(socket, 'training-start-game')) return;
      const session = queries.getSession(sessionCode);
      if (!session || session.gameMode !== 'training') {
        socket.emit('error', { message: 'Invalid session for training mode' });
        return;
      }
      startTrainingGame(io, sessionCode);
    });

    socket.on('training-vote', (data: {
      sessionCode: string;
      playerId: string;
      answerId: string;
      confidenceZone: 1 | 2 | 3;
      clickX: number;
      clickY: number;
    }) => {
      const { sessionCode, playerId, answerId, confidenceZone, clickX, clickY } = data;
      const player = queries.getPlayer(playerId);
      if (!player) return;
      handleTrainingVote(io, sessionCode, {
        playerId,
        nickname: player.nickname,
        emoji: player.emoji,
        answerId,
        confidenceZone,
        clickX,
        clickY,
      });
    });

    socket.on('training-close-round', (sessionCode: string) => {
      if (!requireDozent(socket, 'training-close-round')) return;
      closeTrainingRound(io, sessionCode);
    });

    socket.on('training-force-next', (sessionCode: string) => {
      if (!requireDozent(socket, 'training-force-next')) return;
      forceNextTrainingQuestion(io, sessionCode);
    });

    socket.on('training-force-end', (sessionCode: string) => {
      if (!requireDozent(socket, 'training-force-end')) return;
      forceEndTrainingGame(io, sessionCode);
    });

    socket.on('training-join-session', (data: { sessionCode: string; playerId: string }) => {
      const { sessionCode, playerId } = data;

      if (socket.rooms.has(sessionCode)) return;

      socket.join(sessionCode);
      socket.data.playerId = playerId;
      socket.data.sessionCode = sessionCode;

      const session = queries.getSession(sessionCode);
      if (session && session.gameMode === 'training' && !getTrainingGame(sessionCode)) {
        initTrainingGame(sessionCode);
      }

      const state = getTrainingGameState(sessionCode);
      if (state) {
        socket.emit('training-state', state);
      }

      const players = queries.getSessionPlayers(sessionCode);
      io.to(sessionCode).emit('training-players-update', {
        players: players.map(p => ({
          playerId: p.playerId,
          nickname: p.nickname,
          emoji: p.emoji,
          score: p.score,
        })),
      });
    });

    socket.on('training-get-state', (sessionCode: string) => {
      const state = getTrainingGameState(sessionCode);
      if (state) {
        socket.emit('training-state', state);
      }

      const players = queries.getSessionPlayers(sessionCode);
      socket.emit('training-players-update', {
        players: players.map(p => ({
          playerId: p.playerId,
          nickname: p.nickname,
          emoji: p.emoji,
          score: p.score,
        })),
      });
    });
```

- [ ] **Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
# expected: no errors
```

- [ ] **Commit**

```bash
git add server/src/socket/events.ts
git commit -m "feat: add training socket event handlers"
```

---

## Task 6: `dozent.ts` route — accept `training`, filter 4-option questions

**Files:**
- Modify: `server/src/routes/dozent.ts`

- [ ] **In the `create-session` handler**, change the gameMode validation at line 20:

```typescript
// change:
if (gameMode !== 'racing' && gameMode !== 'buzzer') {
// to:
if (gameMode !== 'racing' && gameMode !== 'buzzer' && gameMode !== 'training') {
```

- [ ] **After the category filter** (after `filteredQuestions = allQuestions.filter(...)`), add a training-mode filter:

```typescript
    // For training mode: only use single-choice questions with exactly 4 options
    if (gameMode === 'training') {
      filteredQuestions = filteredQuestions.filter(
        q => q.type === 'single' && q.options.length === 4
      );
    }
```

- [ ] **Also import `cleanupTrainingGame`** alongside the existing `cleanupBuzzerGame` import. Find the delete-session route's cleanup call and add:

```typescript
import { cleanupTrainingGame } from '../socket/trainingGame.js';
```

And in the delete handler, after `cleanupBuzzerGame(sessionCode)`:
```typescript
    cleanupTrainingGame(sessionCode);
```

- [ ] **Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```

- [ ] **Commit**

```bash
git add server/src/routes/dozent.ts
git commit -m "feat: accept training gameMode in session creation, filter 4-option questions"
```

---

## Task 7: `ConfidenceGrid.tsx` — interactive 4-quadrant surface

**Files:**
- Create: `client/src/components/game/ConfidenceGrid.tsx`

The grid is a `div` with `position: relative` containing a 2×2 CSS grid. Each quadrant gets a distinct `radial-gradient`. Click/hover math measures normalized distance from the rectangle center to determine the confidence zone (3 concentric zones). Other players' emoji avatars are rendered as absolutely positioned badges.

- [ ] **Create `client/src/components/game/ConfidenceGrid.tsx`**:

```typescript
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
// Zone 1: 0–0.35, Zone 2: 0.35–0.65, Zone 3: 0.65–1.0
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
    ...(ownVote ? [{ ...ownVote, isOwn: true }] : []),
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
```

- [ ] **Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Commit**

```bash
git add client/src/components/game/ConfidenceGrid.tsx
git commit -m "feat: add ConfidenceGrid component"
```

---

## Task 8: `TrainingReveal.tsx` — canvas reveal animation

**Files:**
- Create: `client/src/components/game/TrainingReveal.tsx`

Canvas overlay that activates when the dozent closes the round. Correct quadrant gets a particle burst + glow pulse. Wrong quadrants darken. Player badges shift to green/red.

- [ ] **Create `client/src/components/game/TrainingReveal.tsx`**:

```typescript
import { useEffect, useRef, useCallback } from 'react';
import type { Vote } from './ConfidenceGrid';

interface TrainingRevealProps {
  correctAnswerId: string;
  options: Array<{ id: string; text: string }>;
  votes: Array<Vote & { correct: boolean }>;
  containerRef: React.RefObject<HTMLDivElement>;
  onComplete: () => void;
}

// Particle for the burst effect
interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  r: number;
  alpha: number;
  color: string;
}

const ANIM_DURATION = 3000; // ms

export function TrainingReveal({ correctAnswerId, options, votes, containerRef, onComplete }: TrainingRevealProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);

  // Determine which quadrant index is correct (0=TL,1=TR,2=BL,3=BR)
  const correctIdx = options.findIndex(o => o.id === correctAnswerId);

  const getQuadrantCenter = useCallback((idx: number, w: number, h: number) => {
    const col = idx % 2; // 0=left, 1=right
    const row = Math.floor(idx / 2); // 0=top, 1=bottom
    return {
      x: w * (col === 0 ? 0.25 : 0.75),
      y: h * (row === 0 ? 0.25 : 0.75),
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || correctIdx < 0) return;

    const resize = () => {
      canvas.width = container.offsetWidth;
      canvas.height = container.offsetHeight;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    // Spawn particles from correct quadrant center
    const { x: cx, y: cy } = getQuadrantCenter(correctIdx, canvas.width, canvas.height);
    const colors = ['#facc15', '#fbbf24', '#f59e0b', '#ffffff', '#a3e635'];
    for (let i = 0; i < 60; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3;
      particlesRef.current.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: 2 + Math.random() * 4,
        alpha: 1,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }

    startTimeRef.current = performance.now();

    const animate = (now: number) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const elapsed = now - startTimeRef.current;
      const t = Math.min(elapsed / ANIM_DURATION, 1);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const w = canvas.width;
      const h = canvas.height;

      // Darken wrong quadrants
      const darkAlpha = Math.min(t * 1.8, 0.6);
      for (let i = 0; i < 4; i++) {
        if (i === correctIdx) continue;
        const col = i % 2;
        const row = Math.floor(i / 2);
        ctx.fillStyle = `rgba(0, 0, 0, ${darkAlpha})`;
        ctx.fillRect(col === 0 ? 0 : w / 2, row === 0 ? 0 : h / 2, w / 2, h / 2);
      }

      // Glow pulse on correct quadrant
      if (t > 0.1) {
        const pulseT = (t - 0.1) / 0.9;
        const glowAlpha = 0.3 + 0.2 * Math.sin(pulseT * Math.PI * 4);
        const { x: qx, y: qy } = getQuadrantCenter(correctIdx, w, h);
        const grad = ctx.createRadialGradient(qx, qy, 10, qx, qy, Math.min(w, h) * 0.35);
        grad.addColorStop(0, `rgba(250, 204, 21, ${glowAlpha})`);
        grad.addColorStop(1, 'rgba(250, 204, 21, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      // Animate particles
      if (elapsed < 1500) {
        for (const p of particlesRef.current) {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.05; // gravity
          p.alpha = Math.max(0, 1 - elapsed / 1200);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = p.alpha;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      if (t < 1) {
        animRef.current = requestAnimationFrame(animate);
      } else {
        // Fade out canvas
        ctx.clearRect(0, 0, w, h);
        onComplete();
      }
    };

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
    };
  }, [correctIdx, getQuadrantCenter, onComplete]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-20 rounded-2xl"
    />
  );
}
```

- [ ] **Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Commit**

```bash
git add client/src/components/game/TrainingReveal.tsx
git commit -m "feat: add TrainingReveal canvas animation component"
```

---

## Task 9: `TrainingGameSession.tsx` — player session page

**Files:**
- Create: `client/src/pages/TrainingGameSession.tsx`

- [ ] **Create `client/src/pages/TrainingGameSession.tsx`**:

```typescript
import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocket } from '../hooks/useSocket';
import { useSounds } from '../hooks/useSounds';
import { ConfidenceGrid, type Vote } from '../components/game/ConfidenceGrid';
import { TrainingReveal } from '../components/game/TrainingReveal';
import { TransitionScreen } from '../components/buzzer/TransitionScreen';
import { MarkdownText } from '../components/shared/MarkdownText';

interface Question {
  id: string;
  category: string;
  type: string;
  difficulty: 'easy' | 'medium' | 'hard';
  question: string;
  options: Array<{ id: string; text: string }>;
}

interface ResultVote extends Vote {
  nickname: string;
  correct: boolean;
  pointsAwarded: number;
}

interface TrainingResult {
  correctAnswerId: string;
  question: {
    id: string;
    options: Array<{ id: string; text: string }>;
    explanation: string;
    references?: string[];
  };
  votes: ResultVote[];
  leaderboard: Array<{ playerId: string; nickname: string; emoji: string; score: number }>;
}

interface TransitionData {
  nextQuestionIndex: number;
  nextQuestionIn: number;
  transitionStartedAt: number;
  isGameOver: boolean;
  leaderboard: Array<{ playerId: string; nickname: string; emoji: string; score: number }>;
}

type GamePhase = 'lobby' | 'question' | 'reveal' | 'result' | 'transition' | 'finished';

interface TrainingGameSessionProps {
  sessionCode: string;
  totalQuestions: number;
  playerId: string;
  nickname: string;
  emoji: string;
}

export function TrainingGameSession({
  sessionCode,
  totalQuestions,
  playerId,
  nickname,
  emoji,
}: TrainingGameSessionProps) {
  const navigate = useNavigate();
  const socket = getSocket();
  const { sounds } = useSounds();
  const soundsRef = useRef(sounds);
  const hasJoinedRef = useRef(false);
  const gridContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { soundsRef.current = sounds; }, [sounds]);

  const [gamePhase, setGamePhase] = useState<GamePhase>('lobby');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [ownVote, setOwnVote] = useState<Vote | null>(null);
  const [otherVotes, setOtherVotes] = useState<Vote[]>([]);
  const [result, setResult] = useState<TrainingResult | null>(null);
  const [transitionData, setTransitionData] = useState<TransitionData | null>(null);
  const [leaderboard, setLeaderboard] = useState<Array<{ playerId: string; nickname: string; emoji: string; score: number }>>([]);
  const [roundTimerStart, setRoundTimerStart] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState(180); // 3 min
  const [sessionDeleted, setSessionDeleted] = useState(false);

  // 3-minute client-side countdown
  useEffect(() => {
    if (gamePhase !== 'question') return;
    setTimeLeft(180);
    const start = Date.now();
    setRoundTimerStart(start);
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      const remaining = Math.max(0, 180 - elapsed);
      setTimeLeft(remaining);
      if (remaining === 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [gamePhase, currentQuestionIndex]);

  // Socket setup
  useEffect(() => {
    if (!socket || hasJoinedRef.current) return;
    hasJoinedRef.current = true;

    socket.emit('training-join-session', { sessionCode, playerId });

    socket.on('session-deleted', () => setSessionDeleted(true));

    socket.on('training-state', (state: any) => {
      setCurrentQuestionIndex(state.currentQuestionIndex || 0);
      if (state.gameState !== 'lobby') {
        setGamePhase(state.gameState as GamePhase);
      }
      // Restore any existing votes for this round
      if (state.votes) {
        const own = state.votes.find((v: any) => v.playerId === playerId);
        if (own) setOwnVote(own);
        setOtherVotes(state.votes.filter((v: any) => v.playerId !== playerId));
      }
    });

    socket.on('training-question', (data: { questionIndex: number; totalQuestions: number; question: Question }) => {
      setCurrentQuestion(data.question);
      setCurrentQuestionIndex(data.questionIndex);
      setOwnVote(null);
      setOtherVotes([]);
      setResult(null);
      setGamePhase('question');
      soundsRef.current.gameStart?.();
    });

    socket.on('training-vote-update', (vote: any) => {
      if (vote.playerId === playerId) return; // own vote handled locally
      setOtherVotes(prev => {
        const filtered = prev.filter(v => v.playerId !== vote.playerId);
        return [...filtered, vote];
      });
    });

    socket.on('training-result', (data: TrainingResult) => {
      setResult(data);
      setLeaderboard(data.leaderboard);
      setGamePhase('reveal');
    });

    socket.on('training-transition', (data: TransitionData) => {
      setTransitionData(data);
      setLeaderboard(data.leaderboard);
      setGamePhase('transition');
    });

    socket.on('training-game-over', (data: { leaderboard: any[] }) => {
      setLeaderboard(data.leaderboard);
      setGamePhase('finished');
    });

    return () => {
      socket.off('session-deleted');
      socket.off('training-state');
      socket.off('training-question');
      socket.off('training-vote-update');
      socket.off('training-result');
      socket.off('training-transition');
      socket.off('training-game-over');
    };
  }, [socket, sessionCode, playerId]);

  const handleVote = useCallback((answerId: string, zone: 1 | 2 | 3, clickX: number, clickY: number) => {
    const vote: Vote = { playerId, emoji, answerId, confidenceZone: zone, clickX, clickY };
    setOwnVote(vote);
    socket?.emit('training-vote', { sessionCode, playerId, answerId, confidenceZone: zone, clickX, clickY });
  }, [socket, sessionCode, playerId, emoji]);

  const handleRevealComplete = useCallback(() => {
    setGamePhase('result');
  }, []);

  if (sessionDeleted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 border border-white/20 max-w-md w-full text-center">
          <div className="text-6xl mb-4">🚫</div>
          <h1 className="text-2xl font-bold text-white mb-2">Session beendet</h1>
          <p className="text-white/70 mb-6">Diese Session wurde vom Dozenten geschlossen.</p>
          <button onClick={() => navigate('/')} className="w-full bg-gradient-to-r from-cb-primary to-cb-accent text-white font-bold py-3 px-6 rounded-xl">
            Zur Startseite
          </button>
        </div>
      </div>
    );
  }

  if (gamePhase === 'lobby') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-6xl mb-4">🧠</div>
          <h1 className="text-3xl font-bold text-white mb-2">Team Training</h1>
          <p className="text-white/60">{nickname} {emoji} — warte auf den Dozenten...</p>
        </div>
      </div>
    );
  }

  if (gamePhase === 'transition' && transitionData) {
    return (
      <TransitionScreen
        nextQuestionIn={transitionData.nextQuestionIn}
        transitionStartedAt={transitionData.transitionStartedAt}
        currentQuestionIndex={currentQuestionIndex}
        nextQuestionIndex={transitionData.nextQuestionIndex}
        totalQuestions={totalQuestions}
        leaderboard={transitionData.leaderboard}
        isGameOver={transitionData.isGameOver}
        playerId={playerId}
      />
    );
  }

  if (gamePhase === 'finished') {
    const myEntry = leaderboard.find(e => e.playerId === playerId);
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 border border-white/20 max-w-md w-full text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h1 className="text-2xl font-bold text-white mb-2">Spiel beendet!</h1>
          {myEntry && (
            <p className="text-cb-accent text-xl font-bold mb-6">{myEntry.score.toFixed(0)} Punkte</p>
          )}
          <a href="/leaderboard" className="block w-full bg-gradient-to-r from-cb-primary to-cb-accent text-white font-bold py-3 px-6 rounded-xl">
            Rangliste 🏆
          </a>
        </div>
      </div>
    );
  }

  if (!currentQuestion) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 flex items-center justify-center">
        <div className="text-white/70 text-xl">Laden...</div>
      </div>
    );
  }

  const resultVotesWithCorrect = result
    ? result.votes.map(v => ({ ...v, correct: v.correct }))
    : [];

  const ownResult = result?.votes.find(v => v.playerId === playerId);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{emoji}</span>
            <span className="font-bold text-white">{nickname}</span>
          </div>
          <div className="text-white/60 text-sm">
            Frage {currentQuestionIndex + 1} / {totalQuestions}
          </div>
          {gamePhase === 'question' && (
            <div className={`text-sm font-mono font-bold px-3 py-1 rounded-full ${
              timeLeft < 30 ? 'bg-red-500/30 text-red-300' : 'bg-white/10 text-white/70'
            }`}>
              {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
            </div>
          )}
        </div>

        {/* Question text */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-4 border border-white/20">
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2 py-0.5 bg-cb-primary/30 text-cb-accent text-xs font-semibold rounded-full">
              {currentQuestion.category}
            </span>
            <span className="px-2 py-0.5 bg-white/10 text-white/50 text-xs font-mono rounded-full">
              {currentQuestion.difficulty}
            </span>
          </div>
          <h2 className="text-xl font-bold text-white">{currentQuestion.question}</h2>

          {gamePhase === 'question' && (
            <p className="text-white/50 text-sm mt-3">
              {ownVote
                ? `Gewählt: ${currentQuestion.options.find(o => o.id === ownVote.answerId)?.text} (${['Unsicher', 'Sicher', 'Sehr sicher'][ownVote.confidenceZone - 1]})`
                : 'Klicke auf die richtige Antwort — näher an den Rand = sicherer'}
            </p>
          )}
        </div>

        {/* Grid */}
        <div ref={gridContainerRef} className="relative mb-4">
          <ConfidenceGrid
            options={currentQuestion.options}
            disabled={gamePhase !== 'question'}
            ownPlayerId={playerId}
            ownEmoji={emoji}
            ownVote={ownVote}
            otherVotes={gamePhase === 'question' ? otherVotes : resultVotesWithCorrect.filter(v => v.playerId !== playerId)}
            onVote={handleVote}
          />
          {/* Reveal overlay */}
          {(gamePhase === 'reveal') && result && (
            <TrainingReveal
              correctAnswerId={result.correctAnswerId}
              options={currentQuestion.options}
              votes={resultVotesWithCorrect}
              containerRef={gridContainerRef}
              onComplete={handleRevealComplete}
            />
          )}
        </div>

        {/* Result detail (after reveal animation) */}
        {gamePhase === 'result' && result && (
          <div className={`bg-white/10 backdrop-blur-lg rounded-2xl p-6 border-2 ${
            ownResult?.correct ? 'border-green-400/40' : ownResult ? 'border-red-400/40' : 'border-white/20'
          }`}>
            {ownResult ? (
              <div className="flex items-center gap-3 mb-4">
                <span className="text-3xl">{ownResult.correct ? '✅' : '❌'}</span>
                <div>
                  <p className={`font-bold text-lg ${ownResult.correct ? 'text-green-300' : 'text-red-300'}`}>
                    {ownResult.correct ? `Richtig! +${ownResult.pointsAwarded} Punkte` : 'Falsch'}
                  </p>
                  {ownResult.correct && (
                    <p className="text-white/50 text-sm">
                      Multiplikator: ×{ownResult.confidenceZone === 1 ? '1.0' : ownResult.confidenceZone === 2 ? '1.5' : '2.0'}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-white/50 mb-4">Du hast nicht abgestimmt.</p>
            )}
            <div className="text-sm text-white/80">
              <MarkdownText>{result.question.explanation}</MarkdownText>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Commit**

```bash
git add client/src/pages/TrainingGameSession.tsx
git commit -m "feat: add TrainingGameSession player page"
```

---

## Task 10: `GameSession.tsx` — routing update

**Files:**
- Modify: `client/src/pages/GameSession.tsx`

- [ ] **Add import** after `BuzzerGameSession` import (around line 8):

```typescript
import { TrainingGameSession } from './TrainingGameSession';
```

- [ ] **Update `SessionData` type** — change `gameMode` field (around line 33):

```typescript
gameMode: 'racing' | 'buzzer' | 'training';
```

- [ ] **Add training branch** after the buzzer routing block (around line 351–361):

```typescript
  if (sessionData.gameMode === 'training') {
    return (
      <TrainingGameSession
        sessionCode={code!}
        totalQuestions={sessionData.totalQuestions}
        playerId={playerId}
        nickname={nickname}
        emoji={emoji}
      />
    );
  }
```

- [ ] **Update join screen label** — find the `isBuzzerMode` logic for the emoji/label in the join form (around line 289) and extend:

```typescript
  const isBuzzerMode = sessionData.gameMode === 'buzzer';
  const isTrainingMode = sessionData.gameMode === 'training';
  // ...
  // In JSX, update the emoji and label:
  // {isBuzzerMode ? '🔔' : isTrainingMode ? '🧠' : '🏎️'}
  // {isBuzzerMode ? 'Buzzer-Modus' : isTrainingMode ? 'Team Training' : 'Racing-Modus'}
```

- [ ] **Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Commit**

```bash
git add client/src/pages/GameSession.tsx
git commit -m "feat: route training game mode to TrainingGameSession"
```

---

## Task 11: `DozentPanel.tsx` — training mode UI and controls

**Files:**
- Modify: `client/src/components/dozent/DozentPanel.tsx`

This is the largest UI change. Four sub-steps:

**11a — Type and state**

- [ ] **Update `GameMode` type** (line 51):

```typescript
type GameMode = 'racing' | 'buzzer' | 'training';
```

- [ ] **Update `Session` interface** `gameMode` field (line 24):

```typescript
gameMode: 'racing' | 'buzzer' | 'training';
```

- [ ] **Add training game status state** alongside `gameStatus`:

```typescript
const [trainingVoteCount, setTrainingVoteCount] = useState<{ voted: number; total: number } | null>(null);
```

**11b — Socket listeners for training**

- [ ] **Add training socket listeners** in the `useEffect` that handles `sessionCode` (after the existing buzzer listeners, before the return cleanup). Add inside the effect and clean up in the return:

```typescript
    const handleTrainingVoteCount = (data: { voted: number; total: number }) => {
      setTrainingVoteCount(data);
    };

    const handleTrainingQuestion = (data: any) => {
      setGameStatus(prev => ({
        ...prev!,
        gameState: 'question',
        currentQuestionIndex: data.questionIndex,
        totalQuestions: data.totalQuestions,
        currentAnswerer: undefined,
        buzzes: [],
      }));
      setGameStarted(true);
      setTrainingVoteCount(null);
    };

    const handleTrainingResult = (data: any) => {
      setGameStatus(prev => ({ ...prev!, gameState: 'result' }));
      if (data.leaderboard) {
        setJoinedPlayers(data.leaderboard.map((p: any) => ({
          playerId: p.playerId || p.nickname,
          nickname: p.nickname,
          emoji: p.emoji,
          score: p.score,
        })));
      }
    };

    const handleTrainingTransition = (data: any) => {
      setGameStatus(prev => ({ ...prev!, gameState: 'transition', currentQuestionIndex: data.nextQuestionIndex >= 0 ? data.nextQuestionIndex - 1 : prev?.currentQuestionIndex ?? 0 }));
      if (data.leaderboard) {
        setJoinedPlayers(data.leaderboard.map((p: any) => ({
          playerId: p.playerId || p.nickname,
          nickname: p.nickname,
          emoji: p.emoji,
          score: p.score,
        })));
      }
    };

    const handleTrainingGameOver = (data: any) => {
      setGameStatus(prev => ({ ...prev!, gameState: 'finished' }));
      if (data.leaderboard) {
        setJoinedPlayers(data.leaderboard.map((p: any) => ({
          playerId: p.playerId || p.nickname,
          nickname: p.nickname,
          emoji: p.emoji,
          score: p.score,
        })));
      }
    };

    socket.on('training-vote-count', handleTrainingVoteCount);
    socket.on('training-question', handleTrainingQuestion);
    socket.on('training-result', handleTrainingResult);
    socket.on('training-transition', handleTrainingTransition);
    socket.on('training-game-over', handleTrainingGameOver);
```

And in the cleanup return:
```typescript
      socket.off('training-vote-count', handleTrainingVoteCount);
      socket.off('training-question', handleTrainingQuestion);
      socket.off('training-result', handleTrainingResult);
      socket.off('training-transition', handleTrainingTransition);
      socket.off('training-game-over', handleTrainingGameOver);
```

Also update the join/get-state call at the bottom of that effect to also request training state:
```typescript
      // After existing buzzer-get-state:
      if (createdGameMode === 'training') {
        socket.emit('training-get-state', sessionCode);
      }
```

**11c — Training handler functions**

- [ ] **Add training handler functions** after `handleEndGame`:

```typescript
  const handleStartTrainingGame = () => {
    if (!socket || !sessionCode) return;
    socket.emit('training-start-game', sessionCode);
    setGameStarted(true);
  };

  const handleCloseTrainingRound = () => {
    if (!socket || !sessionCode) return;
    socket.emit('training-close-round', sessionCode);
  };

  const handleForceNextTrainingQuestion = () => {
    if (!socket || !sessionCode) return;
    socket.emit('training-force-next', sessionCode);
  };

  const handleEndTrainingGame = () => {
    if (!socket || !sessionCode) return;
    if (confirm('Spiel wirklich beenden?')) {
      socket.emit('training-force-end', sessionCode);
    }
  };
```

**11d — JSX changes**

- [ ] **Add training card to game mode selection grid** (after the buzzer button, around line 578). Change the grid from `grid-cols-2` to `grid-cols-3` (or add a third card below — match existing style):

```tsx
                      <button
                        type="button"
                        onClick={() => setGameMode('training')}
                        className={`p-4 rounded-xl border-2 transition-all text-left ${
                          gameMode === 'training'
                            ? 'border-teal-400 bg-teal-500/30 shadow-lg'
                            : 'border-white/20 bg-white/5 hover:border-white/40'
                        }`}
                      >
                        <div className="text-3xl mb-2">🧠</div>
                        <div className="font-bold text-white">Team Training</div>
                        <div className="text-sm text-white/60 mt-1">
                          Gemeinsam abstimmen mit Konfidenz-Tipp.
                        </div>
                      </button>
```

- [ ] **Update session icon/label** in active session header (around line 659) to handle `'training'`:

```tsx
// Find the emoji selection:
{createdGameMode === 'buzzer' ? '🔔' : '🏎️'}
// Change to:
{createdGameMode === 'buzzer' ? '🔔' : createdGameMode === 'training' ? '🧠' : '🏎️'}

// Find the mode label:
{createdGameMode === 'buzzer' ? 'Buzzer-Modus' : 'Racing-Modus'}
// Change to:
{createdGameMode === 'buzzer' ? 'Buzzer-Modus' : createdGameMode === 'training' ? 'Team Training' : 'Racing-Modus'}
```

- [ ] **Add training game controls block** after the existing buzzer controls block (find the `createdGameMode === 'buzzer' && gameStatus &&` block and add after):

```tsx
                  {/* Training Mode Controls */}
                  {createdGameMode === 'training' && (
                    <div className="space-y-3">
                      {!gameStarted ? (
                        <button
                          onClick={handleStartTrainingGame}
                          className="w-full bg-teal-600 hover:bg-teal-500 text-white font-bold py-3 rounded-xl transition-all"
                        >
                          🧠 Spiel starten
                        </button>
                      ) : (
                        <>
                          {gameStatus && gameStatus.gameState === 'question' && (
                            <div className="space-y-3">
                              {trainingVoteCount && (
                                <div className="p-3 bg-white/5 rounded-xl text-center">
                                  <span className="text-white font-bold text-2xl">{trainingVoteCount.voted}</span>
                                  <span className="text-white/50"> / {trainingVoteCount.total} haben abgestimmt</span>
                                </div>
                              )}
                              <button
                                onClick={handleCloseTrainingRound}
                                className="w-full bg-cb-primary hover:bg-cb-accent text-white font-bold py-3 rounded-xl transition-all"
                              >
                                Runde schließen
                              </button>
                            </div>
                          )}
                          {gameStatus && (gameStatus.gameState === 'result' || gameStatus.gameState === 'transition') && (
                            <button
                              onClick={handleForceNextTrainingQuestion}
                              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-all"
                            >
                              Nächste Frage →
                            </button>
                          )}
                          <button
                            onClick={handleEndTrainingGame}
                            className="w-full bg-red-600/70 hover:bg-red-600 text-white font-bold py-3 rounded-xl transition-all"
                          >
                            Spiel beenden
                          </button>
                        </>
                      )}
                    </div>
                  )}
```

- [ ] **Update `handleCreateSession` button label** to include training icon. Find line ~648:
```tsx
// change:
`${gameMode === 'buzzer' ? '🔔' : '🏎️'} Session starten`
// to:
`${gameMode === 'buzzer' ? '🔔' : gameMode === 'training' ? '🧠' : '🏎️'} Session starten`
```

- [ ] **Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Commit**

```bash
git add client/src/components/dozent/DozentPanel.tsx
git commit -m "feat: add training mode UI and controls to DozentPanel"
```

---

## Task 12: Build and smoke test

- [ ] **Build server**

```bash
cd server && npm run build
# expected: no errors
```

- [ ] **Build client**

```bash
cd client && npm run build
# expected: no errors
```

- [ ] **Start server and verify**

```bash
cd server && npm start
```

Open `http://localhost:5173` (or wherever the dev server runs). In the dozent panel:
1. Create a Training session
2. Open player tab, join with a nickname
3. Dozent starts the game — confirm question appears on player screen
4. Player clicks a quadrant — confirm own emoji appears at click position
5. Open second player tab — confirm other player's emoji appears on first tab in real time
6. Dozent clicks "Runde schließen" — confirm reveal animation fires, correct quadrant glows, wrong ones darken
7. Result screen shows points + explanation
8. Dozent clicks "Nächste Frage" — confirm transition screen appears and advances
9. Finish all questions — confirm game-over screen

- [ ] **Commit any fixes**

---

## Task 13: Final commit on branch

- [ ] **Final status check**

```bash
git log --oneline feature/team-training
```

Expected commits (roughly):
- feat: add training to sessions game_mode CHECK constraint
- feat: extend GameMode type with training
- feat: add trainingGame server module
- feat: add training socket event handlers
- feat: accept training gameMode in session creation, filter 4-option questions
- feat: add ConfidenceGrid component
- feat: add TrainingReveal canvas animation component
- feat: add TrainingGameSession player page
- feat: route training game mode to TrainingGameSession
- feat: add training mode UI and controls to DozentPanel
