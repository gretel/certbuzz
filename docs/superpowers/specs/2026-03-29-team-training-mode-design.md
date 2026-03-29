# Team Training Mode — Design Spec

**Date:** 2026-03-29  
**Status:** approved  
**Scope:** new game mode `training` added alongside `racing` and `buzzer`

---

## Overview

Team Training is a relaxed, reflection-oriented quiz mode. The dozent controls pace: they open a round (show a question), players study the options and place a confidence-weighted "bet" by clicking a quadrant on a split-screen rectangle, then the dozent closes the round to reveal the correct answer and award points. Players may re-click at any time before the round closes.

Key differences from other modes:
- no automatic timer pressure (generous 3-minute client-side max, dozent closes manually)
- confidence mechanic adds strategy — unsure clicks earn less than confident ones
- all players answer simultaneously (no buzzer queue)
- real-time emoji heatmap shows where others are placing their bets (promotes discussion)

---

## Data Layer

### DB schema changes

`schema.ts` needs two CHECK constraints updated (via migration):

```sql
game_mode TEXT NOT NULL DEFAULT 'racing'
  CHECK(game_mode IN ('racing', 'buzzer', 'training'))

game_state TEXT DEFAULT 'lobby'
  CHECK(game_state IN ('lobby', 'question', 'enrolling', 'answering', 'result', 'finished'))
```

`game_state` values are reused unchanged — `training` mode uses: `lobby → question → result → finished`.

`queries.ts` type:
```ts
export type GameMode = 'racing' | 'buzzer' | 'training';
```

No new columns required.

---

## Server

### New file: `server/src/socket/trainingGame.ts`

In-memory state per active session:

```ts
interface TrainingVote {
  playerId: string;
  emoji: string;
  answerId: string;
  confidenceZone: 1 | 2 | 3;   // 1=unsure 1x, 2=medium 1.5x, 3=confident 2x
  clickX: number;               // normalized 0-1 within the full rectangle
  clickY: number;
}

interface TrainingGameState {
  sessionCode: string;
  votes: Map<string, TrainingVote>;  // keyed by playerId (last vote wins)
  timers: { roundTimeout?: NodeJS.Timeout; transitionTimeout?: NodeJS.Timeout };
}
```

Exposed functions (same shape as `buzzerGame.ts`):
- `initTrainingGame(sessionCode)`
- `getTrainingGame(sessionCode)`
- `cleanupTrainingGame(sessionCode)`
- `startTrainingGame(io, sessionCode)`
- `closeTrainingRound(io, sessionCode)` — awards points, broadcasts result
- `forceNextTrainingQuestion(io, sessionCode)`
- `forceEndTrainingGame(io, sessionCode)`
- `getTrainingGameState(sessionCode)` — for reconnect

### Socket events added to `events.ts`

| Origin | Event | Payload |
|--------|-------|---------|
| dozent | `training-start-game` | `sessionCode` |
| dozent | `training-close-round` | `sessionCode` |
| dozent | `training-force-next` | `sessionCode` |
| dozent | `training-force-end` | `sessionCode` |
| player | `training-join-session` | `{ sessionCode, playerId }` |
| player | `training-vote` | `{ sessionCode, playerId, answerId, confidenceZone, clickX, clickY }` |
| server | `training-question` | same shape as buzzer `buzzer-question` minus `buzzTimeoutMs`; fields: `{ questionIndex, totalQuestions, question: { id, category, type, difficulty, question, options } }` |
| server | `training-vote-update` | `{ playerId, emoji, answerId, confidenceZone, clickX, clickY }` |
| server | `training-result` | see `TrainingResultPayload` below |
| server | `training-transition` | `{ nextQuestionIndex, nextQuestionIn: 20000, transitionStartedAt, isGameOver, leaderboard }` — client shows a 20-second countdown then auto-advances (dozent `training-force-next` skips it early) |
| server | `training-game-over` | `{ leaderboard }` |

Dozent panel also receives `training-vote-count` on each vote: `{ voted: number, total: number }` — so it can show X/Y without revealing which answer.

`TrainingResultPayload`:
```ts
interface TrainingResultPayload {
  correctAnswerId: string;
  question: { id: string; options: Array<{ id: string; text: string }>; explanation: string; references?: string[] };
  votes: Array<{
    playerId: string;
    nickname: string;
    emoji: string;
    answerId: string;
    confidenceZone: 1 | 2 | 3;
    clickX: number;
    clickY: number;
    correct: boolean;
    pointsAwarded: number;
  }>;
  leaderboard: Array<{ playerId: string; nickname: string; emoji: string; score: number }>;
}
```

### Scoring (on `closeTrainingRound`)

