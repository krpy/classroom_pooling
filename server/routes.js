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
} from "./db.js";
import { computeResults } from "./aggregate.js";
import {
  broadcastQuestionActivated,
  broadcastQuestionClosed,
  broadcastShowResults,
  broadcastWaiting,
  notifyPresenterProgress,
  notifyPresenterResponse,
} from "./websocket.js";

function adminTokenFromReq(req) {
  const h = req.headers.authorization;
  if (h && h.startsWith("Bearer ")) return h.slice(7);
  return String(req.headers["x-admin-token"] || "");
}

export function createRouter() {
  const router = express.Router();
  router.use(express.json({ limit: "256kb" }));

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
      const results =
        rows.length > 0 ? computeResults(q, rows) : null;
      return { ...q, results };
    });
    res.json({ session: bundle.session, questions });
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
    } catch (e) {
      res.status(500).json({ error: "QR selhalo" });
    }
  });

  router.post(
    "/api/sessions/:sessionId/questions/:questionId/activate",
    (req, res) => {
      const sessionId = Number(req.params.sessionId);
      const questionId = Number(req.params.questionId);
      const adminToken = adminTokenFromReq(req);
      const ok = activateQuestion(sessionId, questionId, adminToken);
      if (!ok) {
        res.status(400).json({ error: "Aktivace se nezdařila" });
        return;
      }
      const q = getQuestion(sessionId, questionId, adminToken);
      broadcastQuestionActivated(sessionId, q);
      const rows = listResponsesForQuestion(questionId);
      const results = computeResults(q, rows);
      notifyPresenterResponse(sessionId, questionId, q);
      notifyPresenterProgress(sessionId, questionId);
      res.json({ ok: true, question: q, results });
    }
  );

  router.post(
    "/api/sessions/:sessionId/questions/:questionId/close",
    (req, res) => {
      const sessionId = Number(req.params.sessionId);
      const questionId = Number(req.params.questionId);
      const adminToken = adminTokenFromReq(req);
      const ok = closeQuestion(sessionId, questionId, adminToken);
      if (!ok) {
        res.status(400).json({ error: "Uzavření se nezdařilo" });
        return;
      }
      broadcastQuestionClosed(sessionId);
      broadcastWaiting(sessionId);
      notifyPresenterProgress(sessionId, null);
      res.json({ ok: true });
    }
  );

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
      res.status(400).json({ error: "Nelze ukončit" });
      return;
    }
    broadcastQuestionClosed(sessionId);
    res.json({ ok: true });
  });

  return router;
}
