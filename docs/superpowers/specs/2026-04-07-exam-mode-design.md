# Exam Mode — Design Spec

**Date:** 2026-04-07
**Status:** approved
**Scope:** new game mode `exam` added alongside `racing`, `buzzer`, and `training`. First certification supported: **AWS CLF-C02** (Cloud Practitioner).

---

## Overview

Exam Mode is a solo, timed, realistic certification simulation. A dozent creates an exam session via a one-click preset; a player joins the 6-digit code, clicks "Prüfung starten", and works through a fixed 65-question exam with a 90-minute countdown. Unlike the existing modes, the player gets **no per-question feedback** — answers are recorded silently, and the results screen at the end shows a scaled 100–1000 score, pass/fail, per-domain breakdown, and a full review of every question with explanations.

Key differences from other modes:

- **Hidden feedback during the exam.** No green/red highlights, no explanation text, no sounds, no leaderboard updates. Full review only at the end.
- **Per-player wall-clock timer**, anchored to `players.exam_started_at` on the server. Survives tab closes, reconnects, device switches.
- **Sequential, locked answers.** Once "Nächste Frage" is clicked the answer is recorded and the player moves on. No going back. No flagging.
- **Soft timer expiry.** When the 90 minutes run out the timer turns red and counts negative; the player decides when to submit. (Intentional — the "auto-submit on zero" behaviour was explicitly rejected.)
- **Resumable.** A student closing their laptop mid-exam can return to the same session/nickname and continue from the exact question they were on, with the timer correctly reflecting elapsed wall-clock time.
- **Proportional domain sampling.** 65 questions are drawn from the 134-question CLF-C02 bank using the largest-remainder (Hare quota) method against the AWS official domain weights: **16 Concepts / 19 Security / 22 Tech / 8 Billing** = 65.
- **Scaled scoring.** Raw `correct/total` is mapped linearly to the 100–1000 scale (passing score 700, matching the real CLF-C02).

Game state stays in `'lobby'` throughout — exam mode has no central state machine; each player progresses independently like racing mode but with strict feedback suppression.

---

## Data Layer

### DB schema changes

Two migrations in `server/src/db/schema.ts`, both following the pattern established by the training-mode migration at `schema.ts:128–156` (CREATE new table → copy data → drop old → rename).

**Migration 1: add `'exam'` to `sessions.game_mode` CHECK constraint.**

```sql
game_mode TEXT NOT NULL DEFAULT 'racing'
  CHECK(game_mode IN ('racing', 'buzzer', 'training', 'exam'))
```

**Migration 2: add `exam_started_at` column to `players`.**

```sql
ALTER TABLE players ADD COLUMN exam_started_at INTEGER;  -- nullable; ms epoch
```

Guarded by a `PRAGMA table_info(players)` check (same pattern as the `question_bank` column migration at `schema.ts:85–95`).

### Type changes

`server/src/db/queries.ts`:

```ts
export type GameMode = 'racing' | 'buzzer' | 'training' | 'exam';

interface Player {
  // ...existing fields
  examStartedAt?: number | null;   // ms epoch — set when player clicks "Prüfung starten"
}
```

### New query helpers (`queries.ts`)

```ts
queries.setExamStartedAt(playerId: string): void
  // UPDATE players SET exam_started_at = strftime('%s','now') * 1000 WHERE player_id = ? AND exam_started_at IS NULL
  // Idempotent — no-op if already set

queries.advanceExamPlayer(playerId: string): void
  // UPDATE players SET current_question = current_question + 1, last_activity = ? WHERE player_id = ?

queries.markPlayerFinished(playerId: string, finalScore: number): void
  // UPDATE players SET finished_at = ?, score = ? WHERE player_id = ?

queries.getPlayerAnswers(playerId: string): PlayerAnswer[]
  // SELECT * FROM player_answers WHERE player_id = ? ORDER BY answered_at ASC

queries.getPlayerAnswerByQuestion(playerId: string, questionId: string): PlayerAnswer | undefined
  // SELECT * FROM player_answers WHERE player_id = ? AND question_id = ?
  // Used for idempotent answer submission (resume / double-submit protection)
```

---

## Question Bank Metadata

