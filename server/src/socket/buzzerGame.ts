import { Server } from 'socket.io';
import { queries, GameState } from '../db/queries.js';
import { checkAnswer, shuffleArray } from '../utils/helpers.js';
import { getQuestion, type Question } from '../questions/questionBank.js';

interface BuzzEntry {
  playerId: string;
  nickname: string;
  emoji: string;
  buzzTime: number; // ms since question shown
  serverTimestamp: number;
}

interface BuzzerGameState {
  sessionCode: string;
  buzzes: BuzzEntry[];
  currentAnswererIndex: number; // -1 if no one is answering yet
  questionStartTime: number;
  answerStartTime: number | null;
  eliminatedAnswers: string[]; // answers that were wrong (crossed out for next buzzer)
  answerProcessing: boolean; // guard against answer/timeout race
  timers: {
    buzzTimeout?: NodeJS.Timeout;
    enrollmentTimeout?: NodeJS.Timeout;
    answerTimeout?: NodeJS.Timeout;
    transitionTimeout?: NodeJS.Timeout;
  };
}

// In-memory game state for active buzzer sessions
const buzzerGames = new Map<string, BuzzerGameState>();

function getQuestionForSession(sessionCode: string, questionId: string): Question | undefined {
  const session = queries.getSession(sessionCode);
  if (!session) return undefined;
  return getQuestion(session.questionBank, questionId);
}

// Scoring based on difficulty
function getBasePoints(difficulty: string): number {
  switch (difficulty) {
    case 'easy': return 500;
    case 'medium': return 1000;
    case 'hard': return 1500;
    default: return 1000;
  }
}

// Speed bonus based on buzz time
function getSpeedBonus(buzzTimeMs: number): number {
  const buzzTimeSec = buzzTimeMs / 1000;
  if (buzzTimeSec < 0.5) return 100;
  if (buzzTimeSec < 1) return 50;
  if (buzzTimeSec < 2) return 25;
  return 0; // Still reward trying by giving base points
}

function clearGameTimers(gameState: BuzzerGameState) {
  if (gameState.timers.buzzTimeout) clearTimeout(gameState.timers.buzzTimeout);
  if (gameState.timers.enrollmentTimeout) clearTimeout(gameState.timers.enrollmentTimeout);
  if (gameState.timers.answerTimeout) clearTimeout(gameState.timers.answerTimeout);
  if (gameState.timers.transitionTimeout) clearTimeout(gameState.timers.transitionTimeout);
}

export function initBuzzerGame(sessionCode: string): BuzzerGameState {
  const gameState: BuzzerGameState = {
    sessionCode,
    buzzes: [],
    currentAnswererIndex: -1,
    questionStartTime: 0,
    answerStartTime: null,
    eliminatedAnswers: [],
    answerProcessing: false,
    timers: {},
  };
  buzzerGames.set(sessionCode, gameState);
  return gameState;
}

export function getBuzzerGame(sessionCode: string): BuzzerGameState | undefined {
  return buzzerGames.get(sessionCode);
}

export function cleanupBuzzerGame(sessionCode: string) {
  const gameState = buzzerGames.get(sessionCode);
  if (gameState) {
    clearGameTimers(gameState);
    buzzerGames.delete(sessionCode);
  }
}

// Start the game (called when Dozent clicks "Start Game")
export function startBuzzerGame(io: Server, sessionCode: string) {
  const session = queries.getSession(sessionCode);
  if (!session || session.gameMode !== 'buzzer') return;

  let gameState = buzzerGames.get(sessionCode);
  if (!gameState) {
    gameState = initBuzzerGame(sessionCode);
  }

  // Move to first question
  queries.updateSessionGameState(sessionCode, 'question', 0);
  showQuestion(io, sessionCode, 0);
}

