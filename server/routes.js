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
  createAdhocQuestion,
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
import { AiClientError, analyzeWithClaude, buildAnalysisInput } from "./ai.js";
import { getAdminUiPassword } from "./envAdminUi.js";

const ANALYZE_RATE_WINDOW_MS = 60_000;
const ANALYZE_RATE_MAX = 6;
const analyzeRate = new Map();

function adminUiPasswordHeaderOk(req) {
  return String(req.headers["x-admin-ui-password"] || "") === getAdminUiPassword();
}

/**
 * When ADMIN_UI_PASSWORD is set, only creating a new session requires it.
 * All other presenter APIs rely on the per-session admin token; students use WebSocket only.
 */
function requireAdminUiPassword(req, res, next) {
  const secret = getAdminUiPassword();
  if (!secret) return next();
  const path = (req.path || "").replace(/\/+$/, "") || "/";
  if (path === "/api/config" || path === "/api/admin-ui/login") return next();
  const isCreateSession = req.method === "POST" && path === "/api/sessions";
  if (!isCreateSession) return next();
  if (!adminUiPasswordHeaderOk(req)) {
    res.status(401).json({
      error: "Vy\u017eadov\u00e1no heslo admin rozhran\u00ed (pro zalo\u017een\u00ed nov\u00e9 relace).",
      adminUiLocked: true,
    });
    return;
  }
  next();
}

function adminTokenFromReq(req) {
  const h = req.headers.authorization;
  if (h && h.startsWith("Bearer ")) return h.slice(7);
  return String(req.headers["x-admin-token"] || "");
}

function checkAnalyzeRateLimit(sessionId, adminToken) {
  const key = `${sessionId}:${adminToken}`;
  const now = Date.now();
  const prev = analyzeRate.get(key);
  if (!prev || now - prev.windowStart >= ANALYZE_RATE_WINDOW_MS) {
    analyzeRate.set(key, { windowStart: now, count: 1 });
    return true;
  }
  if (prev.count >= ANALYZE_RATE_MAX) return false;
  prev.count += 1;
  analyzeRate.set(key, prev);
  return true;
}

