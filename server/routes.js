import express from "express";
import QRCode from "qrcode";
import {
  createSession,
  getSessionForPresenter,
  getQuestion,
  activateQuestion,
  closeQuestion,
  closeSession,
  listResponsesForQuestion,
  resetQuestion,
  setStudentViewMode,
  getActiveQuestionForSession,
  listStudentQuestions,
} from "./db.js";
import { computeResults } from "./aggregate.js";
import {
  broadcastQuestionActivated,
  broadcastQuestionClosed,
  broadcastShowResults,
  broadcastWaiting,
  notifyPresenterProgress,
  notifyPresenterResponse,
  broadcastReadingActivated,
} from "./websocket.js";
import { getDefaultReading } from "./reading.js";

function adminTokenFromReq(req) {
  const h = req.headers.authorization;
  if (h && h.startsWith("Bearer ")) return h.slice(7);
  return String(req.headers["x-admin-token"] || "");
}

export function createRouter() {
  const router = express.Router();
  router.use(express.json({ limit: "1mb" }));

  router.post("/api/sessions", (_req, res) => {
    const { sessionId, code, adminToken } = createSession();
    res.json({ sessionId, code, adminToken });
  });

  router.get("/api/sessions/:sessionId/present", (req, res) => {
    const sessionId = Number(req.params.sessionId);
    const adminToken = adminTokenFromReq(req);
    const bundle = getSessionForPresenter(sessionId, adminToken);
    if (!bundle) {
      res.status(404).json({ error: "Nenalezeno" });
      return;
    }
    const questions = bundle.questions.map((q) => {
      const rows = listResponsesForQuestion(q.id);
      const results = rows.length > 0 ? computeResults(q, rows) : null;
      return { ...q, results };
    });
    const studentQuestions = listStudentQuestions(sessionId, adminToken) || [];
    res.json({
      session: bundle.session,
      questions,
      studentQuestions,
      studentView: {
        mode: bundle.session.student_view_mode,
        data: bundle.session.student_view_data,
      },
    });
  });

  router.get("/api/sessions/:sessionId/qr", async (req, res) => {
    const sessionId = Number(req.params.sessionId);
    const adminToken = adminTokenFromReq(req);
    const bundle = getSessionForPresenter(sessionId, adminToken);
    if (!bundle) {
      res.status(404).json({ error: "Nenalezeno" });
      return;
    }
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const base = `${proto}://${host}`;
    const url = `${base}/?pin=${encodeURIComponent(bundle.session.code)}`;
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        margin: 1,
        width: 320,
        errorCorrectionLevel: "M",
      });
      res.json({ url, dataUrl });
    } catch {
      res.status(500).json({ error: "QR selhalo" });
    }
  });

  router.get("/api/readings/default", async (_req, res) => {
    try {
      const reading = await getDefaultReading();
      res.json(reading);
    } catch {
      res.status(500).json({ error: "Naètení textu selhalo" });
    }
  });

  router.post("/api/sessions/:sessionId/show-reading", async (req, res) => {
    const sessionId = Number(req.params.sessionId);
    const adminToken = adminTokenFromReq(req);
    const ok = setStudentViewMode(sessionId, adminToken, "reading", {
      readingId: "alza-platebni-ekonomika",
    });
    if (!ok) {
      res.status(400).json({ error: "Nelze pøepnout do reading režimu" });
      return;
    }
    try {
      const reading = await getDefaultReading();
      broadcastReadingActivated(sessionId, reading);
      notifyPresenterProgress(sessionId, null);
      res.json({ ok: true, reading });
    } catch {
      res.status(500).json({ error: "Naètení textu selhalo" });
    }
  });

  router.post("/api/sessions/:sessionId/show-question", (req, res) => {
    const sessionId = Number(req.params.sessionId);
    const adminToken = adminTokenFromReq(req);
    const active = getActiveQuestionForSession(sessionId);
    if (active) {
      const ok = setStudentViewMode(sessionId, adminToken, "question", {
        questionId: active.id,
      });
      if (!ok) {
        res.status(400).json({ error: "Nelze pøepnout na otázku" });
        return;
      }
      broadcastQuestionActivated(sessionId, active);
      notifyPresenterProgress(sessionId, active.id);
      res.json({ ok: true, mode: "question", question: active });
      return;
    }
    const waiting = setStudentViewMode(sessionId, adminToken, "waiting", null);
    if (!waiting) {
      res.status(400).json({ error: "Nelze pøepnout do èekání" });
      return;
    }
    broadcastWaiting(sessionId);
    notifyPresenterProgress(sessionId, null);
    res.json({ ok: true, mode: "waiting" });
  });

  router.post("/api/sessions/:sessionId/questions/:questionId/activate", (req, res) => {
    const sessionId = Number(req.params.sessionId);
    const questionId = Number(req.params.questionId);
    const adminToken = adminTokenFromReq(req);
    const ok = activateQuestion(sessionId, questionId, adminToken);
    if (!ok) {
      res.status(400).json({ error: "Aktivace se nezdaøila" });
      return;
    }
    const q = getQuestion(sessionId, questionId, adminToken);
    broadcastQuestionActivated(sessionId, q);
    const rows = listResponsesForQuestion(questionId);
    const results = computeResults(q, rows);
    notifyPresenterResponse(sessionId, questionId, q);
    notifyPresenterProgress(sessionId, questionId);
    res.json({ ok: true, question: q, results });
  });

  router.post("/api/sessions/:sessionId/questions/:questionId/close", (req, res) => {
    const sessionId = Number(req.params.sessionId);
    const questionId = Number(req.params.questionId);
    const adminToken = adminTokenFromReq(req);
    const ok = closeQuestion(sessionId, questionId, adminToken);
    if (!ok) {
      res.status(400).json({ error: "Uzavøení se nezdaøilo" });
      return;
    }
    broadcastQuestionClosed(sessionId);
    broadcastWaiting(sessionId);
    notifyPresenterProgress(sessionId, null);
    res.json({ ok: true });
  });

  router.post("/api/sessions/:sessionId/questions/:questionId/reset", (req, res) => {
    const sessionId = Number(req.params.sessionId);
    const questionId = Number(req.params.questionId);
    const adminToken = adminTokenFromReq(req);
    const ok = resetQuestion(sessionId, questionId, adminToken);
    if (!ok) {
      res.status(400).json({ error: "Reset otázky se nezdaøil" });
      return;
    }
    broadcastWaiting(sessionId);
    notifyPresenterProgress(sessionId, null);
    res.json({ ok: true });
  });

  router.post("/api/sessions/:sessionId/show-results", (req, res) => {
    const sessionId = Number(req.params.sessionId);
    const adminToken = adminTokenFromReq(req);
    const questionId = Number(req.body?.questionId);
    if (!questionId) {
      res.status(400).json({ error: "Chybí questionId" });
      return;
    }
    const q = getQuestion(sessionId, questionId, adminToken);
    if (!q) {
      res.status(404).json({ error: "Otázka nenalezena" });
      return;
    }
    const modeSet = setStudentViewMode(sessionId, adminToken, "results", { questionId });
    if (!modeSet) {
      res.status(400).json({ error: "Nelze pøepnout na výsledky" });
      return;
    }
    const rows = listResponsesForQuestion(questionId);
    const results = computeResults(q, rows);
    broadcastShowResults(sessionId, results);
    res.json({ ok: true, results });
  });

  router.post("/api/sessions/:sessionId/close-session", (req, res) => {
    const sessionId = Number(req.params.sessionId);
    const adminToken = adminTokenFromReq(req);
    const ok = closeSession(sessionId, adminToken);
    if (!ok) {
      res.status(400).json({ error: "Nelze ukonèit" });
      return;
    }
    broadcastQuestionClosed(sessionId);
    res.json({ ok: true });
  });

  return router;
}