// Show a question to all players
function showQuestion(io: Server, sessionCode: string, questionIndex: number) {
  const session = queries.getSession(sessionCode);
  if (!session) return;

  const gameState = buzzerGames.get(sessionCode);
  if (!gameState) return;

  // Reset game state for new question
  clearGameTimers(gameState);
  gameState.buzzes = [];
  gameState.currentAnswererIndex = -1;
  gameState.questionStartTime = Date.now();
  gameState.answerStartTime = null;
  gameState.eliminatedAnswers = [];
  gameState.answerProcessing = false;

  const questionId = session.questionIds[questionIndex];
  const question = getQuestionForSession(sessionCode, questionId);
  if (!question) return;

  // Update DB state
  queries.updateSessionGameState(sessionCode, 'question', questionIndex);

  // Broadcast question to all players (without correct answers)
  const { correctAnswers, explanation, ...questionWithoutAnswer } = question;
  
  // Shuffle options for order-type questions so the answer isn't obvious
  let shuffledOptions = questionWithoutAnswer.options;
  if (question.type === 'order') {
    shuffledOptions = shuffleArray([...questionWithoutAnswer.options]);
  }
  
  io.to(sessionCode).emit('buzzer-question', {
    questionIndex,
    totalQuestions: session.totalQuestions,
    question: {
      ...questionWithoutAnswer,
      options: shuffledOptions,
    },
    buzzTimeoutMs: 20000, // 20 seconds to buzz
  });

  // Set buzz timeout (20 seconds)
  gameState.timers.buzzTimeout = setTimeout(() => {
    handleNoBuzzes(io, sessionCode);
  }, 20000);
}

// Enrollment period duration (7 seconds)
const ENROLLMENT_DURATION_MS = 7000;

// Handle when a player buzzes
export function handleBuzz(io: Server, sessionCode: string, playerId: string, clientTimestamp: number) {
  const gameState = buzzerGames.get(sessionCode);
  if (!gameState) return;

  const session = queries.getSession(sessionCode);
  if (!session) return;
  
  // Allow buzzing during 'question' phase, 'enrolling' phase, or 'answering' phase
  if (session.gameState !== 'question' && session.gameState !== 'enrolling' && session.gameState !== 'answering') return;

  // Check if player already buzzed
  if (gameState.buzzes.some(b => b.playerId === playerId)) return;

  const player = queries.getPlayer(playerId);
  if (!player) return;

  const buzzTime = Date.now() - gameState.questionStartTime;
  
  gameState.buzzes.push({
    playerId,
    nickname: player.nickname,
    emoji: player.emoji,
    buzzTime,
    serverTimestamp: Date.now(),
  });

  // Sort by server timestamp (first come first serve)
  gameState.buzzes.sort((a, b) => a.serverTimestamp - b.serverTimestamp);

  // Broadcast buzz to all players
  io.to(sessionCode).emit('buzz-registered', {
    playerId,
    nickname: player.nickname,
    emoji: player.emoji,
    buzzTime,
    position: gameState.buzzes.findIndex(b => b.playerId === playerId) + 1,
    totalBuzzes: gameState.buzzes.length,
  });

  // If this is the first buzz, start the enrollment phase (10 second window for others to buzz)
  if (gameState.buzzes.length === 1) {
    startEnrollmentPhase(io, sessionCode);
  }
}

// Start the enrollment phase - 10 second window for additional buzzers to join
function startEnrollmentPhase(io: Server, sessionCode: string) {
  const gameState = buzzerGames.get(sessionCode);
  if (!gameState || gameState.buzzes.length === 0) return;

  const session = queries.getSession(sessionCode);
  if (!session) return;

  // Clear the main buzz timeout (we're now in enrollment)
  if (gameState.timers.buzzTimeout) {
    clearTimeout(gameState.timers.buzzTimeout);
  }

  // Update DB state to 'enrolling'
  queries.updateSessionGameState(sessionCode, 'enrolling');

  const enrollmentStartedAt = Date.now();

  // Broadcast enrollment phase started
  io.to(sessionCode).emit('buzzer-enrolling', {
    enrollmentTimeoutMs: ENROLLMENT_DURATION_MS,
    enrollmentStartedAt,
    firstBuzzer: {
      playerId: gameState.buzzes[0].playerId,
      nickname: gameState.buzzes[0].nickname,
      emoji: gameState.buzzes[0].emoji,
      buzzTime: gameState.buzzes[0].buzzTime,
    },
    buzzOrder: gameState.buzzes.map((b, i) => ({
      position: i + 1,
      nickname: b.nickname,
      emoji: b.emoji,
      buzzTime: b.buzzTime,
    })),
  });

  // After enrollment period, start answering phase
  gameState.timers.enrollmentTimeout = setTimeout(() => {
    startAnsweringPhase(io, sessionCode);
  }, ENROLLMENT_DURATION_MS);
}

