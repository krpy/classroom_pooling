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

function ensureColumn(database, table, columnName, definition) {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((col) => col.name === columnName)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${columnName} ${definition};`);
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('waiting', 'active', 'closed')),
      admin_token TEXT NOT NULL UNIQUE,
      student_view_mode TEXT NOT NULL DEFAULT 'waiting' CHECK (student_view_mode IN ('waiting', 'question', 'results', 'reading')),
      student_view_data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('slider', 'ranking', 'multiple_choice', 'number_guess')),
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

    CREATE TABLE IF NOT EXISTS student_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      student_token TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_questions_session ON questions(session_id);
    CREATE INDEX IF NOT EXISTS idx_responses_question ON responses(question_id);
    CREATE INDEX IF NOT EXISTS idx_student_questions_session ON student_questions(session_id);
  `);

  ensureColumn(database, "sessions", "student_view_mode", "TEXT NOT NULL DEFAULT 'waiting'");
  ensureColumn(database, "sessions", "student_view_data", "TEXT");
  migrateQuestionsAllowNumberGuess(database);
  normalizeMojibakeQuestions(database);
}

/** Existing DBs created before number_guess need table rebuild (SQLite cannot ALTER CHECK). */
function migrateQuestionsAllowNumberGuess(database) {
  const row = database
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='questions'`)
    .get();
  if (!row || !row.sql || row.sql.includes("number_guess")) return;

  database.exec("PRAGMA foreign_keys=OFF;");
  database.exec("BEGIN IMMEDIATE;");
  try {
    database.exec(`
      CREATE TABLE questions__mig (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('slider', 'ranking', 'multiple_choice', 'number_guess')),
        text TEXT NOT NULL,
        options TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('hidden', 'active', 'closed')),
        UNIQUE (session_id, order_index)
      );
    `);
    database.exec(`INSERT INTO questions__mig SELECT * FROM questions;`);
    database.exec(`DROP TABLE questions;`);
    database.exec(`ALTER TABLE questions__mig RENAME TO questions;`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_questions_session ON questions(session_id);`);
    database.exec("COMMIT;");
  } catch (e) {
    database.exec("ROLLBACK;");
    throw e;
  } finally {
    database.exec("PRAGMA foreign_keys=ON;");
  }
}

function normalizeMojibakeQuestions(database) {
  const rows = database.prepare(`SELECT id, order_index, text, options FROM questions`).all();
  if (!rows.length) return;

  const update = database.prepare(`UPDATE questions SET text = ?, options = ? WHERE id = ?`);

  for (const row of rows) {
    const canonical = HARDCODED_QUESTIONS[row.order_index];
    if (!canonical) continue;
    const text = canonical.text;
    const optionsJson = JSON.stringify(canonical.options);
    if (row.text !== text || row.options !== optionsJson) {
      update.run(text, optionsJson, row.id);
    }
  }
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
    text: "Odhadni pod\u00edl t\u011bchto platebn\u00edch metod u velk\u00e9ho \u010desk\u00e9ho e-shopu (celkem 100 %)",
    options: {
      items: [
        "Platba kartou / Apple Pay / Google Pay",
        "Bankovn\u00ed p\u0159evod / QR platba",
        "Dob\u00edrka",
        "BNPL",
        "Ostatn\u00ed",
      ],
    },
    order_index: 0,
  },
  {
    type: "ranking",
    text: "Se\u0159a\u010f faktory podle d\u016fle\u017eitosti z pohledu e-shopu (1 = nejd\u016fle\u017eit\u011bj\u0161\u00ed)",
    options: {
      items: [
        "N\u00e1kladovost platebn\u00ed metody",
        "Vratkovost a nevyzvednut\u00e9 z\u00e1silky",
        "Dopad na cash-flow",
        "Z\u00e1kaznick\u00e1 zku\u0161enost",
      ],
    },
    order_index: 1,
  },
  {
    type: "multiple_choice",
    text: "Kter\u00fd faktor je z pohledu e-shopu nejd\u016fle\u017eit\u011bj\u0161\u00ed?",
    options: {
      choices: [
        "N\u00e1kladovost",
        "Vratkovost",
        "Cash-flow",
        "Z\u00e1kaznick\u00e1 zku\u0161enost",
      ],
    },
    order_index: 2,
  },
];

/**
 * @param {number} sessionId
 * @param {string} adminToken
 * @param {{ mode: 'yes_no' | 'number' | 'choice', text: string, min?: number, max?: number, choices?: string[] }} spec
 * @returns {ReturnType<typeof parseQuestionRow> | null}
 */
export function createAdhocQuestion(sessionId, adminToken, spec) {
  const database = getDb();
  const sessionOk = database
    .prepare(`SELECT 1 FROM sessions WHERE id = ? AND admin_token = ?`)
    .get(sessionId, adminToken);
  if (!sessionOk) return null;

  const maxRow = database
    .prepare(`SELECT MAX(order_index) AS m FROM questions WHERE session_id = ?`)
    .get(sessionId);
  const nextOrder = Number(maxRow?.m ?? -1) + 1;

  let type;
  /** @type {Record<string, unknown>} */
  let options;

  if (spec.mode === "yes_no") {
    type = "multiple_choice";
    options = { choices: ["Ano", "Ne"], yesNoLayout: true };
  } else if (spec.mode === "choice") {
    const raw = Array.isArray(spec.choices) ? spec.choices : [];
    const choices = raw.map((s) => String(s).trim()).filter(Boolean);
    if (choices.length < 2 || choices.length > 12) return null;
    const seen = new Set();
    for (const c of choices) {
      if (seen.has(c)) return null;
      seen.add(c);
    }
    type = "multiple_choice";
    options = { choices };
  } else if (spec.mode === "number") {
    const min = Math.trunc(Number(spec.min));
    const max = Math.trunc(Number(spec.max));
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null;
    if (max - min > 10_000) return null;
    type = "number_guess";
    options = { min, max };
  } else {
    return null;
  }

  const text = String(spec.text || "").trim();
  if (!text || text.length > 500) return null;

  const info = database
    .prepare(
      `INSERT INTO questions (session_id, type, text, options, order_index, status)
       VALUES (?, ?, ?, ?, ?, 'hidden')`
    )
    .run(sessionId, type, text, JSON.stringify(options), nextOrder);

  const id = Number(info.lastInsertRowid);
  return getQuestion(sessionId, id, adminToken);
}