```
base = difficulty === 'easy' ? 500 : difficulty === 'hard' ? 1500 : 1000
multiplier = zone === 1 ? 1.0 : zone === 2 ? 1.5 : 2.0
points = correct ? Math.round(base * multiplier) : 0
```

Persisted via existing `queries.updatePlayerScore` and `queries.saveAnswer`.

---

## Client

### Routing

`GameSession.tsx` already branches on `gameMode`. Add:

```tsx
if (sessionData.gameMode === 'training') {
  return <TrainingGameSession ... />;
}
```

Also update join screen to show `🧠 Team Training` label for training mode.

### New files

#### `client/src/pages/TrainingGameSession.tsx`

Top-level player component. Owns socket lifecycle and state machine:

```
lobby → (training-question) → question → (training-result) → result
      ↓                                                        ↓
  (training-game-over)                               (training-transition)
      ↓                                                        ↓
  finished                                            question (next) / finished
```

Renders:
- lobby: waiting screen
- question: `<ConfidenceGrid>` + question text above + timer countdown (3 min max)
- result: result overlay, then transitions
- finished: game over, leaderboard link

#### `client/src/components/game/ConfidenceGrid.tsx`

The interactive 4-quadrant surface. Props:
```ts
interface ConfidenceGridProps {
  options: Array<{ id: string; text: string }>;   // exactly 4
  disabled: boolean;
  ownEmoji: string;
  ownVote: Vote | null;
  otherVotes: Vote[];                              // realtime from socket
  onVote: (answerId: string, zone: 1|2|3, clickX: number, clickY: number) => void;
}
```

Layout and behavior:
- Outer `div` with `position: relative`, 4:3 aspect ratio, `cursor: crosshair`
- CSS grid 2×2 child divs, each filling one quadrant
- Colors: top-left=blue, top-right=green, bottom-left=orange, bottom-right=purple — each as `radial-gradient` toward center (lighter) → edges (richer)
- Confidence zone detection on `mousemove`: compute `dist = Math.hypot((x - cx)/w, (y - cy)/h)` where `cx,cy` is center of full rectangle, `w,h` its size. Normalized `dist` maps to zone (0–0.33→1, 0.33–0.66→2, 0.66→1.0→3)
- Zone label overlay: absolutely positioned at top of hovered quadrant, shows "Unsicher / Sicher / Sehr sicher" with corresponding opacity/color
- On click: call `onVote`, place own emoji badge at click coords (absolutely positioned, labeled "Du")
- `otherVotes` rendered as emoji badges at their stored `(clickX, clickY)` coords, sized smaller than own; update in place when vote changes
- When `disabled=true`: no hover, no click, cursor default; emoji positions remain visible

#### `client/src/components/game/TrainingReveal.tsx`

A `<canvas>` absolutely overlaid on `ConfidenceGrid` at `z-index: 10`. Receives:
```ts
interface TrainingRevealProps {
  correctAnswerId: string;
  options: Array<{ id: string; text: string }>;
  votes: Vote[];                     // full set for distribution display
  active: boolean;                   // mounts/unmounts with result phase
}
```

Animation sequence (plain 2D canvas, `requestAnimationFrame`):
1. t=0–500ms: fade in dark overlay over wrong quadrants (alpha 0→0.55)
2. t=200–800ms: radial particle burst from center of correct quadrant (40–60 small circles, random velocities outward, fade out)
3. t=300–1200ms: pulsing glow ring around correct quadrant border (sinusoidal scale, accent color)
4. t=800ms+: player emoji dots shift to green (correct) / red (wrong) fill behind emoji text
5. t=3000ms: canvas fades out, component signals parent to show result detail screen

Canvas is sized to match the grid element via `ResizeObserver`.

### Dozent panel additions

`DozentPanel.tsx`: `GameMode` type gets `'training'`. New section in the session creation UI: "Team Training" option alongside Racing/Buzzer.

During an active training session, the dozent panel shows:
- current question index / total
- vote count badge: "X / Y haben abgestimmt" (no answer breakdown)
- "Runde schließen" button → emits `training-close-round`
- "Nächste Frage" button (enabled after round closed) → emits `training-force-next`
- "Spiel beenden" button → emits `training-force-end`

---

## Constraints

- Only single-choice questions with exactly 4 options are eligible for training mode. Question bank filtering happens at session creation in `DozentPanel` (same pattern as existing category filters). If a loaded session somehow has a non-4-option question, `TrainingGameSession` shows an error card and the dozent's "Nächste Frage" skips it.
- No speed bonus (unlike buzzer mode) — confidence zone is the only modifier.
- Players who do not vote receive 0 points; this is displayed explicitly in the result screen.
