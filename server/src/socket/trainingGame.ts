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

interface TransitionInfo {
  nextQuestionIndex: number;
  nextQuestionIn: number;
  transitionStartedAt: number;
  isGameOver: boolean;
}

interface TrainingGameState {
  sessionCode: string;
  votes: Map<string, TrainingVote>; // keyed by playerId
  transition: TransitionInfo | null; // set during the 20-sec transition window
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
    transition: null,
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
  state.transition = null;

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

  // Send vote count to room so dozent widget can show X/Y
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
  // Guard: only close if actively showing a question. Prevents double-fire from
  // simultaneous dozent click + 3-min safety timeout.
  if (!session || session.gameState !== 'question') return;

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
      question: question.question,   // include text for TransitionScreen
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
  const isGameOver = nextIndex >= session.totalQuestions;

  // Store transition metadata so reconnecting players get it from getTrainingGameState
  state.transition = {
    nextQuestionIndex: isGameOver ? -1 : nextIndex,
    nextQuestionIn: transitionMs,
    transitionStartedAt,
    isGameOver,
  };

  const transitionPayload = {
    currentQuestionIndex: session.currentQuestionIndex,
    ...state.transition,
    leaderboard: queries.getLeaderboard(sessionCode),
  };

  io.to(sessionCode).emit('training-transition', transitionPayload);

  if (isGameOver) {
    state.timers.transitionTimeout = setTimeout(() => {
      endTrainingGame(io, sessionCode);
    }, transitionMs);
  } else {
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
  const session = queries.getSession(sessionCode);
  if (!session) return;

  // Guard: don't advance if we're already showing the next question or already finished.
  if (session.gameState === 'question' || session.gameState === 'finished') return;

  let state = trainingGames.get(sessionCode);
  if (!state) {
    state = initTrainingGame(sessionCode);
  } else {
    if (state.timers.roundTimeout) clearTimeout(state.timers.roundTimeout);
    if (state.timers.transitionTimeout) clearTimeout(state.timers.transitionTimeout);
  }

  // Use the stored transition target if available (avoids TOCTOU with auto-advance).
  // Fall back to DB-based computation.
  const nextIndex = state.transition?.nextQuestionIndex ?? (session.currentQuestionIndex + 1);
  state.transition = null;
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

  // Include the current question so reconnecting players can restore UI without
  // waiting for the next training-question broadcast.
  let currentQuestion: ReturnType<typeof getQuestion> | null = null;
  if (session.gameState === 'question' || session.gameState === 'result') {
    const questionId = session.questionIds[session.currentQuestionIndex];
    if (questionId) {
      const q = getQuestionForSession(sessionCode, questionId);
      if (q) {
        // Strip correct answers regardless of game state
        const { correctAnswers: _ca, ...questionWithoutAnswer } = q;
        currentQuestion = questionWithoutAnswer as ReturnType<typeof getQuestion>;
      }
    }
  }

  return {
    // Use 'phase' to match what the client expects. If we have active transition
    // data, report 'transition' so the client can show the countdown.
    phase: state?.transition ? 'transition' : session.gameState,
    currentQuestionIndex: session.currentQuestionIndex,
    totalQuestions: session.totalQuestions,
    question: currentQuestion,
    // Include transition data for reconnecting players during the 20-sec window
    transition: state?.transition ?? null,
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
