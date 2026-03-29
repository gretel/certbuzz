import { getDatabase, saveDatabase } from './schema.js';

export type GameMode = 'racing' | 'buzzer' | 'training';
export type GameState = 'lobby' | 'question' | 'enrolling' | 'answering' | 'result' | 'finished';

export interface GameSession {
  sessionCode: string;
  createdAt: number;
  startedAt: number;
  status: 'active' | 'finished';
  totalQuestions: number;
  questionIds: string[];
  gameMode: GameMode;
  gameState: GameState;
  currentQuestionIndex: number;
  questionBank: string;
}

export interface Player {
  playerId: string;
  sessionCode: string;
  nickname: string;
  emoji: string;
  currentQuestion: number;
  correctAnswers: number;
  totalTimeSeconds: number;
  score: number;
  lastActivity: number;
  finishedAt?: number;
}

export interface PlayerAnswer {
  answerId?: number;
  playerId: string;
  questionId: string;
  answeredAt: number;
  timeSeconds: number;
  correct: boolean;
  selectedAnswers: string[];
}

export const queries = {
  createSession: (session: Omit<GameSession, 'questionIds' | 'gameState' | 'currentQuestionIndex'> & { questionIds: string }) => {
    const db = getDatabase();
    db.run(`
      INSERT INTO sessions (session_code, created_at, started_at, status, total_questions, question_ids, game_mode, game_state, current_question_index, question_bank)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      session.sessionCode,
      session.createdAt,
      session.startedAt,
      session.status,
      session.totalQuestions,
      session.questionIds,
      session.gameMode,
      'lobby',
      0,
      session.questionBank,
    ]);
    saveDatabase();
  },

  getSession: (sessionCode: string): GameSession | undefined => {
    const db = getDatabase();
    const result = db.exec(`SELECT * FROM sessions WHERE session_code = ?`, [sessionCode]);
    if (result.length === 0 || result[0].values.length === 0) return undefined;

    const row = result[0].values[0];
    return {
      sessionCode: row[0] as string,
      createdAt: row[1] as number,
      startedAt: row[2] as number,
      status: row[3] as 'active' | 'finished',
      totalQuestions: row[4] as number,
      questionIds: JSON.parse(row[5] as string),
      gameMode: (row[6] as GameMode) || 'racing',
      gameState: (row[7] as GameState) || 'lobby',
      currentQuestionIndex: (row[8] as number) || 0,
      questionBank: (row[9] as string) || 'azure-az104',
    };
  },

  updateSessionGameState: (sessionCode: string, gameState: GameState, currentQuestionIndex?: number) => {
    const db = getDatabase();
    if (currentQuestionIndex !== undefined) {
      db.run(`
        UPDATE sessions
        SET game_state = ?, current_question_index = ?
        WHERE session_code = ?
      `, [gameState, currentQuestionIndex, sessionCode]);
    } else {
      db.run(`
        UPDATE sessions
        SET game_state = ?
        WHERE session_code = ?
      `, [gameState, sessionCode]);
    }
    saveDatabase();
  },

  createPlayer: (player: Omit<Player, 'currentQuestion' | 'correctAnswers' | 'totalTimeSeconds' | 'score' | 'finishedAt'>) => {
    const db = getDatabase();
    db.run(`
      INSERT INTO players (player_id, session_code, nickname, emoji, last_activity)
      VALUES (?, ?, ?, ?, ?)
    `, [
      player.playerId,
      player.sessionCode,
      player.nickname,
      player.emoji,
      player.lastActivity
    ]);
    saveDatabase();
  },

  getPlayer: (playerId: string): Player | undefined => {
    const db = getDatabase();
    const result = db.exec(`SELECT * FROM players WHERE player_id = ?`, [playerId]);
    if (result.length === 0 || result[0].values.length === 0) return undefined;

    const row = result[0].values[0];
    return {
      playerId: row[0] as string,
      sessionCode: row[1] as string,
      nickname: row[2] as string,
      emoji: row[3] as string,
      currentQuestion: row[4] as number,
      correctAnswers: row[5] as number,
      totalTimeSeconds: row[6] as number,
      score: row[7] as number,
      lastActivity: row[8] as number,
      finishedAt: row[9] as number | undefined,
    };
  },

  updatePlayerProgress: (playerId: string, correctAnswers: number, totalTime: number, score: number) => {
    const db = getDatabase();
    db.run(`
      UPDATE players
      SET current_question = current_question + 1,
          correct_answers = ?,
          total_time_seconds = ?,
          score = ?,
          last_activity = ?
      WHERE player_id = ?
    `, [correctAnswers, totalTime, score, Date.now(), playerId]);
    saveDatabase();
  },

  getLeaderboard: (sessionCode: string, limit = 26) => {
    const db = getDatabase();
    const result = db.exec(`
      SELECT nickname, emoji, score, correct_answers, total_time_seconds, current_question
      FROM players
      WHERE session_code = ?
      ORDER BY score DESC
      LIMIT ?
    `, [sessionCode, limit]);

    if (result.length === 0) return [];

    return result[0].values.map((row: any) => ({
      nickname: row[0],
      emoji: row[1],
      score: row[2],
      correct_answers: row[3],
      total_time_seconds: row[4],
      current_question: row[5],
    }));
  },

  saveAnswer: (answer: Omit<PlayerAnswer, 'answerId' | 'selectedAnswers'> & { selectedAnswers: string }) => {
    const db = getDatabase();
    db.run(`
      INSERT INTO player_answers (player_id, question_id, answered_at, time_seconds, correct, selected_answers)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      answer.playerId,
      answer.questionId,
      answer.answeredAt,
      answer.timeSeconds,
      answer.correct ? 1 : 0,
      answer.selectedAnswers
    ]);
    saveDatabase();
  },

  getPlayerAnswerCount: (playerId: string): number => {
    const db = getDatabase();
    const result = db.exec(`SELECT COUNT(*) FROM player_answers WHERE player_id = ?`, [playerId]);
    if (result.length === 0 || result[0].values.length === 0) return 0;
    return result[0].values[0][0] as number;
  },

  getPlayerBySessionAndNickname: (sessionCode: string, nickname: string): Player | undefined => {
    const db = getDatabase();
    const result = db.exec(`SELECT * FROM players WHERE session_code = ? AND nickname = ?`, [sessionCode, nickname]);
    if (result.length === 0 || result[0].values.length === 0) return undefined;

    const row = result[0].values[0];
    return {
      playerId: row[0] as string,
      sessionCode: row[1] as string,
      nickname: row[2] as string,
      emoji: row[3] as string,
      currentQuestion: row[4] as number,
      correctAnswers: row[5] as number,
      totalTimeSeconds: row[6] as number,
      score: row[7] as number,
      lastActivity: row[8] as number,
      finishedAt: row[9] as number | undefined,
    };
  },

  deletePlayer: (playerId: string) => {
    const db = getDatabase();
    // Delete player's answers first
    db.run(`DELETE FROM player_answers WHERE player_id = ?`, [playerId]);
    // Then delete player
    db.run(`DELETE FROM players WHERE player_id = ?`, [playerId]);
    saveDatabase();
  },

  getAllSessions: () => {
    const db = getDatabase();
    const result = db.exec(`
      SELECT
        s.session_code,
        s.created_at,
        s.started_at,
        s.status,
        s.total_questions,
        s.game_mode,
        s.game_state,
        s.current_question_index,
        COUNT(DISTINCT p.player_id) as player_count,
        s.question_bank
      FROM sessions s
      LEFT JOIN players p ON s.session_code = p.session_code
      GROUP BY s.session_code
      ORDER BY s.created_at DESC
    `);

    if (result.length === 0) return [];

    return result[0].values.map((row: any) => ({
      sessionCode: row[0] as string,
      createdAt: row[1] as number,
      startedAt: row[2] as number,
      status: row[3] as 'active' | 'finished',
      totalQuestions: row[4] as number,
      gameMode: (row[5] as GameMode) || 'racing',
      gameState: (row[6] as GameState) || 'lobby',
      currentQuestionIndex: (row[7] as number) || 0,
      playerCount: row[8] as number,
      questionBank: (row[9] as string) || 'azure-az104',
    }));
  },

  getSessionPlayers: (sessionCode: string): Player[] => {
    const db = getDatabase();
    const result = db.exec(`SELECT * FROM players WHERE session_code = ? ORDER BY score DESC`, [sessionCode]);
    if (result.length === 0) return [];

    return result[0].values.map((row: any) => ({
      playerId: row[0] as string,
      sessionCode: row[1] as string,
      nickname: row[2] as string,
      emoji: row[3] as string,
      currentQuestion: row[4] as number,
      correctAnswers: row[5] as number,
      totalTimeSeconds: row[6] as number,
      score: row[7] as number,
      lastActivity: row[8] as number,
      finishedAt: row[9] as number | undefined,
    }));
  },

  updatePlayerScore: (playerId: string, correctAnswers: number, score: number) => {
    const db = getDatabase();
    db.run(`
      UPDATE players
      SET correct_answers = ?,
          score = ?,
          last_activity = ?
      WHERE player_id = ?
    `, [correctAnswers, score, Date.now(), playerId]);
    saveDatabase();
  },

  deleteSession: (sessionCode: string) => {
    const db = getDatabase();

    // Get all players in this session
    const playersResult = db.exec(`SELECT player_id FROM players WHERE session_code = ?`, [sessionCode]);

    if (playersResult.length > 0 && playersResult[0].values.length > 0) {
      // Delete all answers for all players in this session
      const playerIds = playersResult[0].values.map((row: any) => row[0] as string);
      playerIds.forEach((playerId: string) => {
        db.run(`DELETE FROM player_answers WHERE player_id = ?`, [playerId]);
      });
    }

    // Delete all players in this session
    db.run(`DELETE FROM players WHERE session_code = ?`, [sessionCode]);

    // Delete the session
    db.run(`DELETE FROM sessions WHERE session_code = ?`, [sessionCode]);

    saveDatabase();
  },

  continueSession: (sessionCode: string, data: { totalQuestions: number; questionIds: string; questionBank?: string }) => {
    const db = getDatabase();
    if (data.questionBank) {
      db.run(`
        UPDATE sessions
        SET total_questions = ?,
            question_ids = ?,
            game_state = 'lobby',
            current_question_index = 0,
            status = 'active',
            question_bank = ?
        WHERE session_code = ?
      `, [data.totalQuestions, data.questionIds, data.questionBank, sessionCode]);
    } else {
      db.run(`
        UPDATE sessions
        SET total_questions = ?,
            question_ids = ?,
            game_state = 'lobby',
            current_question_index = 0,
            status = 'active'
        WHERE session_code = ?
      `, [data.totalQuestions, data.questionIds, sessionCode]);
    }
    saveDatabase();
  },

  resetPlayersForNewRound: (sessionCode: string) => {
    const db = getDatabase();
    
    // Delete all answers for players in this session
    const playersResult = db.exec(`SELECT player_id FROM players WHERE session_code = ?`, [sessionCode]);
    if (playersResult.length > 0 && playersResult[0].values.length > 0) {
      const playerIds = playersResult[0].values.map((row: any) => row[0] as string);
      playerIds.forEach((playerId: string) => {
        db.run(`DELETE FROM player_answers WHERE player_id = ?`, [playerId]);
      });
    }

    // Reset player scores and progress
    db.run(`
      UPDATE players
      SET current_question = 0,
          correct_answers = 0,
          total_time_seconds = 0,
          score = 0,
          finished_at = NULL,
          last_activity = ?
      WHERE session_code = ?
    `, [Date.now(), sessionCode]);

    saveDatabase();
  },

  // Aggregate leaderboard: sum scores by nickname across all sessions
  getAggregateLeaderboard: (limit = 50) => {
    const db = getDatabase();
    const result = db.exec(`
      SELECT
        nickname,
        emoji,
        SUM(score) as total_score,
        SUM(correct_answers) as total_correct,
        COUNT(DISTINCT session_code) as sessions_played
      FROM players
      GROUP BY nickname
      ORDER BY total_score DESC
      LIMIT ?
    `, [limit]);

    if (result.length === 0) return [];

    return result[0].values.map((row: any) => ({
      nickname: row[0],
      emoji: row[1],
      totalScore: row[2],
      totalCorrect: row[3],
      sessionsPlayed: row[4],
    }));
  },

  // Reset aggregate leaderboard by deleting all players and answers
  resetAggregateLeaderboard: () => {
    const db = getDatabase();
    db.run(`DELETE FROM player_answers`);
    db.run(`DELETE FROM players`);
    saveDatabase();
  },
};
