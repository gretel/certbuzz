import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { queries, GameMode } from '../db/queries.js';
import { generateSessionCode, shuffleArray } from '../utils/helpers.js';
import { getQuestions, getAvailableBanks, getCategories } from '../questions/questionBank.js';
import { cleanupBuzzerGame } from '../socket/buzzerGame.js';
import { cleanupTrainingGame } from '../socket/trainingGame.js';
import { io } from '../server.js';

const router = Router();

router.post('/create-session', authenticate, (req, res) => {
  try {
    const { totalQuestions, categories, gameMode = 'racing', questionBank } = req.body;

    if (!totalQuestions || totalQuestions < 5 || totalQuestions > 50) {
      return res.status(400).json({ error: 'Anzahl der Fragen muss zwischen 5 und 50 liegen' });
    }

    // Validate game mode
    if (gameMode !== 'racing' && gameMode !== 'buzzer' && gameMode !== 'training') {
      return res.status(400).json({ error: 'Ungültiger Spielmodus' });
    }

    const bankId = questionBank || 'azure-az104';
    const allQuestions = getQuestions(bankId);

    // Filter questions by selected categories
    let filteredQuestions = allQuestions;
    if (categories && Array.isArray(categories) && categories.length > 0) {
      filteredQuestions = allQuestions.filter(q => categories.includes(q.category));
    }

    // For training mode: only use single-choice questions with exactly 4 options
    if (gameMode === 'training') {
      filteredQuestions = filteredQuestions.filter(
        (q: any) => q.type === 'single' && q.options.length === 4
      );
    }

    if (filteredQuestions.length === 0) {
      return res.status(400).json({ error: 'Keine Fragen in den ausgewählten Kategorien verfügbar' });
    }

    // If requested questions exceed available, use all available
    const actualQuestionCount = Math.min(totalQuestions, filteredQuestions.length);
    const selectedQuestions = shuffleArray(filteredQuestions).slice(0, actualQuestionCount);
    const sessionCode = generateSessionCode();

    queries.createSession({
      sessionCode,
      createdAt: Date.now(),
      startedAt: Date.now(),
      status: 'active',
      totalQuestions: actualQuestionCount,
      questionIds: JSON.stringify(selectedQuestions.map(q => q.id)),
      gameMode: gameMode as GameMode,
      questionBank: bankId,
    });

    io.emit('sessions-changed');
    res.json({ sessionCode, actualQuestions: actualQuestionCount, gameMode });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen der Session' });
  }
});

router.get('/sessions', authenticate, (req, res) => {
  try {
    const sessions = queries.getAllSessions();
    res.json({ sessions });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Sessions' });
  }
});

router.delete('/session/:sessionCode', authenticate, (req, res) => {
  try {
    const { sessionCode } = req.params;

    const session = queries.getSession(sessionCode);
    if (!session) {
      return res.status(404).json({ error: 'Session nicht gefunden' });
    }

    // Broadcast session-deleted event to all connected clients in this session
    // This notifies players at nickname screen, in-game, arena spectators, etc.
    io.to(sessionCode).emit('session-deleted', { sessionCode });

    // Clean up in-memory buzzer game state
    cleanupBuzzerGame(sessionCode);
    cleanupTrainingGame(sessionCode);

    queries.deleteSession(sessionCode);
    io.emit('sessions-changed');
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ error: 'Fehler beim Löschen der Session' });
  }
});

// Continue session with new round (same session code, new questions)
router.post('/session/:sessionCode/continue', authenticate, (req, res) => {
  try {
    const { sessionCode } = req.params;
    const { totalQuestions, categories, questionBank } = req.body;

    const session = queries.getSession(sessionCode);
    if (!session) {
      return res.status(404).json({ error: 'Session nicht gefunden' });
    }

    if (!totalQuestions || totalQuestions < 5 || totalQuestions > 50) {
      return res.status(400).json({ error: 'Anzahl der Fragen muss zwischen 5 und 50 liegen' });
    }

    const bankId = questionBank || session.questionBank;
    const allQuestions = getQuestions(bankId);

    // Filter questions by selected categories
    let filteredQuestions = allQuestions;
    if (categories && Array.isArray(categories) && categories.length > 0) {
      filteredQuestions = allQuestions.filter(q => categories.includes(q.category));
    }

    if (filteredQuestions.length === 0) {
      return res.status(400).json({ error: 'Keine Fragen in den ausgewählten Kategorien verfügbar' });
    }

    // Select new questions
    const actualQuestionCount = Math.min(totalQuestions, filteredQuestions.length);
    const selectedQuestions = shuffleArray(filteredQuestions).slice(0, actualQuestionCount);

    // Update session with new questions and reset state
    queries.continueSession(sessionCode, {
      totalQuestions: actualQuestionCount,
      questionIds: JSON.stringify(selectedQuestions.map(q => q.id)),
      questionBank: bankId,
    });

    // Reset all player scores for the new round
    queries.resetPlayersForNewRound(sessionCode);

    res.json({ success: true, actualQuestions: actualQuestionCount });
  } catch (error) {
    console.error('Error continuing session:', error);
    res.status(500).json({ error: 'Fehler beim Fortsetzen der Session' });
  }
});

// Verify password without creating a session
router.post('/verify', authenticate, (_req, res) => {
  res.json({ success: true });
});

// Available question banks
router.get('/question-banks', authenticate, (_req, res) => {
  try {
    const banks = getAvailableBanks();
    res.json({ banks });
  } catch (error) {
    console.error('Error fetching question banks:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Fragenbanken' });
  }
});

// Categories for a specific bank
router.get('/question-banks/:bankId/categories', authenticate, (req, res) => {
  try {
    const categories = getCategories(req.params.bankId);
    res.json({ categories });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Kategorien' });
  }
});

// Reset aggregate leaderboard (deletes all player data across all sessions)
router.post('/reset-leaderboard', authenticate, (req, res) => {
  try {
    queries.resetAggregateLeaderboard();
    res.json({ success: true });
  } catch (error) {
    console.error('Error resetting leaderboard:', error);
    res.status(500).json({ error: 'Fehler beim Zurücksetzen des Leaderboards' });
  }
});

export default router;