Extend the `meta.exam` block in `questions/clf-c02-complete.json` (data-only change, no code migration). The existing `passPercent`, `totalQuestions`, and `info` fields stay for backwards compatibility with the racing-mode end screen.

```json
{
  "meta": {
    "exam": {
      "passPercent": 70,
      "totalQuestions": 65,
      "durationMinutes": 90,
      "passingScore": 700,
      "scaleMin": 100,
      "scaleMax": 1000,
      "domains": [
        {
          "id": "concepts",
          "label": "Cloud Concepts",
          "weight": 24,
          "categories": ["cloud-concepts", "cloud-economics", "well-architected"]
        },
        {
          "id": "security",
          "label": "Security and Compliance",
          "weight": 30,
          "categories": ["shared-responsibility", "iam", "security-services", "compliance-governance"]
        },
        {
          "id": "tech",
          "label": "Cloud Technology and Services",
          "weight": 34,
          "categories": ["global-infra-compute", "storage-databases", "networking", "services-ml", "advanced-networking"]
        },
        {
          "id": "billing",
          "label": "Billing, Pricing, and Support",
          "weight": 12,
          "categories": ["billing-pricing", "support-resources"]
        }
      ],
      "info": "..."
    }
  }
}
```

**`gap-topics` is intentionally excluded** from exam selection — those questions are supplementary filler and don't map to any official AWS domain.

### TypeScript types (`server/src/questions/questionBank.ts`)

```ts
export interface ExamDomain {
  id: string;
  label: string;
  weight: number;      // 0–100, weights across all domains must sum to 100
  categories: string[];
}

export interface ExamInfo {
  passPercent: number;
  totalQuestions: number;
  durationMinutes?: number;  // optional — racing mode doesn't need it
  passingScore?: number;     // optional
  scaleMin?: number;         // optional, defaults to 100
  scaleMax?: number;         // optional, defaults to 1000
  domains?: ExamDomain[];    // optional — if absent, bank cannot be used in exam mode
  info: string;
}
```

Optional fields mean the existing `azure-az104.json` keeps working unchanged; it just can't be used in exam mode until its metadata is extended.

---

## Question Sampling

New helper in `server/src/questions/questionBank.ts`:

```ts
export function sampleExamQuestions(bankId: string): string[]
```

**Algorithm** (largest-remainder / Hare quota method):

1. Load the bank's `exam.domains` and `exam.totalQuestions`.
2. For each domain, collect all questions whose `category` is in `domain.categories`, shuffle.
3. Compute the exact quota `q_i = totalQuestions * weight_i / 100` for each domain.
4. Take `floor(q_i)` for each domain as the base count.
5. Distribute the remainder (`totalQuestions - Σ floor(q_i)`) by giving `+1` to the domains with the largest fractional parts, tie-broken by declaration order.
6. From each domain's shuffled pool, take the first N questions.
7. If a domain pool is smaller than its quota, take all of it and add the shortfall to a global remainder pool of unused questions from other domains.
8. Final shuffle across domains so the exam order isn't clumped by topic.
9. Return the list of 65 question IDs.

**Worked example for CLF-C02** (weights 24/30/34/12, total 65):

| Domain | Exact | Floor | Remainder | +1? | Final |
|---|---|---|---|---|---|
| Concepts | 15.60 | 15 | 0.60 | ✓ | 16 |
| Security | 19.50 | 19 | 0.50 |  | 19 |
| Tech | 22.10 | 22 | 0.10 |  | 22 |
| Billing | 7.80 | 7 | 0.80 | ✓ | 8 |
| **Total** | **65.00** | **63** | — | **+2** | **65** |

### Helper function

```ts
function computeProportionalCounts(
  domains: ExamDomain[],
  total: number
): Record<string, number>
```

Pure function, unit-testable. Takes the domain list and total count, returns `{ domainId: count }` summing to `total`.

---

## Server Module: `examGame.ts`

New file at `server/src/socket/examGame.ts`, ~150 lines. Mirrors the structure of `trainingGame.ts` but is **much lighter** because exam mode has no per-question state machine — players progress independently, state lives in the `players` and `player_answers` tables, no in-memory game state map.

### Exported functions