export function createSession() {
  const database = getDb();
  const code = randomFourDigitCode();
  const adminToken = randomUUID();

  const insertSession = database.prepare(
    `INSERT INTO sessions (code, status, admin_token, student_view_mode, student_view_data)
     VALUES (?, 'waiting', ?, 'waiting', NULL)`
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
  const row = getDb()
    .prepare(`SELECT * FROM sessions WHERE code = ? AND status != 'closed'`)
    .get(code);
  return row ? parseSessionRow(row) : null;
}

export function getSessionForPresenter(sessionId, adminToken) {
  const session = getDb()
    .prepare(`SELECT * FROM sessions WHERE id = ? AND admin_token = ?`)
    .get(sessionId, adminToken);
  if (!session) return null;
  const questions = getDb()
    .prepare(`SELECT * FROM questions WHERE session_id = ? ORDER BY order_index ASC`)
    .all(sessionId);
  return { session: parseSessionRow(session), questions: questions.map(parseQuestionRow) };
}

function parseQuestionRow(row) {
  return {
    ...row,
    options: JSON.parse(row.options),
  };
}

function parseSessionRow(row) {
  let parsedData = null;
  if (row.student_view_data) {
    try {
      parsedData = JSON.parse(row.student_view_data);
    } catch {
      parsedData = null;
    }
  }
  return {
    ...row,
    student_view_data: parsedData,
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
    .prepare(`SELECT * FROM questions WHERE session_id = ? AND status = 'active' LIMIT 1`)
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
    database
      .prepare(
        `UPDATE sessions
         SET status = 'active', student_view_mode = 'question', student_view_data = ?
         WHERE id = ?`
      )
      .run(JSON.stringify({ questionId }), sessionId);
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

  withTransaction(database, () => {
    database.prepare(`UPDATE questions SET status = 'closed' WHERE id = ?`).run(questionId);
    database
      .prepare(`UPDATE sessions SET student_view_mode = 'waiting', student_view_data = NULL WHERE id = ?`)
      .run(sessionId);
  });
  return true;
}

export function resetQuestion(sessionId, questionId, adminToken) {
  const database = getDb();
  const row = database
    .prepare(
      `SELECT q.id, q.status FROM questions q
       JOIN sessions s ON s.id = q.session_id
       WHERE q.id = ? AND q.session_id = ? AND s.admin_token = ?`
    )
    .get(questionId, sessionId, adminToken);
  if (!row) return false;

  withTransaction(database, () => {
    database.prepare(`DELETE FROM responses WHERE question_id = ?`).run(questionId);
    database.prepare(`UPDATE questions SET status = 'hidden' WHERE id = ?`).run(questionId);
    if (row.status === "active") {
      database
        .prepare(
          `UPDATE sessions SET student_view_mode = 'waiting', student_view_data = NULL WHERE id = ?`
        )
        .run(sessionId);
    }
  });
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

export function getQuestionByIdInSession(questionId, sessionId) {
  const row = getDb()
    .prepare(`SELECT * FROM questions WHERE id = ? AND session_id = ?`)
    .get(questionId, sessionId);
  return row ? parseQuestionRow(row) : null;
}

export function setStudentViewMode(sessionId, adminToken, mode, data = null) {
  const payload = data ? JSON.stringify(data) : null;
  const result = getDb()
    .prepare(
      `UPDATE sessions
       SET student_view_mode = ?, student_view_data = ?
       WHERE id = ? AND admin_token = ?`
    )
    .run(mode, payload, sessionId, adminToken);
  return result.changes > 0;
}

export function getStudentViewForSession(sessionId) {
  const row = getDb()
    .prepare(`SELECT student_view_mode, student_view_data FROM sessions WHERE id = ?`)
    .get(sessionId);
  if (!row) return { mode: "waiting", data: null };
  let data = null;
  if (row.student_view_data) {
    try {
      data = JSON.parse(row.student_view_data);
    } catch {
      data = null;
    }
  }
  return { mode: row.student_view_mode || "waiting", data };
}

export function createStudentQuestion(sessionId, studentToken, text) {
  const result = getDb()
    .prepare(
      `INSERT INTO student_questions (session_id, student_token, text)
       VALUES (?, ?, ?)`
    )
    .run(sessionId, studentToken, text);
  const id = Number(result.lastInsertRowid);
  return getDb()
    .prepare(`SELECT id, session_id, student_token, text, created_at FROM student_questions WHERE id = ?`)
    .get(id);
}

export function listStudentQuestions(sessionId, adminToken) {
  const ok = getDb()
    .prepare(`SELECT 1 FROM sessions WHERE id = ? AND admin_token = ?`)
    .get(sessionId, adminToken);
  if (!ok) return null;
  return getDb()
    .prepare(
      `SELECT id, session_id, student_token, text, created_at
       FROM student_questions
       WHERE session_id = ?
       ORDER BY id DESC`
    )
    .all(sessionId);
}
