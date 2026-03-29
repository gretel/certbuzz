import { Server, Socket } from 'socket.io';
import { queries } from '../db/queries.js';
import { calculateScore, checkAnswer } from '../utils/helpers.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Question {
  id: string;
  type: 'single' | 'multiple' | 'order';
  correctAnswers: string[];
}

let questionsCache: Question[] | null = null;

function loadQuestions(): Question[] {
  if (questionsCache) return questionsCache;

  const questionsPath = path.join(__dirname, '../../../questions.json');
  const data = readFileSync(questionsPath, 'utf-8');
  questionsCache = JSON.parse(data);
  return questionsCache!;
}

function getQuestionById(id: string): Question | undefined {
  const questions = loadQuestions();
  return questions.find(q => q.id === id);
}

export function broadcastLeaderboard(io: Server, sessionCode: string) {
  const leaderboard = queries.getLeaderboard(sessionCode);
  io.to(sessionCode).emit('leaderboard-update', leaderboard);
}

export function setupSocketHandlers(io: Server) {
  io.on('connection', (socket: Socket) => {
    console.log('Client connected:', socket.id);

    socket.on('join-session', (sessionCode: string) => {
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

        const question = getQuestionById(questionId);
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
      console.log(`Dozent forcing next question for session ${sessionCode}`);
      forceNextQuestion(io, sessionCode);
    });

    // Dozent forces game to end (works even after server restart)
    socket.on('buzzer-force-end', (sessionCode: string) => {
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

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });
}