```ts
/**
 * Record a single exam answer.
 * - Idempotent: if the player already answered this question, returns
 *   { ok: true, alreadyAnswered: true } without advancing or double-counting.
 * - Does NOT echo correctness to the client.
 * - Does NOT emit leaderboard updates.
 */
export function submitExamAnswer(
  payload: { sessionCode: string; playerId: string; questionId: string;
             selectedAnswers: string[]; timeSeconds: number }
): { ok: boolean; alreadyAnswered?: boolean; error?: string }

/**
 * Finalize the exam for a player.
 * - Computes correctCount, percentage, scaled score, pass/fail
 * - Computes per-domain breakdown
 * - Persists the scaled score to players.score and sets finished_at
 * - Returns the full review payload (for immediate display)
 */
export function finalizeExam(playerId: string): ExamResultsPayload

/**
 * Read-only version of finalizeExam — used by the client on page reload
 * after submission, or if the player wants to re-view their results.
 */
export function getExamResults(playerId: string): ExamResultsPayload
```

### Result payload shape

```ts
export interface ExamResultsPayload {
  scaled: number;           // 100–1000
  percentage: number;       // 0–100
  correctCount: number;
  totalQuestions: number;
  passed: boolean;
  passingScore: number;
  durationMinutes: number;
  elapsedSeconds: number;   // from exam_started_at to finished_at
  byDomain: Array<{
    id: string;
    label: string;
    total: number;
    correct: number;
  }>;
  review: Array<{
    question: Question;          // full question WITH correctAnswers for review
    selectedAnswers: string[];
    correct: boolean;
    timeSeconds: number;
  }>;
}
```

### Scoring formula

```ts
const scaled = Math.round(
  scaleMin + (correctCount / totalQuestions) * (scaleMax - scaleMin)
);
// For CLF-C02: 0% → 100, 100% → 1000
// 70% → 730 (pass), 65% → 685 (fail), 80% → 820, etc.
```

The 700 passing score corresponds to approximately **67.7% correct** (44/65), slightly below the intuitive "70%" threshold — matching AWS's own approximate scaling.

### Idempotency

`submitExamAnswer` checks `queries.getPlayerAnswerByQuestion(playerId, questionId)` before inserting. If an entry exists, the function returns `{ ok: true, alreadyAnswered: true }` without advancing `current_question` or saving a new row. This handles:

- Flaky networks where a client retries after the server already recorded the answer
- Tab reopens where the client doesn't know what has been sent
- Double-clicks on "Nächste Frage"

The client is **still responsible** for not sending duplicate question answers on purpose — the server treats resubmission as a no-op, not as "update your answer".

---

## REST Endpoints

