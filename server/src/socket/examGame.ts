import { queries } from '../db/queries.js';
import { getQuestion, getExamInfo, sampleExamQuestions, type Question, type ExamDomain } from '../questions/questionBank.js';
import { checkAnswer } from '../utils/helpers.js';

/**
 * Resolve the effective exam question ID list for a player. Falls back from
 * per-player overrides to session-wide IDs:
 *   1. If player.question_ids is set (after a retake), use those.
 *   2. Otherwise, use the session.questionIds (the original sampled set).
 *
 * The first attempt always uses the session-wide list; only retakes get a
 * per-player override.
 */
export function getEffectivePlayerQuestionIds(playerId: string): string[] {
  const player = queries.getPlayer(playerId);
  if (!player) throw new Error('player not found');

  if (player.questionIds && player.questionIds.length > 0) {
    return player.questionIds;
  }

  const session = queries.getSession(player.sessionCode);
  if (!session) throw new Error('session not found');
  return session.questionIds;
}

/**
 * Resolve full Question objects for a player's exam.
 */
export function getPlayerExamQuestions(playerId: string): Question[] {
  const player = queries.getPlayer(playerId);
  if (!player) throw new Error('player not found');

  const session = queries.getSession(player.sessionCode);
  if (!session) throw new Error('session not found');

  const lang = player.lang ?? 'de';
  const ids = getEffectivePlayerQuestionIds(playerId);
  const questions: Question[] = [];
  for (const id of ids) {
    const q = getQuestion(session.questionBank, id, lang);
    if (q) questions.push(q);
  }
  return questions;
}

/**
 * Restart a player's exam with a freshly sampled question set.
 * Re-samples 65 questions, stores them as a per-player override, then
 * resets player_answers / progress / score / finished_at / exam_started_at.
 */
export function restartExam(playerId: string): { ok: boolean; questionCount: number } {
  const player = queries.getPlayer(playerId);
  if (!player) throw new Error('player not found');

  const session = queries.getSession(player.sessionCode);
  if (!session) throw new Error('session not found');
  if (session.gameMode !== 'exam') {
    throw new Error('not an exam session');
  }

  const freshIds = sampleExamQuestions(session.questionBank);
  queries.setPlayerQuestionIds(playerId, freshIds);
  queries.resetPlayerExamState(playerId);

  return { ok: true, questionCount: freshIds.length };
}

export interface ExamAnswerPayload {
  sessionCode: string;
  playerId: string;
  questionId: string;
  selectedAnswers: string[];
  timeSeconds: number;
}

export interface ExamAnswerResult {
  ok: boolean;
  alreadyAnswered?: boolean;
  error?: string;
}

export interface ExamResultsPayload {
  scaled: number;
  percentage: number;
  correctCount: number;
  totalQuestions: number;
  passed: boolean;
  passingScore: number;
  durationMinutes: number;
  elapsedSeconds: number;
  byDomain: Array<{
    id: string;
    label: string;
    total: number;
    correct: number;
  }>;
  review: Array<{
    question: Question;
    selectedAnswers: string[];
    correct: boolean;
    timeSeconds: number;
  }>;
}

/**
 * Record a single exam answer. Idempotent: if the player has already
 * answered this question, returns { ok: true, alreadyAnswered: true }
 * without advancing or inserting a duplicate.
 *
 * Does NOT echo correctness to the client. Does NOT emit any broadcasts.
 */
