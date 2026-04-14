import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import {
  getSessionByCode,
  getActiveQuestionForSession,
  upsertResponse,
  listResponsesForQuestion,
  getQuestionByIdInSession,
  getSessionForPresenter,
  getStudentViewForSession,
  createStudentQuestion,
} from "./db.js";
import { computeResults, validateResponseValue } from "./aggregate.js";
import { getDefaultReading } from "./reading.js";

/** @typedef {{ ws: import('ws').WebSocket, role: 'student' | 'presenter', sessionId: number, studentToken?: string }} ClientMeta */

/** @type {Map<string, ClientMeta>} */
const clients = new Map();

/** @type {import('ws').WebSocketServer | null} */
let wss = null;

const ADMIN_UI_PASSWORD = String(process.env.ADMIN_UI_PASSWORD || "").trim();

export function setupWebSocket(server) {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        safeSend(ws, { type: "error", message: "Neplatn˜ zpr˜va" });
        return;
      }
      Promise.resolve(handleMessage(ws, msg)).catch((err) => {
        safeSend(ws, { type: "error", message: "Chyba websocketu" });
      });
    });

    ws.on("close", () => {
      const closedStudentSessions = new Set();
      for (const [key, meta] of clients.entries()) {
        if (meta.ws === ws) {
          if (meta.role === "student") {
            closedStudentSessions.add(meta.sessionId);
          }
          clients.delete(key);
        }
      }
      for (const sessionId of closedStudentSessions) {
        notifyPresenterProgress(sessionId);
      }
    });
  });

  return wss;
}