### New endpoints in `server/src/routes/player.ts`

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/player/:playerId/exam-state` | Resume payload — see shape below |
| `POST` | `/api/player/:playerId/exam-start` | Set `exam_started_at = Date.now()` if not already set; returns `{ examStartedAt }` |
| `POST` | `/api/player/:playerId/exam-submit` | Call `finalizeExam(playerId)`, return `ExamResultsPayload` |
| `GET` | `/api/player/:playerId/exam-review` | Call `getExamResults(playerId)`, return `ExamResultsPayload` (read-only) |

### `GET /api/player/:playerId/exam-state` response

```ts
{
  examStartedAt: number | null;   // ms epoch, null if not started
  currentQuestion: number;        // 0-indexed, matches players.current_question
  finishedAt: number | null;      // ms epoch, null if not submitted
  totalQuestions: number;         // from session
  durationMinutes: number;        // from bank exam metadata
}
```

This is the single endpoint the client polls on mount to decide which sub-stage of the exam UI to render.

### Modified endpoint: `POST /api/dozent/create-session`

Current validator at `routes/dozent.ts:21` checks:
```ts
if (!Number.isInteger(totalQuestions) || totalQuestions < 5 || totalQuestions > 50)
```

Changes:
- **Bump max from 50 → 200** (unconditional, so manual 65-question sessions aren't blocked either).
- **Accept `gameMode === 'exam'`** — when set, the body's `totalQuestions` and `categories` fields are **ignored**, and the server calls `sampleExamQuestions(questionBank)` to fill `question_ids`. The resulting count is whatever the bank's `meta.exam.totalQuestions` says (65 for CLF-C02).
- **Validate** that the chosen bank has a `meta.exam.domains` block when exam mode is requested, else return `400 bad request` with a clear error.
- **Bank validation** — for v1, only `clf-c02-complete` has exam metadata; any other bank with `gameMode: 'exam'` will be rejected.

---

## Socket Events

### New event: `submit-exam-answer`

Registered in `server/src/socket/events.ts` alongside the existing `submit-answer` handler (racing-mode). Payload shape identical to `submit-answer`:

```ts
{
  sessionCode: string;
  playerId: string;
  questionId: string;
  selectedAnswers: string[];
  timeSeconds: number;
}
```

Handler:
1. Loads session; verifies `gameMode === 'exam'`.
2. Calls `examGame.submitExamAnswer(payload)`.
3. Emits **acknowledgement only** back to the same socket: `exam-answer-ack` `{ ok, alreadyAnswered? }`.
4. Does **not** broadcast to the room, does **not** update leaderboard, does **not** include `correct` in the ack.

No other new socket events — exam mode is REST-heavy because there's no real-time collaboration.

---

## Client: `ExamGameSession.tsx`

New page at `client/src/pages/ExamGameSession.tsx` (~400 lines). Mirrors `TrainingGameSession.tsx` in shape but with simpler state (no live vote maps, no heatmap, no server-pushed state transitions).

### Route dispatcher

In `client/src/pages/GameSession.tsx` around line 354 (where buzzer/training dispatch happens):

```tsx
if (sessionData.gameMode === 'exam') {
  return (
    <ExamGameSession
      sessionData={sessionData}
      playerId={playerId}
      nickname={nickname}
    />
  );
}
```

### Sub-stages

The component uses a local `stage` state: `'loading' | 'pre-exam' | 'in-progress' | 'submitting' | 'results'`.

#### `loading`

On mount, fetch `GET /api/player/:playerId/exam-state`. Based on the response:

- `finishedAt !== null` → fetch review, stage → `'results'`
- `examStartedAt !== null` → restore `currentQuestion`, stage → `'in-progress'`
- otherwise → stage → `'pre-exam'`

This is the resume entry point. **No client-side state persistence is needed** — server is the single source of truth. `sessionStorage.session_CODE_*` already persists the playerId across tab reopens.

#### `pre-exam`

Full-screen welcome card:

> **AWS CLF-C02 — Prüfungssimulation**
>
> - **65 Fragen**
> - **90 Minuten Zeit**
> - **Bestehen ab 700/1000** (≈ 44 richtig)
> - **Keine Erklärungen während der Prüfung** — Auswertung erst am Ende.
> - **Keine Rückkehr zu beantworteten Fragen.**
> - **Pause möglich** — du kannst das Fenster schließen und später weitermachen; die Zeit läuft weiter.
>
> [**Prüfung starten**]

Clicking the button → `POST /api/player/:playerId/exam-start` → stage → `'in-progress'` with the freshly-returned `examStartedAt`.

#### `in-progress`

Top bar (sticky):
- **Left**: `Frage N / 65` progress indicator + thin progress bar
- **Center**: countdown timer `MM:SS`, color-coded
- **Right**: `[Prüfung abgeben]` button (always visible, confirms via modal)

Body: renders the question from `sessionData.questions[currentQuestion]` using the existing `<SingleChoice>`, `<MultipleChoice>`, or `<OrderQuestion>` components. **The components are reused as-is** — no exam-mode variant needed. The key difference is what happens after submit:

1. Player selects answer(s)
2. Clicks "Nächste Frage" (or "Prüfung abgeben" if `currentQuestion === totalQuestions - 1`)
3. Client emits `submit-exam-answer` with `{ sessionCode, playerId, questionId, selectedAnswers, timeSeconds }` where `timeSeconds = (Date.now() - questionStartMs) / 1000`
4. Client awaits the `exam-answer-ack` (with a 5s timeout + retry-once fallback)
5. On ack, client advances `currentQuestion` by 1, resets `questionStartMs`, renders the next question — **no feedback shown**
6. If `currentQuestion >= totalQuestions`, stage → `'submitting'`

The timer is a local React hook `useExamTimer(examStartedAt, durationMinutes)`:

```ts
function useExamTimer(examStartedAt: number, durationMinutes: number) {
  const [remaining, setRemaining] = useState(() =>
    durationMinutes * 60 - (Date.now() - examStartedAt) / 1000
  );
  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(durationMinutes * 60 - (Date.now() - examStartedAt) / 1000);
    }, 500);
    return () => clearInterval(interval);
  }, [examStartedAt, durationMinutes]);
  return remaining;  // seconds, negative if expired
}
```

Display:
- `remaining > 300` (>5 min): **green** `MM:SS`
- `0 < remaining ≤ 300`: **orange** `MM:SS`
- `remaining ≤ 0`: **red** `-MM:SS` (counts negative)

**No auto-submit.** The player can keep answering past zero. They must click "Prüfung abgeben" to finish. (This is the explicit user choice — auto-submit was rejected.)

#### `submitting`

Spinner + "Prüfung wird ausgewertet...". Calls `POST /api/player/:playerId/exam-submit`. On success → stage → `'results'` with the returned payload.

#### `results`

Scrollable results page with three sections:

**Hero card** (top):
- Big scaled score: `720 / 1000`
- Pass/fail badge: `Bestanden` (green) or `Nicht bestanden` (red)
- Subtitle: `52 von 65 richtig — 80%`
- Time taken: `67 Minuten`

**Domain breakdown** (middle):
4 horizontal bars, one per domain:
```
Cloud Concepts                 14 / 16  (88%)  ████████████░░
Security and Compliance        15 / 19  (79%)  ███████████░░░
Cloud Technology and Services  16 / 22  (73%)  ██████████░░░░
Billing, Pricing, and Support   7 /  8  (88%)  ████████████░░
```

**Question review** (bottom, collapsible):
List of all 65 questions in order. Each is a collapsible card showing:
- Question number and category
- Question text (via `<MarkdownText>`)
- All options, with:
  - Correct answer(s) highlighted green
  - Player's incorrect selection(s) highlighted red
  - Unselected options in grey
- Explanation (via `<MarkdownText>`)
- References if any

Cards are initially collapsed; clicking expands. First-three-wrong are auto-expanded so the user immediately sees their biggest misses.

### Navigation lock

- No "Zurück" button.
- Browser back button: not intercepted. If the player hits it and navigates away, their answers are persisted server-side; they can return via `/session/CODE` and will resume at the correct question.
- If the player types the URL directly while `stage === 'in-progress'`, the resume path picks them up seamlessly.

### Arena view

`client/src/pages/BuzzerArena.tsx` shows a static "Prüfung läuft" placeholder if opened on an exam-mode session. The arena view is designed for classroom projection of buzzer/training rounds — not meaningful for solo exam mode. Low priority; may be left as the existing fallback.

### Home page icon

`client/src/pages/Home.tsx` adds a case for `gameMode === 'exam'` in the session card icon mapping — renders 🎓.

---

## Dozent Panel Preset

In `client/src/components/dozent/DozentPanel.tsx`, in the mode-selection area around lines 734–781 (currently showing racing / buzzer / training cards), add a fourth card:

```tsx
<button
  onClick={handleCreateExamSession}
  className="bg-yellow-600 hover:bg-yellow-500 text-white p-6 rounded-lg ..."