export function submitExamAnswer(payload: ExamAnswerPayload): ExamAnswerResult {
  const session = queries.getSession(payload.sessionCode);
  if (!session) return { ok: false, error: 'session not found' };
  if (session.gameMode !== 'exam') {
    return { ok: false, error: 'not an exam session' };
  }

  const player = queries.getPlayer(payload.playerId);
  if (!player) return { ok: false, error: 'player not found' };
  if (player.finishedAt) return { ok: false, error: 'exam already finished' };

  const lang = player.lang ?? 'de';
  const question = getQuestion(session.questionBank, payload.questionId, lang);
  if (!question) return { ok: false, error: 'question not found' };

  // Idempotency: if the player already answered this question, no-op
  const existing = queries.getPlayerAnswerByQuestion(payload.playerId, payload.questionId);
  if (existing) {
    return { ok: true, alreadyAnswered: true };
  }

  const correct = checkAnswer(payload.selectedAnswers, question.correctAnswers, question.type);

  queries.saveAnswer({
    playerId: payload.playerId,
    questionId: payload.questionId,
    answeredAt: Date.now(),
    timeSeconds: payload.timeSeconds,
    correct,
    selectedAnswers: JSON.stringify(payload.selectedAnswers),
  });

  queries.advanceExamPlayer(payload.playerId);

  return { ok: true };
}

/**
 * Compute the exam results for a player. Called by both finalizeExam
 * (which also persists the score) and getExamResults (read-only).
 */
function computeResults(playerId: string): ExamResultsPayload {
  const player = queries.getPlayer(playerId);
  if (!player) throw new Error('player not found');

  const session = queries.getSession(player.sessionCode);
  if (!session) throw new Error('session not found');

  const lang = player.lang ?? 'de';

  const exam = getExamInfo(session.questionBank);
  if (!exam || !exam.domains) {
    throw new Error(`bank '${session.questionBank}' has no exam metadata`);
  }

  const answers = queries.getPlayerAnswers(playerId);
  const correctCount = answers.filter(a => a.correct).length;
  const total = exam.totalQuestions;
  const percentage = total > 0 ? (correctCount / total) * 100 : 0;

  const scaleMin = exam.scaleMin ?? 100;
  const scaleMax = exam.scaleMax ?? 1000;
  const scaled = total > 0
    ? Math.round(scaleMin + (correctCount / total) * (scaleMax - scaleMin))
    : scaleMin;

  const passingScore = exam.passingScore ?? 700;
  const passed = scaled >= passingScore;

  // Per-domain breakdown
  const byDomain = (exam.domains as ExamDomain[]).map(dom => {
    const domAnswers = answers.filter(a => {
      const q = getQuestion(session.questionBank, a.questionId, lang);
      return q && dom.categories.includes(q.category);
    });
    return {
      id: dom.id,
      label: dom.label,
      total: domAnswers.length,
      correct: domAnswers.filter(a => a.correct).length,
    };
  });

  // Full review list (questions WITH correctAnswers so the client can highlight)
  const review = answers.map(a => {
    const q = getQuestion(session.questionBank, a.questionId, lang);
    if (!q) throw new Error(`question ${a.questionId} not found`);
    return {
      question: q,
      selectedAnswers: a.selectedAnswers,
      correct: a.correct,
      timeSeconds: a.timeSeconds,
    };
  });

  const startMs = player.examStartedAt ?? player.lastActivity;
  const endMs = player.finishedAt ?? Date.now();
  const elapsedSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));

  return {
    scaled,
    percentage: Math.round(percentage * 10) / 10,
    correctCount,
    totalQuestions: total,
    passed,
    passingScore,
    durationMinutes: exam.durationMinutes ?? 90,
    elapsedSeconds,
    byDomain,
    review,
  };
}

/**
 * Finalize the exam: compute results, persist scaled score, mark player finished.
 * Idempotent: if the exam was already finalized, returns current results
 * without re-computing/persisting.
 */
export function finalizeExam(playerId: string): ExamResultsPayload {
  const player = queries.getPlayer(playerId);
  if (!player) throw new Error('player not found');

  if (!player.finishedAt) {
    const results = computeResults(playerId);
    queries.markPlayerFinished(playerId, results.scaled);
    // Re-compute so elapsedSeconds reflects the persisted finished_at
    return computeResults(playerId);
  }
  return computeResults(playerId);
}

/**
 * Read-only re-fetch of exam results (for client page reload after submission).
 */
export function getExamResults(playerId: string): ExamResultsPayload {
  return computeResults(playerId);
}