// Start the answering phase (first buzzer gets to answer)
function startAnsweringPhase(io: Server, sessionCode: string) {
  const gameState = buzzerGames.get(sessionCode);
  if (!gameState || gameState.buzzes.length === 0) return;

  const session = queries.getSession(sessionCode);
  if (!session) return;

  // Clear any pending timeouts
  if (gameState.timers.buzzTimeout) {
    clearTimeout(gameState.timers.buzzTimeout);
  }
  if (gameState.timers.enrollmentTimeout) {
    clearTimeout(gameState.timers.enrollmentTimeout);
  }

  gameState.currentAnswererIndex = 0;
  gameState.answerStartTime = Date.now();

  const currentAnswerer = gameState.buzzes[0];
  
  // Update DB state
  queries.updateSessionGameState(sessionCode, 'answering');

  // Broadcast who is answering
  io.to(sessionCode).emit('buzzer-answering', {
    answerer: {
      playerId: currentAnswerer.playerId,
      nickname: currentAnswerer.nickname,
      emoji: currentAnswerer.emoji,
      buzzTime: currentAnswerer.buzzTime,
    },
    answerTimeoutMs: 40000, // 40 seconds to answer
    eliminatedAnswers: gameState.eliminatedAnswers,
    buzzOrder: gameState.buzzes.map((b, i) => ({
      position: i + 1,
      nickname: b.nickname,
      emoji: b.emoji,
      buzzTime: b.buzzTime,
    })),
  });

  // Set answer timeout (40 seconds)
  gameState.timers.answerTimeout = setTimeout(() => {
    handleAnswerTimeout(io, sessionCode);
  }, 40000);
}

// Handle when the answerer submits an answer
export function handleBuzzerAnswer(
  io: Server,
  sessionCode: string,
  playerId: string,
  selectedAnswers: string[]
) {
  const gameState = buzzerGames.get(sessionCode);
  if (!gameState) return;

  // Guard against answer/timeout race — only process once per answerer slot
  if (gameState.answerProcessing) return;
  gameState.answerProcessing = true;

  const session = queries.getSession(sessionCode);
  if (!session || session.gameState !== 'answering') {
    gameState.answerProcessing = false;
    return;
  }

  // Verify this is the current answerer
  const currentAnswerer = gameState.buzzes[gameState.currentAnswererIndex];
  if (!currentAnswerer || currentAnswerer.playerId !== playerId) {
    gameState.answerProcessing = false;
    return;
  }

  // Clear answer timeout
  if (gameState.timers.answerTimeout) {
    clearTimeout(gameState.timers.answerTimeout);
  }

  const questionId = session.questionIds[session.currentQuestionIndex];
  const question = getQuestionForSession(sessionCode, questionId);
  if (!question) return;

  const isCorrect = checkAnswer(selectedAnswers, question.correctAnswers, question.type);
  const player = queries.getPlayer(playerId);
  if (!player) return;

  if (isCorrect) {
    // Award points
    const basePoints = getBasePoints(question.difficulty);
    const speedBonus = getSpeedBonus(currentAnswerer.buzzTime);
    const totalPoints = basePoints + speedBonus;

    const newScore = player.score + totalPoints;
    const newCorrect = player.correctAnswers + 1;
    queries.updatePlayerScore(playerId, newCorrect, newScore);

    // Save answer
    queries.saveAnswer({
      playerId,
      questionId,
      answeredAt: Date.now(),
      timeSeconds: currentAnswerer.buzzTime / 1000,
      correct: true,
      selectedAnswers: JSON.stringify(selectedAnswers),
    });

    // Broadcast correct answer result
    io.to(sessionCode).emit('buzzer-result', {
      correct: true,
      answerer: {
        playerId: currentAnswerer.playerId,
        nickname: currentAnswerer.nickname,
        emoji: currentAnswerer.emoji,
      },
      questionText: question.question,
      options: question.options,
      correctAnswers: question.correctAnswers,
      explanation: question.explanation,
      references: question.references,
      pointsAwarded: totalPoints,
      basePoints,
      speedBonus,
      leaderboard: queries.getLeaderboard(sessionCode),
    });

    // Transition to next question after 5 seconds
    transitionToNextQuestion(io, sessionCode);
  } else {
    // Wrong answer - add to eliminated answers
    selectedAnswers.forEach(a => {
      if (!gameState.eliminatedAnswers.includes(a)) {
        gameState.eliminatedAnswers.push(a);
      }
    });

    // Save wrong answer
    queries.saveAnswer({
      playerId,
      questionId,
      answeredAt: Date.now(),
      timeSeconds: currentAnswerer.buzzTime / 1000,
      correct: false,
      selectedAnswers: JSON.stringify(selectedAnswers),
    });

    // Check if there's another buzzer to give a chance
    if (gameState.currentAnswererIndex < gameState.buzzes.length - 1) {
      // Pass to next buzzer
      passToNextBuzzer(io, sessionCode, selectedAnswers);
    } else {
      // No more buzzers - show correct answer and move on
      io.to(sessionCode).emit('buzzer-result', {
        correct: false,
        answerer: {
          playerId: currentAnswerer.playerId,
          nickname: currentAnswerer.nickname,
          emoji: currentAnswerer.emoji,
        },
        wrongAnswer: selectedAnswers,
        questionText: question.question,
        options: question.options,
        correctAnswers: question.correctAnswers,
        explanation: question.explanation,
        references: question.references,
        noMoreBuzzers: true,
        leaderboard: queries.getLeaderboard(sessionCode),
      });

      transitionToNextQuestion(io, sessionCode);
    }
  }
}

