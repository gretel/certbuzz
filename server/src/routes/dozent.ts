import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { queries, GameMode } from '../db/queries.js';
import { generateSessionCode, shuffleArray } from '../utils/helpers.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { io } from '../server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

interface Question {
  id: string;
  category: string;
  subcategory: string;
  type: 'single' | 'multiple' | 'order';
  difficulty: string;
  question: string;
  options: Array<{ id: string; text: string }>;
  correctAnswers: string[];
  explanation: string;
  references?: string[];
}

let questionsCache: Question[] | null = null;

function loadQuestions(): Question[] {
  if (questionsCache) return questionsCache;

  const questionsPath = path.join(__dirname, '../../../questions.json');
  const data = readFileSync(questionsPath, 'utf-8');
  questionsCache = JSON.parse(data);
  return questionsCache!;
}

router.post('/create-session', authenticate, (req, res) => {
  try {
    const { totalQuestions, categories, gameMode = 'racing' } = req.body;

    if (!totalQuestions || totalQuestions < 5 || totalQuestions > 50) {
      return res.status(400).json({ error: 'Anzahl der Fragen muss zwischen 5 und 50 liegen' });
    }

    // Validate game mode
    if (gameMode !== 'racing' && gameMode !== 'buzzer') {
      return res.status(400).json({ error: 'Ungültiger Spielmodus' });
    }

    const allQuestions = loadQuestions();

    // Filter questions by selected categories
    let filteredQuestions = allQuestions;
    if (categories && Array.isArray(categories) && categories.length > 0) {
      filteredQuestions = allQuestions.filter(q => categories.includes(q.category));
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
    });

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

    queries.deleteSession(sessionCode);
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
    const { totalQuestions, categories } = req.body;

    const session = queries.getSession(sessionCode);
    if (!session) {
      return res.status(404).json({ error: 'Session nicht gefunden' });
    }

    if (!totalQuestions || totalQuestions < 5 || totalQuestions > 50) {
      return res.status(400).json({ error: 'Anzahl der Fragen muss zwischen 5 und 50 liegen' });
    }

    const allQuestions = loadQuestions();

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
    });

    // Reset all player scores for the new round
    queries.resetPlayersForNewRound(sessionCode);

    res.json({ success: true, actualQuestions: actualQuestionCount });
  } catch (error) {
    console.error('Error continuing session:', error);
    res.status(500).json({ error: 'Fehler beim Fortsetzen der Session' });
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
