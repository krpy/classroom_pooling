import { DatabaseSync } from "node:sqlite";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const dbPath = process.env.SQLITE_PATH || path.join(rootDir, "data.sqlite");

let db;

export function getDb() {
  if (!db) {
    db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    migrate(db);
  }
  return db;
}

function withTransaction(database, fn) {
  database.exec("BEGIN IMMEDIATE;");
  try {
    const result = fn();
    database.exec("COMMIT;");
    return result;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('waiting', 'active', 'closed')),
      admin_token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('slider', 'ranking', 'multiple_choice')),
      text TEXT NOT NULL,
      options TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('hidden', 'active', 'closed')),
      UNIQUE (session_id, order_index)
    );

    CREATE TABLE IF NOT EXISTS responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      student_token TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (question_id, student_token)
    );

    CREATE INDEX IF NOT EXISTS idx_questions_session ON questions(session_id);
    CREATE INDEX IF NOT EXISTS idx_responses_question ON responses(question_id);
  `);
}

function randomFourDigitCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (code === "0000");
  return code;
}

const HARDCODED_QUESTIONS = [
  {
    type: "slider",
    text: "Odhadni podíl těchto platebních metod u velkého českého e-shopu (celkem 100 %)",
    options: {
      items: [
        "Platba kartou / Apple Pay / Google Pay",
        "Bankovní převod / QR platba",
        "Dobírka",
        "BNPL",
        "Ostatní",
      ],
    },
    order_index: 0,
  },
  {
    type: "ranking",
    text: "Seřaď faktory podle důležitosti z pohledu e-shopu (1 = nejdůležitější)",
    options: {
      items: [
        "Nákladovost platební metody",
        "Vratkovost a nevyzvednuté zásilky",
        "Dopad na cash-flow",
        "Zákaznická zkušenost",
      ],
    },
    order_index: 1,
  },
  {
    type: "multiple_choice",
    text: "Který faktor je z pohledu e-shopu nejdůležitější?",
    options: {
      choices: ["Nákladovost", "Vratkovost", "Cash-flow", "Zákaznická zkušenost"],
    },
    order_index: 2,
  },
];

export function createSession() {
  const database = getDb();
  const code = randomFourDigitCode();
  const adminToken = randomUUID();

  const insertSession = database.prepare(
    `INSERT INTO sessions (code, status, admin_token) VALUES (?, 'waiting', ?)`
  );
  const insertQuestion = database.prepare(
    `INSERT INTO questions (session_id, type, text, options, order_index, status)
     VALUES (?, ?, ?, ?, ?, 'hidden')`
  );

  const sessionId = withTransaction(database, () => {
    const info = insertSession.run(code, adminToken);
    const createdSessionId = Number(info.lastInsertRowid);
    for (const q of HARDCODED_QUESTIONS) {
      insertQuestion.run(
        createdSessionId,
        q.type,
        q.text,
        JSON.stringify(q.options),
        q.order_index
      );
    }
    return createdSessionId;
  });
  return { sessionId, code, adminToken };
}

export function getSessionByCode(code) {
  return getDb()
    .prepare(`SELECT * FROM sessions WHERE code = ? AND status != 'closed'`)
    .get(code);
}

export function getSessionForPresenter(sessionId, adminToken) {
  const session = getDb()
    .prepare(`SELECT * FROM sessions WHERE id = ? AND admin_token = ?`)
    .get(sessionId, adminToken);
  if (!session) return null;
  const questions = getDb()
    .prepare(
      `SELECT * FROM questions WHERE session_id = ? ORDER BY order_index ASC`
    )
    .all(sessionId);
  return { session, questions: questions.map(parseQuestionRow) };
}

function parseQuestionRow(row) {
  return {
    ...row,
    options: JSON.parse(row.options),
  };
}

export function getQuestion(sessionId, questionId, adminToken) {
  const row = getDb()
    .prepare(
      `SELECT q.* FROM questions q
       JOIN sessions s ON s.id = q.session_id
       WHERE q.id = ? AND q.session_id = ? AND s.admin_token = ?`
    )
    .get(questionId, sessionId, adminToken);
  return row ? parseQuestionRow(row) : null;
}

export function getActiveQuestionForSession(sessionId) {
  const row = getDb()
    .prepare(
      `SELECT * FROM questions WHERE session_id = ? AND status = 'active' LIMIT 1`
    )
    .get(sessionId);
  return row ? parseQuestionRow(row) : null;
}

export function activateQuestion(sessionId, questionId, adminToken) {
  const database = getDb();
  const ok = database
    .prepare(
      `SELECT 1 FROM questions q JOIN sessions s ON s.id = q.session_id
       WHERE q.id = ? AND q.session_id = ? AND s.admin_token = ?`
    )
    .get(questionId, sessionId, adminToken);
  if (!ok) return false;

  const target = database
    .prepare(`SELECT status FROM questions WHERE id = ? AND session_id = ?`)
    .get(questionId, sessionId);
  if (!target || target.status !== "hidden") return false;

  withTransaction(database, () => {
    database
      .prepare(`UPDATE questions SET status = 'closed' WHERE session_id = ? AND status = 'active'`)
      .run(sessionId);
    database
      .prepare(`UPDATE questions SET status = 'active' WHERE id = ? AND session_id = ?`)
      .run(questionId, sessionId);
    database.prepare(`UPDATE sessions SET status = 'active' WHERE id = ?`).run(sessionId);
  });
  return true;
}

export function closeQuestion(sessionId, questionId, adminToken) {
  const database = getDb();
  const row = database
    .prepare(
      `SELECT q.id FROM questions q JOIN sessions s ON s.id = q.session_id
       WHERE q.id = ? AND q.session_id = ? AND s.admin_token = ? AND q.status = 'active'`
    )
    .get(questionId, sessionId, adminToken);
  if (!row) return false;
  database
    .prepare(`UPDATE questions SET status = 'closed' WHERE id = ?`)
    .run(questionId);
  return true;
}

export function closeSession(sessionId, adminToken) {
  const database = getDb();
  const r = database
    .prepare(`UPDATE sessions SET status = 'closed' WHERE id = ? AND admin_token = ?`)
    .run(sessionId, adminToken);
  return r.changes > 0;
}

export function upsertResponse(questionId, studentToken, valueObj) {
  const database = getDb();
  const value = JSON.stringify(valueObj);
  database
    .prepare(
      `INSERT INTO responses (question_id, student_token, value)
       VALUES (?, ?, ?)
       ON CONFLICT(question_id, student_token) DO UPDATE SET value = excluded.value, created_at = datetime('now')`
    )
    .run(questionId, studentToken, value);
}

export function listResponsesForQuestion(questionId) {
  return getDb()
    .prepare(`SELECT student_token, value FROM responses WHERE question_id = ?`)
    .all(questionId)
    .map((r) => ({ student_token: r.student_token, value: JSON.parse(r.value) }));
}

export function getQuestionByIdForStudent(questionId, sessionId) {
  const row = getDb()
    .prepare(
      `SELECT * FROM questions WHERE id = ? AND session_id = ? AND status = 'active'`
    )
    .get(questionId, sessionId);
  return row ? parseQuestionRow(row) : null;
}

export function getQuestionByIdInSession(questionId, sessionId) {
  const row = getDb()
    .prepare(`SELECT * FROM questions WHERE id = ? AND session_id = ?`)
    .get(questionId, sessionId);
  return row ? parseQuestionRow(row) : null;
}
