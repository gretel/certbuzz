import initSqlJs, { Database } from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../../database.db');

let db: Database | null = null;

export async function initializeDatabase() {
  const SQL = await initSqlJs();

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
    console.log('✅ Database loaded from file');
  } else {
    db = new SQL.Database();
    console.log('✅ New database created');
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_code TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'finished')),
      total_questions INTEGER NOT NULL,
      question_ids TEXT NOT NULL,
      game_mode TEXT NOT NULL DEFAULT 'racing' CHECK(game_mode IN ('racing', 'buzzer', 'training')),
      game_state TEXT DEFAULT 'lobby' CHECK(game_state IN ('lobby', 'question', 'enrolling', 'answering', 'result', 'finished')),
      current_question_index INTEGER DEFAULT 0,
      question_bank TEXT NOT NULL DEFAULT 'azure-az104'
    );

    CREATE TABLE IF NOT EXISTS players (
      player_id TEXT PRIMARY KEY,
      session_code TEXT NOT NULL,
      nickname TEXT NOT NULL,
      emoji TEXT NOT NULL,
      current_question INTEGER DEFAULT 0,
      correct_answers INTEGER DEFAULT 0,
      total_time_seconds REAL DEFAULT 0,
      score REAL DEFAULT 0,
      last_activity INTEGER NOT NULL,
      finished_at INTEGER,
      FOREIGN KEY (session_code) REFERENCES sessions(session_code)
    );

    CREATE TABLE IF NOT EXISTS player_answers (
      answer_id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      answered_at INTEGER NOT NULL,
      time_seconds REAL NOT NULL,
      correct INTEGER NOT NULL CHECK(correct IN (0, 1)),
      selected_answers TEXT NOT NULL,
      FOREIGN KEY (player_id) REFERENCES players(player_id)
    );

    CREATE INDEX IF NOT EXISTS idx_players_session ON players(session_code);
    CREATE INDEX IF NOT EXISTS idx_players_score ON players(score DESC);
    CREATE INDEX IF NOT EXISTS idx_answers_player ON player_answers(player_id);
  `);

  // Migration: Add new columns to existing sessions table if they don't exist
  try {
    db.exec(`SELECT game_mode FROM sessions LIMIT 1`);
  } catch {
    console.log('🔄 Migrating database: adding game_mode, game_state, current_question_index columns...');
    try {
      db.run(`ALTER TABLE sessions ADD COLUMN game_mode TEXT NOT NULL DEFAULT 'racing'`);
      db.run(`ALTER TABLE sessions ADD COLUMN game_state TEXT DEFAULT 'lobby'`);
      db.run(`ALTER TABLE sessions ADD COLUMN current_question_index INTEGER DEFAULT 0`);
      console.log('✅ Migration complete');
    } catch (e) {
      console.log('Migration already applied or not needed');
    }
  }

  // Migration: Add question_bank column
  try {
    db.exec(`SELECT question_bank FROM sessions LIMIT 1`);
  } catch {
    console.log('🔄 Migrating database: adding question_bank column...');
    try {
      db.run(`ALTER TABLE sessions ADD COLUMN question_bank TEXT NOT NULL DEFAULT 'azure-az104'`);
      console.log('✅ question_bank migration complete');
    } catch (e) {
      console.log('question_bank migration already applied or not needed');
    }
  }

  // Migration: Recreate sessions table to fix CHECK constraint (add 'enrolling' state)
  // Check the actual table SQL for the constraint — WHERE 1=0 won't trigger CHECK evaluation
  const tableInfo = db.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'`);
  const tableSql = tableInfo.length > 0 ? (tableInfo[0].values[0][0] as string) : '';
  const needsMigration = tableSql.includes('game_state') && !tableSql.includes('enrolling');
  if (needsMigration) {
    console.log('🔄 Migrating database: rebuilding sessions table to add enrolling state...');
    try {
      db.run(`ALTER TABLE sessions RENAME TO sessions_old`);
      db.run(`
        CREATE TABLE sessions (
          session_code TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          started_at INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('active', 'finished')),
          total_questions INTEGER NOT NULL,
          question_ids TEXT NOT NULL,
          game_mode TEXT NOT NULL DEFAULT 'racing' CHECK(game_mode IN ('racing', 'buzzer')),
          game_state TEXT DEFAULT 'lobby' CHECK(game_state IN ('lobby', 'question', 'enrolling', 'answering', 'result', 'finished')),
          current_question_index INTEGER DEFAULT 0,
          question_bank TEXT NOT NULL DEFAULT 'azure-az104'
        )
      `);
      db.run(`INSERT INTO sessions SELECT * FROM sessions_old`);
      db.run(`DROP TABLE sessions_old`);
      console.log('✅ Sessions table rebuilt');
    } catch (e) {
      console.error('❌ Sessions table migration failed:', e);
    }
  }

  // Migration: Add 'training' to game_mode CHECK constraint
  const tableInfo2 = db.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'`);
  const tableSql2 = tableInfo2.length > 0 ? (tableInfo2[0].values[0][0] as string) : '';
  const needsTrainingMigration = tableSql2.includes('game_mode') && !tableSql2.includes('training');
  if (needsTrainingMigration) {
    console.log('🔄 Migrating database: adding training game_mode...');
    try {
      db.run(`ALTER TABLE sessions RENAME TO sessions_old`);
      db.run(`
        CREATE TABLE sessions (
          session_code TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          started_at INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('active', 'finished')),
          total_questions INTEGER NOT NULL,
          question_ids TEXT NOT NULL,
          game_mode TEXT NOT NULL DEFAULT 'racing' CHECK(game_mode IN ('racing', 'buzzer', 'training')),
          game_state TEXT DEFAULT 'lobby' CHECK(game_state IN ('lobby', 'question', 'enrolling', 'answering', 'result', 'finished')),
          current_question_index INTEGER DEFAULT 0,
          question_bank TEXT NOT NULL DEFAULT 'azure-az104'
        )
      `);
      db.run(`INSERT INTO sessions SELECT * FROM sessions_old`);
      db.run(`DROP TABLE sessions_old`);
      console.log('✅ training game_mode migration complete');
    } catch (e) {
      console.error('❌ training migration failed:', e);
    }
  }

  saveDatabase();
  console.log('✅ Database initialized');
}

export function getDatabase(): Database {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

export function saveDatabase() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(dbPath, buffer);
}

// Auto-save every 5 seconds
setInterval(saveDatabase, 5000);
