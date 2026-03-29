import { Router } from 'express';
import { queries } from '../db/queries.js';
import { shuffleArray } from '../utils/helpers.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

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

router.get('/:code', (req, res) => {
  try {
    const { code } = req.params;

    const session = queries.getSession(code);
    if (!session) {
      return res.status(404).json({ error: 'Session nicht gefunden' });
    }

    const allQuestions = loadQuestions();
    const questions = session.questionIds.map(id => {
      const q = allQuestions.find(question => question.id === id);
      if (!q) return null;

      // Shuffle options for all question types
      // For 'order' type, shuffling is necessary so the answer isn't obvious
      const shuffledOptions = shuffleArray([...q.options]);

      // Remove correctAnswers from response
      const { correctAnswers, ...questionWithoutAnswer } = q;
      return {
        ...questionWithoutAnswer,
        options: shuffledOptions
      };
    }).filter(Boolean);

    res.json({
      sessionCode: session.sessionCode,
      status: session.status,
      totalQuestions: session.totalQuestions,
      questions,
      gameMode: session.gameMode,
      gameState: session.gameState,
      currentQuestionIndex: session.currentQuestionIndex,
    });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Session' });
  }
});

export default router;
