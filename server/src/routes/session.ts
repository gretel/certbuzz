import { Router } from 'express';
import { queries } from '../db/queries.js';
import { shuffleArray } from '../utils/helpers.js';
import { getQuestions, getExamInfo, getQuestionBankMeta } from '../questions/questionBank.js';

const router = Router();

router.get('/:code', (req, res) => {
  try {
    const { code } = req.params;

    const session = queries.getSession(code);
    if (!session) {
      return res.status(404).json({ error: 'Session nicht gefunden' });
    }

    const allQuestions = getQuestions(session.questionBank);
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

    const bankMeta = getQuestionBankMeta(session.questionBank);

    res.json({
      sessionCode: session.sessionCode,
      status: session.status,
      totalQuestions: session.totalQuestions,
      questions,
      gameMode: session.gameMode,
      gameState: session.gameState,
      currentQuestionIndex: session.currentQuestionIndex,
      questionBank: session.questionBank,
      bankLabel: bankMeta?.label ?? session.questionBank,
      examInfo: getExamInfo(session.questionBank),
    });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Session' });
  }
});

export default router;