// Pass to the next buzzer after a wrong answer
function passToNextBuzzer(io: Server, sessionCode: string, wrongAnswer: string[]) {
  const gameState = buzzerGames.get(sessionCode);
  if (!gameState) return;

  const session = queries.getSession(sessionCode);
  if (!session) return;

  const questionId = session.questionIds[session.currentQuestionIndex];
  const question = getQuestionForSession(sessionCode, questionId);
  if (!question) return;

  const previousAnswerer = gameState.buzzes[gameState.currentAnswererIndex];
  gameState.currentAnswererIndex++;
  const nextAnswerer = gameState.buzzes[gameState.currentAnswererIndex];
  gameState.answerStartTime = Date.now();
  gameState.answerProcessing = false; // Reset for next answerer

  // Broadcast wrong answer and next answerer
  io.to(sessionCode).emit('buzzer-wrong-next', {
    wrongAnswerer: {
      playerId: previousAnswerer.playerId,
      nickname: previousAnswerer.nickname,
      emoji: previousAnswerer.emoji,
    },
    wrongAnswer,
    nextAnswerer: {
      playerId: nextAnswerer.playerId,
      nickname: nextAnswerer.nickname,
      emoji: nextAnswerer.emoji,
      buzzTime: nextAnswerer.buzzTime,
    },
    eliminatedAnswers: gameState.eliminatedAnswers,
    answerTimeoutMs: 40000,
  });

  // Set new answer timeout
  gameState.timers.answerTimeout = setTimeout(() => {
    handleAnswerTimeout(io, sessionCode);
  }, 40000);
}

// Handle answer timeout (treat as wrong answer)
function handleAnswerTimeout(io: Server, sessionCode: string) {
  const gameState = buzzerGames.get(sessionCode);
  if (!gameState) return;

  const currentAnswerer = gameState.buzzes[gameState.currentAnswererIndex];
  if (!currentAnswerer) return;

  // Treat timeout as wrong answer with empty selection
  handleBuzzerAnswer(io, sessionCode, currentAnswerer.playerId, []);
}

// Handle when nobody buzzes
function handleNoBuzzes(io: Server, sessionCode: string) {
  const gameState = buzzerGames.get(sessionCode);
  if (!gameState) return;

  const session = queries.getSession(sessionCode);
  if (!session) return;

  const questionId = session.questionIds[session.currentQuestionIndex];
  const question = getQuestionForSession(sessionCode, questionId);
  if (!question) return;

  // Update state to result
  queries.updateSessionGameState(sessionCode, 'result');

  // Broadcast that nobody buzzed
  io.to(sessionCode).emit('buzzer-result', {
    correct: false,
    noBuzzes: true,
    questionText: question.question,
    options: question.options,
    correctAnswers: question.correctAnswers,
    explanation: question.explanation,
    references: question.references,
    leaderboard: queries.getLeaderboard(sessionCode),
  });

  transitionToNextQuestion(io, sessionCode);
}