>
  <div className="text-4xl mb-2">🎓</div>
  <div className="font-bold text-lg">Prüfungssimulation</div>
  <div className="text-sm opacity-80 mt-1">
    AWS CLF-C02 · 65 Fragen · 90 Min
  </div>
</button>
```

Handler:

```ts
async function handleCreateExamSession() {
  const res = await fetch('/api/dozent/create-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dozent-Password': password,
    },
    body: JSON.stringify({
      gameMode: 'exam',
      questionBank: 'clf-c02-complete',
    }),
  });
  if (res.ok) {
    const { sessionCode } = await res.json();
    // Show the new session in the dozent panel session list as today
    await refreshSessions();
    toast(`Prüfungssimulation erstellt: ${sessionCode}`);
  }
}
```

The body intentionally omits `totalQuestions` and `categories`; the server fills them from the bank's exam metadata.

For v1, this card is **hardcoded to CLF-C02**. A future enhancement (out of scope) would iterate over all banks with `meta.exam.domains` and render one card per certification.

---

## Resumability Requirements

This is explicitly called out because a frustrated student closing their laptop mid-exam is the failure mode we're designing to avoid.

### What must survive a tab close / reload / device switch

| State | Persistence | Source of truth |
|---|---|---|
| Player identity (playerId, nickname, emoji) | `sessionStorage.session_CODE_*` | Existing mechanism |
| Exam started timestamp | `players.exam_started_at` (DB) | Server |
| Current question index | `players.current_question` (DB) | Server |
| Submitted answers | `player_answers` rows (DB) | Server |
| Timer remaining | Computed from `exam_started_at` + wall clock | Server + client derivation |
| Already finished? | `players.finished_at` + `players.score` (DB) | Server |
| Full review payload | Re-fetchable via `GET /exam-review` | Server |

**No client-side answer buffering.** Every answer is sent to the server before the client advances. This means the client never holds un-submitted exam state.

### Resume test cases (must all pass)

1. **Close tab mid-question** — reopen `/session/CODE` → auto-rejoin by nickname → land on the same `currentQuestion` → timer shows correct remaining (elapsed includes the closed-tab duration)
2. **Laptop sleep for 30 min** — wake, reload → same as above, timer 30 min lower
3. **Sleep past expiry** — wake after 95 min → timer shows `-5:00` red → player can still submit or continue
4. **Close tab after submitting** — reopen → goes straight to results (fetched via `/exam-review`)
5. **Different device with same nickname** — join session on phone → server reuses existing player row (existing behaviour in `routes/player.ts:9`) → exam state transfers
6. **Double-click "Nächste Frage"** — second click is a no-op (client disables the button during submission) and even if it reaches the server, `submitExamAnswer` is idempotent (`alreadyAnswered: true` response)
7. **Dozent deletes the session** — existing `session-deleted` socket event boots the player as today; no exam-specific handling needed

### Resume flow

```
Player opens /session/CODE
  ↓
