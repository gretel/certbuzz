import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { queries } from '../db/queries.js';
import { getRandomEmoji } from '../utils/helpers.js';
import { io } from '../server.js';
import { finalizeExam, getExamResults, getPlayerExamQuestions, restartExam } from '../socket/examGame.js';
import { getExamInfo } from '../questions/questionBank.js';

const router = Router();

router.post('/join', (req, res) => {
  try {
    const { sessionCode, nickname } = req.body;

    if (!sessionCode || !nickname) {
      return res.status(400).json({ error: 'SessionCode und Nickname erforderlich' });
    }

    const session = queries.getSession(sessionCode);
    if (!session || session.status !== 'active') {
      return res.status(404).json({ error: 'Session nicht gefunden oder beendet' });
    }

    // Check if this nickname already exists in this session — reuse existing player
    const existingPlayer = queries.getPlayerBySessionAndNickname(sessionCode, nickname.trim());
    if (existingPlayer) {
      // Reuse existing player — preserve their score and answers
      const players = queries.getSessionPlayers(sessionCode);
      io.to(sessionCode).emit('buzzer-players-update', {
        players: players.map(p => ({
          playerId: p.playerId,
          nickname: p.nickname,
          emoji: p.emoji,
          score: p.score,
        })),
      });
      io.to(sessionCode).emit('training-players-update', {
        players: players.map(p => ({
          playerId: p.playerId,
          nickname: p.nickname,
          emoji: p.emoji,
          score: p.score,
        })),
      });

      return res.json({ playerId: existingPlayer.playerId, emoji: existingPlayer.emoji });
    }

    const playerId = uuidv4();
    const emoji = getRandomEmoji(nickname.trim());

    queries.createPlayer({
      playerId,
      sessionCode,
      nickname: nickname.trim(),
      emoji,
      lastActivity: Date.now(),
    });

    // Notify dozent panel / arena of updated player list
    const players = queries.getSessionPlayers(sessionCode);
    io.to(sessionCode).emit('buzzer-players-update', {
      players: players.map(p => ({
        playerId: p.playerId,
        nickname: p.nickname,
        emoji: p.emoji,
        score: p.score,
      })),
    });
    io.to(sessionCode).emit('training-players-update', {
      players: players.map(p => ({
        playerId: p.playerId,
        nickname: p.nickname,
        emoji: p.emoji,
        score: p.score,
      })),
    });

    res.json({ playerId, emoji });
  } catch (error) {
    console.error('Error joining session:', error);
    res.status(500).json({ error: 'Fehler beim Beitreten' });
  }
});

router.get('/:playerId/stats', (req, res) => {
  try {
    const { playerId } = req.params;

    const player = queries.getPlayer(playerId);
    if (!player) {
      return res.status(404).json({ error: 'Spieler nicht gefunden' });
    }

    res.json({
      correctAnswers: player.correctAnswers,
      totalTimeSeconds: player.totalTimeSeconds,
      score: player.score,
      currentQuestion: player.currentQuestion,
    });
  } catch (error) {
    console.error('Error fetching player stats:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Statistiken' });
  }
});

// ========== EXAM MODE ENDPOINTS ==========

// GET /api/player/:playerId/exam-state — resume payload
router.get('/:playerId/exam-state', (req, res) => {
  try {
    const { playerId } = req.params;
    const player = queries.getPlayer(playerId);
    if (!player) return res.status(404).json({ error: 'player not found' });

    const session = queries.getSession(player.sessionCode);
    if (!session) return res.status(404).json({ error: 'session not found' });
    if (session.gameMode !== 'exam') {
      return res.status(400).json({ error: 'not an exam session' });
    }

    const exam = getExamInfo(session.questionBank);
    const durationMinutes = exam?.durationMinutes ?? 90;

    res.json({
      examStartedAt: player.examStartedAt ?? null,
      currentQuestion: player.currentQuestion,
      finishedAt: player.finishedAt ?? null,
      totalQuestions: session.totalQuestions,
      durationMinutes,
    });
  } catch (err: any) {
    console.error('[exam] exam-state error:', err);
    res.status(500).json({ error: err?.message ?? 'internal error' });
  }
});

// POST /api/player/:playerId/exam-start — anchor the timer
router.post('/:playerId/exam-start', (req, res) => {
  try {
    const { playerId } = req.params;
    const player = queries.getPlayer(playerId);
    if (!player) return res.status(404).json({ error: 'player not found' });

    const session = queries.getSession(player.sessionCode);
    if (!session) return res.status(404).json({ error: 'session not found' });
    if (session.gameMode !== 'exam') {
      return res.status(400).json({ error: 'not an exam session' });
    }

    if (!player.examStartedAt) {
      queries.setExamStartedAt(playerId);
    }
    const refreshed = queries.getPlayer(playerId);
    res.json({ examStartedAt: refreshed?.examStartedAt ?? null });
  } catch (err: any) {
    console.error('[exam] exam-start error:', err);
    res.status(500).json({ error: err?.message ?? 'internal error' });
  }
});

// POST /api/player/:playerId/exam-submit — finalize
router.post('/:playerId/exam-submit', (req, res) => {
  try {
    const { playerId } = req.params;
    const results = finalizeExam(playerId);
    res.json(results);
  } catch (err: any) {
    console.error('[exam] exam-submit error:', err);
    res.status(500).json({ error: err?.message ?? 'finalization failed' });
  }
});

// GET /api/player/:playerId/exam-review — read-only results
router.get('/:playerId/exam-review', (req, res) => {
  try {
    const { playerId } = req.params;
    const results = getExamResults(playerId);
    res.json(results);
  } catch (err: any) {
    console.error('[exam] exam-review error:', err);
    res.status(500).json({ error: err?.message ?? 'fetch failed' });
  }
});

// GET /api/player/:playerId/exam-questions — full Question objects for this player
// (uses per-player override after a retake, falls back to session questions)
router.get('/:playerId/exam-questions', (req, res) => {
  try {
    const { playerId } = req.params;
    const player = queries.getPlayer(playerId);
    if (!player) return res.status(404).json({ error: 'player not found' });

    const session = queries.getSession(player.sessionCode);
    if (!session) return res.status(404).json({ error: 'session not found' });
    if (session.gameMode !== 'exam') {
      return res.status(400).json({ error: 'not an exam session' });
    }

    const questions = getPlayerExamQuestions(playerId);
    res.json({ questions, totalQuestions: questions.length });
  } catch (err: any) {
    console.error('[exam] exam-questions error:', err);
    res.status(500).json({ error: err?.message ?? 'fetch failed' });
  }
});

// POST /api/player/:playerId/exam-restart — fresh question sample + reset progress
router.post('/:playerId/exam-restart', (req, res) => {
  try {
    const { playerId } = req.params;
    const result = restartExam(playerId);
    res.json(result);
  } catch (err: any) {
    console.error('[exam] exam-restart error:', err);
    res.status(500).json({ error: err?.message ?? 'restart failed' });
  }
});

export default router;