function safeSend(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function studentKey(sessionId, token) {
  return `s:${sessionId}:${token}`;
}

async function handleMessage(ws, msg) {
  if (msg.type === "join") {
    await handleJoinStudent(ws, msg);
    return;
  }
  if (msg.type === "join_presenter") {
    handleJoinPresenter(ws, msg);
    return;
  }
  if (msg.type === "submit") {
    handleSubmit(ws, msg);
    return;
  }
  if (msg.type === "ask_question") {
    handleAskQuestion(ws, msg);
    return;
  }
  safeSend(ws, { type: "error", message: "Nezn˜m˜ typ zpr˜vy" });
}

async function handleJoinStudent(ws, msg) {
  const pin = String(msg.pin || "").trim();
  const studentToken = String(msg.studentToken || "").trim();
  if (!/^\d{4}$/.test(pin) || !studentToken) {
    safeSend(ws, { type: "error", message: "Chyb˜ PIN nebo token" });
    return;
  }
  const session = getSessionByCode(pin);
  if (!session) {
    safeSend(ws, { type: "error", message: "Neplatn˜ PIN nebo relace je ukon˜ena" });
    return;
  }
  const sessionId = session.id;
  clients.set(studentKey(sessionId, studentToken), {
    ws,
    role: "student",
    sessionId,
    studentToken,
  });

  const view = getStudentViewForSession(sessionId);
  if (view.mode === "reading") {
    const reading = await getDefaultReading();
    safeSend(ws, { type: "reading_activated", reading });
    notifyPresenterProgress(sessionId, null);
    return;
  }

  if (view.mode === "results") {
    const qId = Number(view.data?.questionId);
    const question = qId ? getQuestionByIdInSession(qId, sessionId) : null;
    if (question) {
      const results = computeResults(question, listResponsesForQuestion(qId));
      safeSend(ws, { type: "show_results", results });
      notifyPresenterProgress(sessionId, qId);
      return;
    }
  }

  const active = getActiveQuestionForSession(sessionId);
  if (active) {
    safeSend(ws, {
      type: "question_activated",
      question: publicQuestion(active),
    });
  } else {
    safeSend(ws, { type: "waiting" });
  }
  notifyPresenterProgress(sessionId, active?.id ?? null);
}

function handleJoinPresenter(ws, msg) {
  if (ADMIN_UI_PASSWORD && String(msg.adminUiPassword || "") !== ADMIN_UI_PASSWORD) {
    safeSend(ws, { type: "error", message: "Chyb\u00ed heslo admin rozhran\u00ed" });
    return;
  }
  const sessionId = Number(msg.sessionId);
  const adminToken = String(msg.adminToken || "");
  if (!sessionId || !adminToken) {
    safeSend(ws, { type: "error", message: "Chyb˜ relace" });
    return;
  }
  const bundle = getSessionForPresenter(sessionId, adminToken);
  if (!bundle) {
    safeSend(ws, { type: "error", message: "Neplatn˜ p˜˜stup lektora" });
    return;
  }
  clients.set(`p:${sessionId}:${randomUUID()}`, { ws, role: "presenter", sessionId });
  safeSend(ws, { type: "presenter_ready", sessionId });
  notifyPresenterProgress(sessionId);
}

function findStudentMeta(ws) {
  for (const meta of clients.values()) {
    if (meta.role === "student" && meta.ws === ws) return meta;
  }
  return null;
}

function handleSubmit(ws, msg) {
  const meta = findStudentMeta(ws);
  if (!meta || !meta.studentToken) {
    safeSend(ws, { type: "error", message: "Nejd˜˜v se p˜ipoj (join)" });
    return;
  }
  const questionId = Number(msg.questionId);
  const studentToken = String(msg.studentToken || "");
  if (studentToken !== meta.studentToken) {
    safeSend(ws, { type: "error", message: "Token neodpov˜d˜ p˜ipojen˜" });
    return;
  }
  const value = msg.value;
  if (value === undefined || typeof value !== "object") {
    safeSend(ws, { type: "error", message: "Chyb˜ odpov˜˜" });
    return;
  }

  const question = getQuestionByIdInSession(questionId, meta.sessionId);
  if (!question || question.status !== "active") {
    safeSend(ws, { type: "error", message: "Ot˜zka nen˜ aktivn˜" });
    return;
  }
  if (!validateResponseValue(question, value)) {
    safeSend(ws, { type: "error", message: "Neplatn˜ form˜t odpov˜di" });
    return;
  }

  upsertResponse(questionId, studentToken, value);

  const results = computeResults(question, listResponsesForQuestion(questionId));
  const progress = buildProgress(meta.sessionId, questionId);
  broadcastToPresenters(meta.sessionId, {
    type: "response_received",
    questionId,
    results,
    progress,
  });
}

function handleAskQuestion(ws, msg) {
  const meta = findStudentMeta(ws);
  if (!meta || !meta.studentToken) {
    safeSend(ws, { type: "error", message: "Nejd˜˜v se p˜ipoj (join)" });
    return;
  }
  const text = String(msg.text || "").trim();
  if (!text) {
    safeSend(ws, { type: "error", message: "Napi˜ dotaz" });
    return;
  }
  if (text.length > 1000) {
    safeSend(ws, { type: "error", message: "Dotaz je p˜˜li˜ dlouh˜" });
    return;
  }
  const saved = createStudentQuestion(meta.sessionId, meta.studentToken, text);
  safeSend(ws, { type: "question_saved" });
  broadcastToPresenters(meta.sessionId, {
    type: "student_question_received",
    question: saved,
  });
}

function publicQuestion(q) {
  return {
    id: q.id,
    type: q.type,
    text: q.text,
    options: q.options,
    order_index: q.order_index,
    status: q.status,
  };
}

export function broadcastQuestionActivated(sessionId, question) {
  const payload = { type: "question_activated", question: publicQuestion(question) };
  for (const [key, meta] of clients.entries()) {
    if (key.startsWith(`s:${sessionId}:`)) safeSend(meta.ws, payload);
  }
}

export function broadcastQuestionClosed(sessionId) {
  const payload = { type: "question_closed" };
  for (const [key, meta] of clients.entries()) {
    if (key.startsWith(`s:${sessionId}:`)) safeSend(meta.ws, payload);
  }
}

export function broadcastWaiting(sessionId) {
  const payload = { type: "waiting" };
  for (const [key, meta] of clients.entries()) {
    if (key.startsWith(`s:${sessionId}:`)) safeSend(meta.ws, payload);
  }
}

export function broadcastShowResults(sessionId, results) {
  const payload = { type: "show_results", results };
  for (const [key, meta] of clients.entries()) {
    if (key.startsWith(`s:${sessionId}:`)) safeSend(meta.ws, payload);
  }
}

export function broadcastReadingActivated(sessionId, reading) {
  const payload = { type: "reading_activated", reading };
  for (const [key, meta] of clients.entries()) {
    if (key.startsWith(`s:${sessionId}:`)) safeSend(meta.ws, payload);
  }
}

function broadcastToPresenters(sessionId, payload) {
  for (const meta of clients.values()) {
    if (meta.role === "presenter" && meta.sessionId === sessionId) {
      safeSend(meta.ws, payload);
    }
  }
}

function countConnectedStudents(sessionId) {
  let count = 0;
  for (const meta of clients.values()) {
    if (meta.role === "student" && meta.sessionId === sessionId) {
      count += 1;
    }
  }
  return count;
}

function buildProgress(sessionId, questionId = null) {
  const activeQuestionId = questionId ?? getActiveQuestionForSession(sessionId)?.id ?? null;
  const connectedStudents = countConnectedStudents(sessionId);
  if (!activeQuestionId) {
    return {
      questionId: null,
      connectedStudents,
      submittedCount: 0,
      waitingCount: connectedStudents,
    };
  }
  const submittedCount = listResponsesForQuestion(activeQuestionId).length;
  return {
    questionId: activeQuestionId,
    connectedStudents,
    submittedCount,
    waitingCount: Math.max(0, connectedStudents - submittedCount),
  };
}

export function notifyPresenterProgress(sessionId, questionId = null) {
  broadcastToPresenters(sessionId, {
    type: "progress_update",
    progress: buildProgress(sessionId, questionId),
  });
}

export function notifyPresenterResponse(sessionId, questionId, question) {
  const results = computeResults(question, listResponsesForQuestion(questionId));
  broadcastToPresenters(sessionId, {
    type: "response_received",
    questionId,
    results,
    progress: buildProgress(sessionId, questionId),
  });
}