GameSession.tsx fetches GET /api/session/:code
  ↓
Sees gameMode === 'exam'
  ↓
Renders <ExamGameSession />
  ↓
useEffect: fetches GET /api/player/:playerId/exam-state
  ↓
  ├─ finishedAt !== null      → fetch review → render results
  ├─ examStartedAt !== null   → render in-progress at currentQuestion, start timer
  └─ else                     → render pre-exam welcome
```

Latency target: resume flow should land the player back in their exam **within 1 second** of page load. Two fetches (session + exam-state) happen in parallel.

---

## File Map

| Layer | File | Type | Change |
|---|---|---|---|
| DB | `server/src/db/schema.ts` | modify | Add exam to CHECK, add exam_started_at column |
| DB | `server/src/db/queries.ts` | modify | Extend GameMode, Player type, add 5 query helpers |
| Bank | `questions/clf-c02-complete.json` | modify | Add `meta.exam` extension (data only) |
| Loader | `server/src/questions/questionBank.ts` | modify | Extend `ExamInfo` type, add `sampleExamQuestions` + `computeProportionalCounts` |
| Server | `server/src/socket/examGame.ts` | **new** | `submitExamAnswer`, `finalizeExam`, `getExamResults` |
| Server | `server/src/socket/events.ts` | modify | Register `submit-exam-answer` handler |
| Server | `server/src/routes/dozent.ts` | modify | Accept `gameMode === 'exam'`, bump `totalQuestions` max to 200, sample on exam mode |
| Server | `server/src/routes/player.ts` | modify | Add 4 new endpoints (state, start, submit, review) |
| Client | `client/src/pages/ExamGameSession.tsx` | **new** | Full exam player UI |
| Client | `client/src/pages/GameSession.tsx` | modify | Dispatch exam mode |
| Client | `client/src/components/dozent/DozentPanel.tsx` | modify | Preset card + handler |
| Client | `client/src/pages/Home.tsx` | modify | 🎓 icon for exam sessions |
| Test | `server/src/questions/questionBank.test.ts` | **new** | Unit tests for `computeProportionalCounts` + `sampleExamQuestions` |

---

## Scoring formula details

### Scaled score conversion

```ts
const scaled = Math.round(
  scaleMin + (correctCount / totalQuestions) * (scaleMax - scaleMin)
);
```

For CLF-C02 (`scaleMin=100`, `scaleMax=1000`, `totalQuestions=65`, `passingScore=700`):

| Correct | % | Scaled | Pass? |
|---|---|---|---|
| 65 | 100% | 1000 | ✓ |
| 55 | 85% | 862 | ✓ |
| 50 | 77% | 792 | ✓ |
| 44 | 68% | 709 | ✓ |
| 43 | 66% | 695 | ✗ |
| 40 | 62% | 654 | ✗ |
| 33 | 51% | 557 | ✗ |
| 0 | 0% | 100 | ✗ |

The 700 passing score corresponds to 44/65 correct (67.7%), not 70%. This matches AWS's own approximate scaling (AWS does not publish the exact algorithm).

### Score storage

The scaled score (100–1000) is written to `players.score` at `finalizeExam` time. This lets the existing `getAggregateLeaderboard()` query keep working for cross-session leaderboards — exam mode contributes to the global leaderboard by its scaled score, which is comparable across attempts.

---

## Out of Scope (v1)

- **Other certifications.** Only CLF-C02 has a dozent preset in v1. Adding AZ-104 etc. requires only bank-metadata extension and a new preset card — no architectural work.
- **Free navigation / flag-for-review.** Sequential only. May be added in v2.
- **Auto-submit on timer expiry.** Explicitly rejected by user choice. Visual warning only.
- **Multi-attempt history per user.** `players` is session-scoped; cross-session aggregation only sums by nickname. If attempt history becomes important, a new `exam_attempts` table would be the right place — but not for v1.
- **Anti-cheat / proctoring.** No focus-tracking, no fullscreen enforcement, no keystroke logging. This is a study tool, not a certification authority.
- **Arena projector view.** Exam mode is solo; the existing arena view shows a minimal placeholder.
- **Internationalization.** German UI strings only, matching existing copy.
- **Adaptive difficulty.** Question selection is random within domain quotas; no dynamic adjustment.
- **Explanations during exam.** Hidden until results, per user choice.

---

## Success Criteria

1. Dozent can click the "Prüfungssimulation" card and get a 6-digit session code.
2. Player joins via the code, sees the welcome screen, starts the exam.
3. Player works through 65 questions with no per-question feedback, with a visible 90-minute countdown.
4. Player can close the tab at any point and resume from the exact same question with the correct remaining time.
5. Player can click "Prüfung abgeben" at any time (including after the timer expires) and get a scaled score, pass/fail verdict, per-domain breakdown, and full question review.
6. The racing / buzzer / training modes are completely unaffected — no regressions in existing tests.
7. Unit tests for `computeProportionalCounts` prove the Hare quota math is correct for weights 24/30/34/12 → 16/19/22/8 and edge cases (ties, 100% weight on one domain, empty domain list).
8. `sampleExamQuestions` returns exactly 65 distinct question IDs for the CLF-C02 bank and never returns a `gap-topics` question.

---

## Implementation Order (suggested)

1. **DB + types** — schema migration, queries, types. Verify with a one-off script that an existing database migrates cleanly.
2. **Bank metadata** — extend `clf-c02-complete.json` with the `meta.exam` block. Verify `getExamInfo` returns the new fields.
3. **Sampling** — `computeProportionalCounts` + `sampleExamQuestions` + unit tests. This is the riskiest pure-function change; get it right before wiring up anything else.
4. **Server module** — `examGame.ts`, REST endpoints in `player.ts`, dozent create-session changes. Test with `curl` before touching the client.
5. **Client resume flow** — `ExamGameSession.tsx` shell with `loading → pre-exam → in-progress` stages, timer, no results screen yet. Verify resumability with tab close / reload tests.
6. **Client results screen** — hero card, domain bars, review list. Can be iterated on independently since the data is already in `ExamResultsPayload`.
7. **Dozent panel preset card** — trivial, add last.
8. **Home icon** — trivial, add last.
9. **Deploy** — run `deploy.sh`, test against production with a real CLF-C02 session.

Each step above is independently verifiable and leaves the app in a shippable state (the new mode is inaccessible until step 7 wires up the dozent card, so partial deploys are safe).