export function createRouter() {
  const router = express.Router();
  router.use(express.json({ limit: "1mb" }));

  router.get("/api/config", (_req, res) => {
    res.json({ adminUiLocked: Boolean(getAdminUiPassword()) });
  });

  router.post("/api/admin-ui/login", (req, res) => {
    const secret = getAdminUiPassword();
    if (!secret) {
      res.json({ ok: true });
      return;
    }
    const p = String(req.body?.password || "");
    if (p !== secret) {
      res.status(401).json({ ok: false, error: "\u0160patn\u00e9 heslo" });
      return;
    }
    res.json({ ok: true });
  });

  router.use(requireAdminUiPassword);

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
      res.status(500).json({ error: "Na\u010dten\u00ed textu selhalo" });
    }
  });

  router.post("/api/sessions/:sessionId/show-reading", async (req, res) => {
    const sessionId = Number(req.params.sessionId);
    const adminToken = adminTokenFromReq(req);
    const ok = setStudentViewMode(sessionId, adminToken, "reading", {
      readingId: "alza-platebni-ekonomika",
    });
    if (!ok) {
      res.status(400).json({ error: "Nelze p\u0159epnout do reading re\u017eimu" });
      return;
    }
    try {
      const reading = await getDefaultReading();
      broadcastReadingActivated(sessionId, reading);
      notifyPresenterProgress(sessionId, null);
      res.json({ ok: true, reading });
    } catch {
      res.status(500).json({ error: "Na\u010dten\u00ed textu selhalo" });
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
        res.status(400).json({ error: "Nelze p\u0159epnout na ot\u00e1zku" });
        return;
      }
      broadcastQuestionActivated(sessionId, active);
      notifyPresenterProgress(sessionId, active.id);
      res.json({ ok: true, mode: "question", question: active });
      return;
    }
    const waiting = setStudentViewMode(sessionId, adminToken, "waiting", null);
    if (!waiting) {
      res.status(400).json({ error: "Nelze p\u0159epnout do \u010dek\u00e1n\u00ed" });
      return;
    }
    broadcastWaiting(sessionId);
    notifyPresenterProgress(sessionId, null);
    res.json({ ok: true, mode: "waiting" });
  });

  router.post("/api/sessions/:sessionId/questions/adhoc", (req, res) => {
    const sessionId = Number(req.params.sessionId);
    const adminToken = adminTokenFromReq(req);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const choicesFromText =
      typeof body.choicesText === "string"
        ? body.choicesText.split(/\r?\n/)
        : Array.isArray(body.choices)
          ? body.choices
          : [];

    const q = createAdhocQuestion(sessionId, adminToken, {
      mode: body.mode,
      text: body.text,
      min: body.min,
      max: body.max,
      choices: choicesFromText,
    });
    if (!q) {
      res.status(400).json({
        error:
          "Nelze vytvo\u0159it ot\u00e1zku. Zkontroluj zad\u00e1n\u00ed (text 1\u2013500 znak\u016f, ANO/NE, rozsah \u010d\u00edsla, 2\u201312 mo\u017enost\u00ed).",
      });
      return;
    }

    if (body.activate) {
      const activated = activateQuestion(sessionId, q.id, adminToken);
      if (activated) {
        const active = getQuestion(sessionId, q.id, adminToken);
        broadcastQuestionActivated(sessionId, active);
        const rows = listResponsesForQuestion(q.id);
        const results = computeResults(active, rows);
        notifyPresenterResponse(sessionId, q.id, active);
        notifyPresenterProgress(sessionId, q.id);
        res.json({ ok: true, question: active, results, activated: true });
        return;
      }
    }
    res.json({ ok: true, question: q, activated: false });
  });

  router.post("/api/sessions/:sessionId/questions/:questionId/activate", (req, res) => {
    const sessionId = Number(req.params.sessionId);
    const questionId = Number(req.params.questionId);
    const adminToken = adminTokenFromReq(req);
    const ok = activateQuestion(sessionId, questionId, adminToken);
    if (!ok) {
      res.status(400).json({ error: "Aktivace se nezda\u0159ila" });
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
      res.status(400).json({ error: "Uzav\u0159en\u00ed se nezda\u0159ilo" });
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
      res.status(400).json({ error: "Reset ot\u00e1zky se nezda\u0159il" });
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
      res.status(400).json({ error: "Chyb\u00ed questionId" });
      return;
    }
    const q = getQuestion(sessionId, questionId, adminToken);
    if (!q) {
      res.status(404).json({ error: "Ot\u00e1zka nenalezena" });
      return;
    }
    const modeSet = setStudentViewMode(sessionId, adminToken, "results", { questionId });
    if (!modeSet) {
      res.status(400).json({ error: "Nelze p\u0159epnout na v\u00fdsledky" });
      return;
    }
    const rows = listResponsesForQuestion(questionId);
    const results = computeResults(q, rows);
    broadcastShowResults(sessionId, results);
    res.json({ ok: true, results });
  });

  router.get("/api/sessions/:sessionId/questions/:questionId/analysis-input", (req, res) => {
    const sessionId = Number(req.params.sessionId);
    const questionId = Number(req.params.questionId);
    const adminToken = adminTokenFromReq(req);
    const q = getQuestion(sessionId, questionId, adminToken);
    if (!q) {
      res.status(404).json({ error: "Ot\u00e1zka nenalezena" });
      return;
    }
    const rows = listResponsesForQuestion(questionId);
    res.json({ ok: true, input: buildAnalysisInput(q, rows) });
  });

  router.post("/api/sessions/:sessionId/analyze", async (req, res) => {
    const sessionId = Number(req.params.sessionId);
    const adminToken = adminTokenFromReq(req);
    const questionId = Number(req.body?.questionId);
    const instruction = typeof req.body?.instruction === "string" ? req.body.instruction.trim() : "";

    if (!questionId) {
      res.status(400).json({ error: "Chyb\u00ed questionId" });
      return;
    }
    if (instruction.length > 2000) {
      res.status(400).json({ error: "Dopl\u0148kov\u00fd pokyn je p\u0159\u00edli\u0161 dlouh\u00fd (max 2000 znak\u016f)." });
      return;
    }
    if (!checkAnalyzeRateLimit(sessionId, adminToken)) {
      res.status(429).json({ error: "Limit AI anal\u00fdz vy\u010derp\u00e1n, zkus to pros\u00edm za minutu." });
      return;
    }

    const q = getQuestion(sessionId, questionId, adminToken);
    if (!q) {
      res.status(404).json({ error: "Ot\u00e1zka nenalezena" });
      return;
    }
    const rows = listResponsesForQuestion(questionId);

    try {
      const analysis = await analyzeWithClaude(q, rows, instruction);
      res.json({ ok: true, analysis });
    } catch (error) {
      if (error instanceof AiClientError) {
        res.status(error.status || 500).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: "AI anal\u00fdza selhala." });
    }
  });

  router.post("/api/sessions/:sessionId/close-session", (req, res) => {
    const sessionId = Number(req.params.sessionId);
    const adminToken = adminTokenFromReq(req);
    const ok = closeSession(sessionId, adminToken);
    if (!ok) {
      res.status(400).json({ error: "Nelze ukon\u010dit" });
      return;
    }
    broadcastQuestionClosed(sessionId);
    res.json({ ok: true });
  });

  return router;
}