// Transition to next question after 20 seconds
function transitionToNextQuestion(io: Server, sessionCode: string) {
  const gameState = buzzerGames.get(sessionCode);
  if (!gameState) return;

  const session = queries.getSession(sessionCode);
  if (!session) return;

  queries.updateSessionGameState(sessionCode, 'result');

  const nextIndex = session.currentQuestionIndex + 1;
  const transitionMs = 20000;
  
  // Record when transition started for sync
  const transitionStartedAt = Date.now();

  if (nextIndex >= session.totalQuestions) {
    // Game over - wait 20 seconds before showing final screen
    io.to(sessionCode).emit('buzzer-transition', {
      nextQuestionIn: transitionMs,
      transitionStartedAt,
      currentQuestionIndex: session.currentQuestionIndex,
      nextQuestionIndex: -1, // Indicates game over
      totalQuestions: session.totalQuestions,
      leaderboard: queries.getLeaderboard(sessionCode),
      isGameOver: true,
    });
    
    gameState.timers.transitionTimeout = setTimeout(() => {
      endBuzzerGame(io, sessionCode);
    }, transitionMs);
  } else {
    // Next question in 20 seconds
    io.to(sessionCode).emit('buzzer-transition', {
      nextQuestionIn: transitionMs,
      transitionStartedAt,
      currentQuestionIndex: session.currentQuestionIndex,
      nextQuestionIndex: nextIndex,
      totalQuestions: session.totalQuestions,
      leaderboard: queries.getLeaderboard(sessionCode),
      isGameOver: false,
    });

    gameState.timers.transitionTimeout = setTimeout(() => {
      showQuestion(io, sessionCode, nextIndex);
    }, transitionMs);
  }
}

// End the buzzer game
function endBuzzerGame(io: Server, sessionCode: string) {
  const gameState = buzzerGames.get(sessionCode);
  if (gameState) {
    clearGameTimers(gameState);
  }

  queries.updateSessionGameState(sessionCode, 'finished');

  io.to(sessionCode).emit('buzzer-game-over', {
    leaderboard: queries.getLeaderboard(sessionCode),
  });

  cleanupBuzzerGame(sessionCode);
}

// Manual next question (Dozent override)
export function forceNextQuestion(io: Server, sessionCode: string) {
  let gameState = buzzerGames.get(sessionCode);

  const session = queries.getSession(sessionCode);
  if (!session) return;

  // Re-initialize game state from DB if it was lost (e.g., server restart)
  if (!gameState && session.gameMode === 'buzzer') {
    gameState = initBuzzerGame(sessionCode);
  }

  if (!gameState) return;

  clearGameTimers(gameState);

  const nextIndex = session.currentQuestionIndex + 1;
  if (nextIndex >= session.totalQuestions) {
    endBuzzerGame(io, sessionCode);
  } else {
    showQuestion(io, sessionCode, nextIndex);
  }
}

// Force end game (Dozent override - works even after server restart)
export function forceEndGame(io: Server, sessionCode: string) {
  const session = queries.getSession(sessionCode);
  if (!session) return;

  // Clean up any existing in-memory state
  const gameState = buzzerGames.get(sessionCode);
  if (gameState) {
    clearGameTimers(gameState);
  }

  // Update DB to finished state
  queries.updateSessionGameState(sessionCode, 'finished');

  // Broadcast game over
  io.to(sessionCode).emit('buzzer-game-over', {
    leaderboard: queries.getLeaderboard(sessionCode),
  });

  // Clean up
  cleanupBuzzerGame(sessionCode);
}

// Get current game state for a session (for reconnecting players)
export function getBuzzerGameState(sessionCode: string) {
  const gameState = buzzerGames.get(sessionCode);
  const session = queries.getSession(sessionCode);
  
  if (!session || !gameState) return null;

  return {
    gameState: session.gameState,
    currentQuestionIndex: session.currentQuestionIndex,
    totalQuestions: session.totalQuestions,
    buzzes: gameState.buzzes.map((b, i) => ({
      position: i + 1,
      nickname: b.nickname,
      emoji: b.emoji,
      buzzTime: b.buzzTime,
    })),
    currentAnswererIndex: gameState.currentAnswererIndex,
    eliminatedAnswers: gameState.eliminatedAnswers,
    leaderboard: queries.getLeaderboard(sessionCode),
  };
}
