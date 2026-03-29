import { Server, Socket } from 'socket.io';
import { queries } from '../db/queries.js';
import { calculateScore, checkAnswer } from '../utils/helpers.js';
import { getQuestion } from '../questions/questionBank.js';
import {
  startBuzzerGame,
  handleBuzz,
  handleBuzzerAnswer,
  forceNextQuestion,
  forceEndGame,
  getBuzzerGameState,
  getBuzzerGame,
  initBuzzerGame,
} from './buzzerGame.js';
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

export function broadcastLeaderboard(io: Server, sessionCode: string) {
  const leaderboard = queries.getLeaderboard(sessionCode);
  io.to(sessionCode).emit('leaderboard-update', leaderboard);
}

function isDozent(socket: Socket): boolean {
  return socket.data.isDozent === true;
}

function requireDozent(socket: Socket, event: string): boolean {
  if (!isDozent(socket)) {
    console.warn(`Unauthorized ${event} from ${socket.id}`);
    socket.emit('error', { message: 'Nicht autorisiert' });
    return false;
  }
  return true;
}

export function setupSocketHandlers(io: Server) {
  io.on('connection', (socket: Socket) => {
    console.log('Client connected:', socket.id);

    // Dozent authenticates their socket with the password
    socket.on('dozent-auth', (password: string, callback?: (ok: boolean) => void) => {
      const ok = password === process.env.DOZENT_PASSWORD;
      if (ok) {
        socket.data.isDozent = true;
        console.log(`Socket ${socket.id} authenticated as dozent`);
      }
      if (callback) callback(ok);
    });

    socket.on('join-session', (sessionCode: string) => {
      // Prevent duplicate joins from same socket
      if (socket.rooms.has(sessionCode)) {
        console.log(`Socket ${socket.id} already in session ${sessionCode}, skipping`);
        return;
      }

      socket.join(sessionCode);
      console.log(`Socket ${socket.id} joined session ${sessionCode}`);

      // Send initial leaderboard
      broadcastLeaderboard(io, sessionCode);
    });

    socket.on('submit-answer', (data: {
      sessionCode: string;
      playerId: string;
      questionId: string;
      selectedAnswers: string[];
      timeSeconds: number;
    }) => {
      try {
        const { sessionCode, playerId, questionId, selectedAnswers, timeSeconds } = data;

        const session = queries.getSession(sessionCode);
        if (!session) {
          socket.emit('error', { message: 'Session nicht gefunden' });
          return;
        }

        const question = getQuestion(session.questionBank, questionId);
        if (!question) {
          socket.emit('error', { message: 'Frage nicht gefunden' });
          return;
        }

        const player = queries.getPlayer(playerId);
        if (!player) {
          socket.emit('error', { message: 'Spieler nicht gefunden' });
          return;
        }

        const isCorrect = checkAnswer(selectedAnswers, question.correctAnswers, question.type);

        const newCorrect = player.correctAnswers + (isCorrect ? 1 : 0);

        // Racing scoring system:
        // - Wrong answers add 60 second time penalty (makes mistakes very costly)
        // - This penalty is added to actual time for leaderboard and score calculation
        // - Time penalty: -1 point per second (reduced from -0.5 to make time more impactful)
        // - Minimum score is 0 (no negative scores)

        const wrongAnswerTimePenalty = isCorrect ? 0 : 60;
        const newTime = player.totalTimeSeconds + timeSeconds + wrongAnswerTimePenalty;

        const rawScore = calculateScore(newCorrect, newTime);
        const newScore = Math.max(0, rawScore); // Prevent negative scores

        queries.updatePlayerProgress(playerId, newCorrect, newTime, newScore);

        const answerToSave = {
          playerId,
          questionId,
          answeredAt: Date.now(),
          timeSeconds,
          correct: isCorrect,
          selectedAnswers: JSON.stringify(selectedAnswers),
        };
        queries.saveAnswer(answerToSave);

        // Send feedback to player
        socket.emit('answer-result', {
          correct: isCorrect,
          correctAnswers: question.correctAnswers,
        });

        // Broadcast updated leaderboard
        broadcastLeaderboard(io, sessionCode);
      } catch (error) {
        console.error('Error submitting answer:', error);
        socket.emit('error', { message: 'Fehler beim Speichern der Antwort' });
      }
    });

    // ========== BUZZER MODE EVENTS ==========

    // Dozent starts the buzzer game
    socket.on('buzzer-start-game', (sessionCode: string) => {
      if (!requireDozent(socket, 'buzzer-start-game')) return;
      console.log(`Starting buzzer game for session ${sessionCode}`);
      const session = queries.getSession(sessionCode);
      if (!session || session.gameMode !== 'buzzer') {
        socket.emit('error', { message: 'Invalid session for buzzer mode' });
        return;
      }
      startBuzzerGame(io, sessionCode);
    });

    // Player buzzes in
    socket.on('buzzer-press', (data: { sessionCode: string; playerId: string; clientTimestamp: number }) => {
      const { sessionCode, playerId, clientTimestamp } = data;
      handleBuzz(io, sessionCode, playerId, clientTimestamp);
    });

    // Buzzer answerer submits answer
    socket.on('buzzer-submit-answer', (data: {
      sessionCode: string;
      playerId: string;
      selectedAnswers: string[];
    }) => {
      const { sessionCode, playerId, selectedAnswers } = data;
      handleBuzzerAnswer(io, sessionCode, playerId, selectedAnswers);
    });

    // Live selection update from answerer (for Arena view)
    socket.on('buzzer-live-selection', (data: {
      sessionCode: string;
      playerId: string;
      selectedAnswers: string[];
    }) => {
      const { sessionCode, playerId, selectedAnswers } = data;
      // Broadcast to arena spectators
      io.to(sessionCode).emit('arena-live-selection', {
        playerId,
        selectedAnswers,
      });
    });

    // Dozent forces next question
    socket.on('buzzer-force-next', (sessionCode: string) => {
      if (!requireDozent(socket, 'buzzer-force-next')) return;
      console.log(`Dozent forcing next question for session ${sessionCode}`);
      forceNextQuestion(io, sessionCode);
    });

    // Dozent forces game to end (works even after server restart)
    socket.on('buzzer-force-end', (sessionCode: string) => {
      if (!requireDozent(socket, 'buzzer-force-end')) return;
      console.log(`Dozent forcing end of game for session ${sessionCode}`);
      forceEndGame(io, sessionCode);
    });

    // Player requests current buzzer game state (for reconnection)
    socket.on('buzzer-get-state', (sessionCode: string) => {
      const state = getBuzzerGameState(sessionCode);
      if (state) {
        socket.emit('buzzer-state', state);
      } else {
        // Session exists but game not started yet
        const session = queries.getSession(sessionCode);
        if (session && session.gameMode === 'buzzer') {
          socket.emit('buzzer-state', {
            gameState: session.gameState,
            currentQuestionIndex: 0,
            totalQuestions: session.totalQuestions,
            buzzes: [],
            currentAnswererIndex: -1,
            eliminatedAnswers: [],
            leaderboard: queries.getLeaderboard(sessionCode),
          });
        }
      }

      // Also send current player list (important for dozent panel reconnection)
      const players = queries.getSessionPlayers(sessionCode);
      socket.emit('buzzer-players-update', {
        players: players.map(p => ({
          playerId: p.playerId,
          nickname: p.nickname,
          emoji: p.emoji,
          score: p.score,
        })),
      });
    });

    // Arena spectator joins (for streaming/Dozent view)
    socket.on('arena-join', (sessionCode: string) => {
      socket.join(sessionCode);
      console.log(`Arena spectator joined session ${sessionCode}`);
      
      // Send current player list to arena
      const players = queries.getSessionPlayers(sessionCode);
      socket.emit('buzzer-players-update', {
        players: players.map(p => ({
          playerId: p.playerId,
          nickname: p.nickname,
          emoji: p.emoji,
          score: p.score,
        })),
      });
      
      // Send current game state
      const state = getBuzzerGameState(sessionCode);
      if (state) {
        socket.emit('buzzer-state', state);
      }
    });

    // Player joins buzzer session (separate from racing mode join)
    socket.on('buzzer-join-session', (data: { sessionCode: string; playerId: string }) => {
      const { sessionCode, playerId } = data;
      
      // Prevent duplicate joins from same socket
      if (socket.rooms.has(sessionCode)) {
        console.log(`Player ${playerId} already in buzzer session ${sessionCode}, skipping`);
        return;
      }
      
      socket.join(sessionCode);
      socket.data.playerId = playerId;
      socket.data.sessionCode = sessionCode;
      console.log(`Player ${playerId} joined buzzer session ${sessionCode}`);

      // Initialize game state if needed
      const session = queries.getSession(sessionCode);
      if (session && session.gameMode === 'buzzer' && !getBuzzerGame(sessionCode)) {
        initBuzzerGame(sessionCode);
      }

      // Send current state
      const state = getBuzzerGameState(sessionCode);
      if (state) {
        socket.emit('buzzer-state', state);
      }

      // Broadcast updated player list
      const players = queries.getSessionPlayers(sessionCode);
      io.to(sessionCode).emit('buzzer-players-update', {
        players: players.map(p => ({
          playerId: p.playerId,
          nickname: p.nickname,
          emoji: p.emoji,
          score: p.score,
        })),
      });
    });

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

      // Always (re-)join the room — Socket.IO drops room membership on reconnect.
      // socket.join() is a no-op if already in the room.
      socket.join(sessionCode);
      socket.data.playerId = playerId;
      socket.data.sessionCode = sessionCode;

      const session = queries.getSession(sessionCode);
      if (session && session.gameMode === 'training' && !getTrainingGame(sessionCode)) {
        initTrainingGame(sessionCode);
      }

      // Always send current state snapshot (idempotent — harmless on duplicate join)
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

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);

      // If this socket was a buzzer player who is currently answering, treat as timeout
      const { playerId, sessionCode } = socket.data;
      if (playerId && sessionCode) {
        const game = getBuzzerGame(sessionCode);
        if (game && game.currentAnswererIndex >= 0) {
          const currentAnswerer = game.buzzes[game.currentAnswererIndex];
          if (currentAnswerer && currentAnswerer.playerId === playerId) {
            console.log(`Current answerer ${playerId} disconnected, treating as timeout`);
            if (game.timers.answerTimeout) {
              clearTimeout(game.timers.answerTimeout);
            }
            handleBuzzerAnswer(io, sessionCode, playerId, []);
          }
        }
      }
    });
  });
}
