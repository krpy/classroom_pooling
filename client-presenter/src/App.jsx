import { useCallback, useEffect, useMemo, useState } from "react";
import LiveResultsChart from "./components/LiveResultsChart.jsx";

const ADMIN_UI_STORAGE_KEY = "cp_admin_ui_password";

function readAdminUiPassword() {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(ADMIN_UI_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function createSessionHeaders() {
  const h = { "Content-Type": "application/json" };
  const ui = readAdminUiPassword();
  if (ui) h["X-Admin-UI-Password"] = ui;
  return h;
}

function apiHeaders(adminToken) {
  const ui = readAdminUiPassword();
  const h = {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };
  if (ui) h["X-Admin-UI-Password"] = ui;
  return h;
}

const BLANK_QUICK_SLOTS = [
  { id: "q1", label: "Ot\u00e1zka 1", text: "" },
  { id: "q2", label: "Ot\u00e1zka 2", text: "" },
  { id: "q3", label: "Ot\u00e1zka 3", text: "" },
];

export default function App() {
  const [sessionId, setSessionId] = useState(null);
  const [adminToken, setAdminToken] = useState(null);
  const [code, setCode] = useState(null);
  const [session, setSession] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [studentQuestions, setStudentQuestions] = useState([]);
  const [studentView, setStudentView] = useState({ mode: "waiting", data: null });
  const [qr, setQr] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [liveResults, setLiveResults] = useState(null);
  const [selectedResultQuestionId, setSelectedResultQuestionId] = useState(null);
  const [progress, setProgress] = useState(null);
  const [reading, setReading] = useState(null);
  const [error, setError] = useState(null);
  const [adhocMode, setAdhocMode] = useState("yes_no");
  const [adhocText, setAdhocText] = useState("");
  const [adhocMin, setAdhocMin] = useState("0");
  const [adhocMax, setAdhocMax] = useState("100");
  const [adhocChoices, setAdhocChoices] = useState("");
  const [adhocActivate, setAdhocActivate] = useState(true);
  const [adhocBusy, setAdhocBusy] = useState(false);
  const [quickSlots, setQuickSlots] = useState(BLANK_QUICK_SLOTS);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisInstruction, setAnalysisInstruction] = useState("");
  const [analysisResult, setAnalysisResult] = useState(null);
  const [exportInput, setExportInput] = useState(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [exportCopied, setExportCopied] = useState(false);
  const [adminUiBootstrapped, setAdminUiBootstrapped] = useState(false);
  const [adminUiConfigError, setAdminUiConfigError] = useState(null);
  const [adminUiConfigRetryKey, setAdminUiConfigRetryKey] = useState(0);
  const [adminUiLocked, setAdminUiLocked] = useState(false);
  const [gateUnlocked, setGateUnlocked] = useState(
    () => typeof window !== "undefined" && !!sessionStorage.getItem(ADMIN_UI_STORAGE_KEY)
  );
  const [gatePassword, setGatePassword] = useState("");
  const [gateError, setGateError] = useState("");

  const wsUrl = useMemo(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  }, []);

  const forceAdminRelogin = useCallback(() => {
    try {
      sessionStorage.removeItem(ADMIN_UI_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    window.location.reload();
  }, []);

  const loadSession = useCallback(
    async (sid, token) => {
      const res = await fetch(`/api/sessions/${sid}/present`, {
        headers: apiHeaders(token),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        if (res.status === 401 && errBody.adminUiLocked) {
          forceAdminRelogin();
          return;
        }
        throw new Error(errBody.error || "Na\u010dten\u00ed relace selhalo");
      }
      const data = await res.json();
      setSession(data.session);
      setQuestions(data.questions);
      setStudentQuestions(data.studentQuestions || []);
      setStudentView(data.studentView || { mode: "waiting", data: null });
      const active = data.questions.find((q) => q.status === "active");
      setActiveId(active ? active.id : null);
      setLiveResults(active?.results || null);
      if (!data.questions.some((q) => q.id === selectedResultQuestionId)) {
        const firstWithResults = data.questions.find((q) => q.results);
        setSelectedResultQuestionId(firstWithResults?.id ?? active?.id ?? null);
      }
      const qrRes = await fetch(`/api/sessions/${sid}/qr`, {
        headers: apiHeaders(token),
      });
      if (qrRes.ok) {
        setQr(await qrRes.json());
      }
    },
    [selectedResultQuestionId, forceAdminRelogin]
  );

  useEffect(() => {
    let cancelled = false;
    setAdminUiBootstrapped(false);
    setAdminUiConfigError(null);
    (async () => {
      try {
        const r = await fetch("/api/config");
        if (!r.ok) {
          if (!cancelled) {
            setAdminUiConfigError(
              `Konfiguraci nelze na\u010d\u00edst (HTTP ${r.status}). Zkontrolujte URL a nasazen\u00ed serveru.`
            );
          }
          return;
        }
        const j = await r.json().catch(() => null);
        if (!j || typeof j.adminUiLocked !== "boolean") {
          if (!cancelled) {
            setAdminUiConfigError(
              "Server nevr\u00e1til platn\u00fd JSON z /api/config (mo\u017en\u00e1 star\u00e9 nasazen\u00ed nebo chybn\u00e1 cesta)."
            );
          }
          return;
        }
        if (!cancelled) setAdminUiLocked(!!j.adminUiLocked);
      } catch {
        if (!cancelled) {
          setAdminUiConfigError(
            "Konfiguraci nelze na\u010d\u00edst (s\u00ed\u0165 nebo CORS). Zkuste znovu nebo zkontrolujte, \u017ee b\u011b\u017e\u00ed stejn\u00fd host jako presenter."
          );
        }
      } finally {
        if (!cancelled) setAdminUiBootstrapped(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminUiConfigRetryKey]);

  useEffect(() => {
    if (!sessionId || !adminToken) return undefined;
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      const payload = {
        type: "join_presenter",
        sessionId,
        adminToken,
      };
      const ui = readAdminUiPassword();
      if (ui) payload.adminUiPassword = ui;
      ws.send(JSON.stringify(payload));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "response_received" && msg.results) {
          setLiveResults(msg.results);
          if (msg.progress) setProgress(msg.progress);
        }
        if (msg.type === "progress_update" && msg.progress) {
          setProgress(msg.progress);
        }
        if (msg.type === "student_question_received" && msg.question) {
          setStudentQuestions((prev) => [msg.question, ...prev]);
        }
      } catch {
        // ignore malformed payload
      }
    };
    return () => ws.close();
  }, [sessionId, adminToken, wsUrl]);

  useEffect(() => {
    setAnalysisResult(null);
    setExportInput(null);
    setExportError(null);
    setExportLoading(false);
    setExportCopied(false);
  }, [selectedResultQuestionId]);

  const submitAdminGate = async () => {
    setGateError("");
    try {
      const res = await fetch("/api/admin-ui/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: gatePassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGateError(data.error || "Neplatn\u00e9 heslo");
        return;
      }
      sessionStorage.setItem(ADMIN_UI_STORAGE_KEY, gatePassword);
      setGatePassword("");
      setGateUnlocked(true);
    } catch {
      setGateError("Chyba p\u0159ipojen\u00ed");
    }
  };

  const createSession = async () => {
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: createSessionHeaders(),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        if (res.status === 401 && errBody.adminUiLocked) {
          forceAdminRelogin();
          return;
        }
        throw new Error(errBody.error || "Vytvo\u0159en\u00ed relace selhalo");
      }
      const data = await res.json();
      setSessionId(data.sessionId);
      setAdminToken(data.adminToken);
      setCode(data.code);
      const readingRes = await fetch("/api/readings/default");
      if (readingRes.ok) setReading(await readingRes.json());
      await loadSession(data.sessionId, data.adminToken);
    } catch (e) {
      setError(e.message || "Chyba");
    }
  };

  const activate = async (questionId) => {
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/questions/${questionId}/activate`, {
        method: "POST",
        headers: apiHeaders(adminToken),
      });
      if (!res.ok) throw new Error("Aktivace selhala");
      const data = await res.json();
      setActiveId(questionId);
      setLiveResults(data.results);
      setSelectedResultQuestionId(questionId);
      await loadSession(sessionId, adminToken);
    } catch (e) {
      setError(e.message || "Chyba");
    }
  };

  const closeQuestion = async (questionId) => {
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/questions/${questionId}/close`, {
        method: "POST",
        headers: apiHeaders(adminToken),
      });
      if (!res.ok) throw new Error("Uzav\u0159en\u00ed selhalo");
      setActiveId(null);
      setLiveResults(null);
      setProgress(null);
      await loadSession(sessionId, adminToken);
    } catch (e) {
      setError(e.message || "Chyba");
    }
  };

  const resetQuestion = async (questionId) => {
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/questions/${questionId}/reset`, {
        method: "POST",
        headers: apiHeaders(adminToken),
      });
      if (!res.ok) throw new Error("Reset ot\u00e1zky selhal");
      await loadSession(sessionId, adminToken);
    } catch (e) {
      setError(e.message || "Chyba");
    }
  };

  const showResults = async (questionId) => {
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/show-results`, {
        method: "POST",
        headers: apiHeaders(adminToken),
        body: JSON.stringify({ questionId }),
      });
      if (!res.ok) throw new Error("Odesl\u00e1n\u00ed v\u00fdsledk\u016f selhalo");
      await loadSession(sessionId, adminToken);
    } catch (e) {
      setError(e.message || "Chyba");
    }
  };

  const showReading = async () => {
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/show-reading`, {
        method: "POST",
        headers: apiHeaders(adminToken),
      });
      if (!res.ok) throw new Error("P\u0159epnut\u00ed na reading selhalo");
      const data = await res.json();
      setReading(data.reading || null);
      await loadSession(sessionId, adminToken);
    } catch (e) {
      setError(e.message || "Chyba");
    }
  };

  const showQuestionMode = async () => {
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/show-question`, {
        method: "POST",
        headers: apiHeaders(adminToken),
      });
      if (!res.ok) throw new Error("P\u0159epnut\u00ed na ot\u00e1zku/\u010dek\u00e1n\u00ed selhalo");
      await loadSession(sessionId, adminToken);
    } catch (e) {
      setError(e.message || "Chyba");
    }
  };

  const selectedResultQuestion = questions.find((q) => q.id === selectedResultQuestionId) || null;

  const createAdhocQuick = async () => {
    if (!sessionId || !adminToken) return;
    setAdhocBusy(true);
    setError(null);
    try {
      const body = {
        mode: adhocMode,
        text: adhocText.trim(),
        activate: adhocActivate,
      };
      if (adhocMode === "number") {
        body.min = Number(adhocMin);
        body.max = Number(adhocMax);
      }
      if (adhocMode === "choice") {
        body.choicesText = adhocChoices;
      }
      const res = await fetch(`/api/sessions/${sessionId}/questions/adhoc`, {
        method: "POST",
        headers: apiHeaders(adminToken),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Rychl\u00e1 ot\u00e1zka se nepoda\u0159ila");
      }
      await loadSession(sessionId, adminToken);
      if (data.results) setLiveResults(data.results);
      if (data.question?.id && data.activated) {
        setActiveId(data.question.id);
        setSelectedResultQuestionId(data.question.id);
      }
      setAdhocText("");
      setAdhocChoices("");
    } catch (e) {
      setError(e.message || "Chyba");
    } finally {
      setAdhocBusy(false);
    }
  };

  const updateQuickSlot = (slotId, text) => {
    setQuickSlots((prev) => prev.map((s) => (s.id === slotId ? { ...s, text } : s)));
  };

  const loadQuickSlotToForm = (slotText) => {
    setAdhocText(slotText);
  };

  const runClaudeAnalysis = async () => {
    if (!sessionId || !adminToken || !selectedResultQuestion?.id) return;
    setAnalysisBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/analyze`, {
        method: "POST",
        headers: apiHeaders(adminToken),
        body: JSON.stringify({
          questionId: selectedResultQuestion.id,
          instruction: analysisInstruction.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "AI anal\u00fdza selhala");
      }
      setAnalysisResult(data.analysis || null);
    } catch (e) {
      setError(e.message || "Chyba");
    } finally {
      setAnalysisBusy(false);
    }
  };

  const fetchAnalysisInputExport = async () => {
    if (!sessionId || !adminToken || !selectedResultQuestion?.id) return;
    setExportLoading(true);
    setExportError(null);
    setExportCopied(false);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/questions/${selectedResultQuestion.id}/analysis-input`,
        { headers: apiHeaders(adminToken) }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Nepoda\u0159ilo se na\u010d\u00edst export");
      }
      setExportInput(data.input || null);
    } catch (e) {
      setExportError(e.message || "Chyba");
      setExportInput(null);
    } finally {
      setExportLoading(false);
    }
  };

  const copyExportInput = async () => {
    if (!exportInput) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(exportInput, null, 2));
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 2000);
    } catch {
      setExportError("Kop\u00edrov\u00e1n\u00ed selhalo (opr\u00e1vn\u011bn\u00ed prohl\u00ed\u017ee\u010de?).");
    }
  };

  if (!adminUiBootstrapped) {
    return (
      <div style={styles.page}>
        <p style={styles.muted}>{"Na\u010d\u00edt\u00e1m\u2026"}</p>
      </div>
    );
  }

  if (adminUiConfigError) {
    return (
      <div style={styles.page}>
        <div style={styles.gateCard}>
          <h1 style={styles.h1}>{"Konfigurace adminu"}</h1>
          <p style={styles.err}>{adminUiConfigError}</p>
          <p style={styles.muted}>
            {
              "Po nastaven\u00ed ADMIN_UI_PASSWORD na Railway prove\u010fte redeploy slu\u017eby a ov\u011b\u0159te v logu zpr\u00e1vu o zapnut\u00ed br\u00e1ny."
            }
          </p>
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              style={styles.primary}
              onClick={() => setAdminUiConfigRetryKey((k) => k + 1)}
            >
              {"Zkusit znovu"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (adminUiLocked && !gateUnlocked) {
    return (
      <div style={styles.page}>
        <div style={styles.gateCard}>
          <h1 style={styles.h1}>{"Admin rozhran\u00ed"}</h1>
          <p style={styles.muted}>
            {
              "Zadej heslo z prom\u011bnn\u00e9 prost\u0159ed\u00ed ADMIN_UI_PASSWORD na serveru (nap\u0159. Railway Variables)."
            }
          </p>
          <input
            type="password"
            autoComplete="current-password"
            style={styles.textIn}
            value={gatePassword}
            onChange={(e) => setGatePassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitAdminGate();
            }}
          />
          {gateError ? <p style={styles.err}>{gateError}</p> : null}
          <div style={{ marginTop: 12 }}>
            <button type="button" style={styles.primary} onClick={submitAdminGate}>
              {"Pokra\u010dovat"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.h1}>{"T\u0159\u00eddn\u00ed anketa \u2013 lektor"}</h1>
        {adminUiLocked && gateUnlocked ? (
          <button type="button" style={styles.secondary} onClick={forceAdminRelogin}>
            {"Odhl\u00e1sit admin heslo"}
          </button>
        ) : null}
        {!sessionId && (
          <button type="button" style={styles.primary} onClick={createSession}>
            {"Vytvo\u0159it relaci"}
          </button>
        )}
      </header>
      {error && <p style={styles.err}>{error}</p>}

      {sessionId && code && (
        <section style={styles.card}>
          <p style={styles.pinLabel}>PIN pro studenty</p>
          <div style={styles.pin}>{code}</div>
          {qr?.dataUrl && (
            <div style={styles.qrWrap}>
              <img src={qr.dataUrl} alt={"QR k\u00f3d pro p\u0159ipojen\u00ed"} width={280} height={280} />
              <p style={styles.muted}>{qr.url}</p>
            </div>
          )}
          <div style={styles.row}>
            <button type="button" style={styles.secondary} onClick={showReading}>
              {"Pustit reading student\u016fm"}
            </button>
            <button type="button" style={styles.secondary} onClick={showQuestionMode}>
              {"Zp\u011bt na ot\u00e1zku / \u010dek\u00e1n\u00ed"}
            </button>
          </div>
          <p style={styles.muted}>
            {"Aktu\u00e1ln\u00ed studentsk\u00fd re\u017eim: "}
            {studentView.mode}
          </p>
        </section>
      )}

      {sessionId && adminToken && (
        <section style={styles.card}>
          <h2 style={styles.h2}>{"Rychl\u00e1 ot\u00e1zka (ad hoc)"}</h2>
          <p style={styles.muted}>
            {
              "Vytvo\u0159\u00ed novou ot\u00e1zku v relaci: ANO/NE, tip na \u010d\u00edslo v rozsahu, nebo v\u00fdb\u011br z vlastn\u00edch mo\u017enost\u00ed (2\u201312 \u0159\u00e1dk\u016f). Objev\u00ed se v seznamu spole\u010dn\u011b s p\u0159edp\u0159ipraven\u00fdmi ot\u00e1zkami."
            }
          </p>
          <div style={styles.quickSlotWrap}>
            <p style={{ ...styles.muted, margin: "4px 0 8px" }}>
              {"P\u0159edp\u0159ipraven\u00e9 blank ot\u00e1zky (3 sloty):"}
            </p>
            {quickSlots.map((slot) => (
              <div key={slot.id} style={styles.quickSlotRow}>
                <label style={styles.quickSlotLabel}>{slot.label}</label>
                <textarea
                  style={{ ...styles.textarea, minHeight: 56 }}
                  rows={2}
                  maxLength={500}
                  value={slot.text}
                  onChange={(e) => updateQuickSlot(slot.id, e.target.value)}
                  placeholder={"Sem si dopl\u0148 text ot\u00e1zky..."}
                />
                <button
                  type="button"
                  style={styles.secondary}
                  onClick={() => loadQuickSlotToForm(slot.text)}
                >
                  {"Na\u010d\u00edst do formul\u00e1\u0159e"}
                </button>
              </div>
            ))}
          </div>
          <div style={styles.radioRow}>
            <label style={styles.inlineLab}>
              <input
                type="radio"
                name="adhocMode"
                checked={adhocMode === "yes_no"}
                onChange={() => setAdhocMode("yes_no")}
              />{" "}
              {"ANO / NE"}
            </label>
            <label style={styles.inlineLab}>
              <input
                type="radio"
                name="adhocMode"
                checked={adhocMode === "number"}
                onChange={() => setAdhocMode("number")}
              />{" "}
              {"Tip na \u010d\u00edslo"}
            </label>
            <label style={styles.inlineLab}>
              <input
                type="radio"
                name="adhocMode"
                checked={adhocMode === "choice"}
                onChange={() => setAdhocMode("choice")}
              />{" "}
              {"V\u00fdb\u011br z mo\u017enost\u00ed"}
            </label>
          </div>
          <label style={styles.labelBlock}>{"Text ot\u00e1zky"}</label>
          <textarea
            style={styles.textarea}
            rows={2}
            maxLength={500}
            value={adhocText}
            onChange={(e) => setAdhocText(e.target.value)}
            placeholder={"Nap\u0159. Souhlas\u00ed\u0161 s t\u00edmto tvrzen\u00edm?"}
          />
          {adhocMode === "number" && (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
              <div style={{ flex: "1 1 120px" }}>
                <label style={styles.labelBlock}>{"Minimum"}</label>
                <input
                  type="number"
                  style={styles.textIn}
                  value={adhocMin}
                  onChange={(e) => setAdhocMin(e.target.value)}
                />
              </div>
              <div style={{ flex: "1 1 120px" }}>
                <label style={styles.labelBlock}>{"Maximum"}</label>
                <input
                  type="number"
                  style={styles.textIn}
                  value={adhocMax}
                  onChange={(e) => setAdhocMax(e.target.value)}
                />
              </div>
            </div>
          )}
          {adhocMode === "choice" && (
            <div style={{ marginTop: 12 }}>
              <label style={styles.labelBlock}>
                {"Mo\u017enosti (ka\u017ed\u00fd \u0159\u00e1dek = jedna volba, 2\u201312)"}
              </label>
              <textarea
                style={styles.textarea}
                rows={6}
                value={adhocChoices}
                onChange={(e) => setAdhocChoices(e.target.value)}
                placeholder={"A\nB\nC\nD\nE"}
              />
            </div>
          )}
          <label style={{ ...styles.inlineLab, marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={adhocActivate}
              onChange={(e) => setAdhocActivate(e.target.checked)}
            />
            {"Hned aktivovat (odeslat student\u016fm jako b\u011b\u017eic\u00ed ot\u00e1zku)"}
          </label>
          <div style={{ marginTop: 12 }}>
            <button type="button" style={styles.primary} disabled={adhocBusy} onClick={createAdhocQuick}>
              {adhocBusy ? "..." : "P\u0159idat ot\u00e1zku"}
            </button>
          </div>
        </section>
      )}

      {reading && (
        <section style={styles.card}>
          <h2 style={styles.h2}>Reading preview</h2>
          <div style={styles.readingBox} dangerouslySetInnerHTML={{ __html: reading.html }} />
        </section>
      )}

      {questions.length > 0 && (
        <section style={styles.card}>
          <h2 style={styles.h2}>{"Ot\u00e1zky"}</h2>
          <ul style={styles.list}>
            {questions.map((q) => (
              <li key={q.id} style={styles.qItem}>
                <div>
                  <strong>
                    {"Ot\u00e1zka "}
                    {q.order_index + 1}
                  </strong>{" "}
                  ({q.type}) {"\u2014 "}
                  {q.status}
                  <div style={styles.qText}>{q.text}</div>
                </div>
                <div style={styles.row}>
                  {q.status === "hidden" && (
                    <button type="button" style={styles.secondary} onClick={() => activate(q.id)}>
                      Aktivovat
                    </button>
                  )}
                  {q.status === "active" && (
                    <>
                      <button type="button" style={styles.warn} onClick={() => closeQuestion(q.id)}>
                        {"Uzav\u0159\u00edt"}
                      </button>
                      <button type="button" style={styles.primary} onClick={() => showResults(q.id)}>
                        {"Uk\u00e1zat v\u00fdsledky student\u016fm"}
                      </button>
                    </>
                  )}
                  {q.status === "closed" && (
                    <button type="button" style={styles.secondary} onClick={() => showResults(q.id)}>
                      {"Uk\u00e1zat v\u00fdsledky student\u016fm"}
                    </button>
                  )}
                  <button type="button" style={styles.secondary} onClick={() => resetQuestion(q.id)}>
                    {"Resetovat ot\u00e1zku"}
                  </button>
                </div>
                {(q.status === "active" || progress?.questionId === q.id) && (
                  <div style={styles.progressBox}>
                    <span style={styles.progressPill}>
                      {"Odesl\u00e1no: "}
                      {progress?.questionId === q.id ? progress.submittedCount : 0}
                    </span>
                    <span style={styles.progressPill}>
                      {"\u010cek\u00e1me na: "}
                      {progress?.questionId === q.id ? progress.waitingCount : 0}
                    </span>
                    <span style={styles.progressPill}>
                      {"P\u0159ipojeno: "}
                      {progress?.questionId === q.id ? progress.connectedStudents : 0}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {activeId && liveResults && (
        <section style={styles.card}>
          <h2 style={styles.h2}>{"\u017div\u00e9 v\u00fdsledky"}</h2>
          <LiveResultsChart results={liveResults} />
        </section>
      )}

      {questions.length > 0 && (
        <section style={styles.card}>
          <h2 style={styles.h2}>{"V\u00fdsledky ot\u00e1zek"}</h2>
          <div style={styles.resultTabs}>
            {questions.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => setSelectedResultQuestionId(q.id)}
                style={{
                  ...styles.tabBtn,
                  ...(selectedResultQuestionId === q.id ? styles.tabBtnActive : {}),
                }}
              >
                {"Ot\u00e1zka "}
                {q.order_index + 1}
              </button>
            ))}
          </div>
          {selectedResultQuestion?.results ? (
            <LiveResultsChart results={selectedResultQuestion.results} />
          ) : (
            <p style={styles.muted}>
              {"Pro vybranou ot\u00e1zku zat\u00edm nejsou odpov\u011bdi."}
            </p>
          )}
          {selectedResultQuestion && (
            <details
              key={selectedResultQuestion.id}
              style={styles.exportDetails}
              onToggle={(e) => {
                if (e.target.open) void fetchAnalysisInputExport();
              }}
            >
              <summary style={styles.exportSummary}>
                {"Export odpov\u011bd\u00ed pro AI (JSON, anonymn\u00ed ID)"}
              </summary>
              <p style={styles.muted}>
                {
                  "Stejn\u00fd obsah jako pos\u00edl\u00e1 server do Claude. Rozbal, pokud chce\u0161 nahl\u00e9dnout nebo zkop\u00edrovat do extern\u00edho chatu."
                }
              </p>
              {exportLoading && <p style={styles.muted}>{"Na\u010d\u00edt\u00e1m\u2026"}</p>}
              {exportError && <p style={styles.err}>{exportError}</p>}
              {exportInput && (
                <>
                  <div style={{ marginTop: 8 }}>
                    <button type="button" style={styles.secondary} onClick={copyExportInput}>
                      {exportCopied
                        ? "Zkop\u00edrov\u00e1no"
                        : "Kop\u00edrovat JSON do schr\u00e1nky"}
                    </button>
                  </div>
                  <pre style={styles.exportPre}>{JSON.stringify(exportInput, null, 2)}</pre>
                </>
              )}
            </details>
          )}
          {selectedResultQuestion && (
            <div style={styles.analysisBox}>
              <h3 style={styles.h3}>{"AI shrnut\u00ed (Claude)"}</h3>
              <p style={styles.muted}>
                {
                  "Vol\u00e1 se pouze p\u0159es backend endpoint a pou\u017eije se serverov\u00fd ANTHROPIC_API_KEY. Kl\u00ed\u010d nikdy nejde do prohl\u00ed\u017ee\u010de."
                }
              </p>
              <label style={styles.labelBlock}>{"Dopl\u0148kov\u00fd pokyn pro AI (voliteln\u00e9)"}</label>
              <textarea
                style={styles.textarea}
                rows={3}
                maxLength={2000}
                value={analysisInstruction}
                onChange={(e) => setAnalysisInstruction(e.target.value)}
                placeholder={"Nap\u0159. Zam\u011b\u0159 se na ekonomickou argumentaci a logick\u00e9 chyby."}
              />
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  style={styles.primary}
                  disabled={analysisBusy || !selectedResultQuestion.id}
                  onClick={runClaudeAnalysis}
                >
                  {analysisBusy ? "Analyzuji..." : "Analyzovat odpov\u011bdi v Claude"}
                </button>
              </div>
              {analysisResult?.summary && (
                <pre style={styles.analysisResult}>{analysisResult.summary}</pre>
              )}
            </div>
          )}
        </section>
      )}

      <section style={styles.card}>
        <h2 style={styles.h2}>{"Dotazy student\u016f"}</h2>
        {studentQuestions.length === 0 && (
          <p style={styles.muted}>{"Zat\u00edm \u017e\u00e1dn\u00e9 dotazy."}</p>
        )}
        <ul style={styles.list}>
          {studentQuestions.map((q) => (
            <li key={q.id} style={styles.qItem}>
              <div style={styles.qText}>{q.text}</div>
              <div style={styles.muted}>Student: {q.student_token.slice(0, 8)}...</div>
            </li>
          ))}
        </ul>
      </section>

      {session && (
        <p style={styles.muted}>
          {"Stav relace: "}
          {session.status}
          {" \u00b7 ID "}
          {session.id}
        </p>
      )}
    </div>
  );
}

const styles = {
  page: {
    fontFamily: "system-ui, Segoe UI, Roboto, sans-serif",
    maxWidth: 1000,
    margin: "0 auto",
    padding: 24,
    color: "#0f172a",
  },
  header: { display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" },
  h1: { fontSize: 28, margin: 0 },
  h2: { fontSize: 20, marginTop: 0 },
  h3: { fontSize: 17, margin: "6px 0 8px" },
  primary: {
    padding: "12px 20px",
    fontSize: 16,
    borderRadius: 10,
    border: "none",
    background: "#2563eb",
    color: "#fff",
    cursor: "pointer",
  },
  secondary: {
    padding: "10px 16px",
    fontSize: 14,
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#fff",
    cursor: "pointer",
  },
  warn: {
    padding: "10px 16px",
    fontSize: 14,
    borderRadius: 8,
    border: "none",
    background: "#f97316",
    color: "#fff",
    cursor: "pointer",
  },
  card: {
    marginTop: 24,
    padding: 20,
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
  pinLabel: { margin: 0, fontSize: 14, color: "#64748b" },
  pin: {
    fontSize: 56,
    fontWeight: 800,
    letterSpacing: 8,
    margin: "8px 0",
  },
  qrWrap: { marginTop: 12 },
  list: { listStyle: "none", padding: 0, margin: 0 },
  qItem: {
    padding: 16,
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  qText: { marginTop: 8, color: "#334155", fontSize: 15 },
  row: { display: "flex", gap: 8, flexWrap: "wrap" },
  progressBox: { display: "flex", gap: 8, flexWrap: "wrap" },
  progressPill: {
    fontSize: 13,
    background: "#e2e8f0",
    color: "#1e293b",
    borderRadius: 999,
    padding: "4px 10px",
    fontWeight: 600,
  },
  resultTabs: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 },
  tabBtn: {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#fff",
    cursor: "pointer",
  },
  tabBtnActive: {
    borderColor: "#2563eb",
    color: "#1d4ed8",
    background: "#eff6ff",
  },
  readingBox: {
    maxHeight: 320,
    overflowY: "auto",
    background: "#fff",
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    padding: 14,
    lineHeight: 1.5,
  },
  muted: { color: "#64748b", fontSize: 14 },
  err: { color: "#b91c1c" },
  labelBlock: { display: "block", fontSize: 14, fontWeight: 600, marginBottom: 8, color: "#334155" },
  inlineLab: { fontSize: 14, color: "#334155", cursor: "pointer" },
  textarea: {
    width: "100%",
    minHeight: 72,
    padding: 12,
    fontSize: 15,
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    fontFamily: "inherit",
    boxSizing: "border-box",
  },
  textIn: {
    width: "100%",
    padding: 10,
    fontSize: 15,
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    boxSizing: "border-box",
  },
  radioRow: { display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 12 },
  quickSlotWrap: {
    border: "1px dashed #cbd5e1",
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    background: "#ffffff",
  },
  quickSlotRow: {
    display: "grid",
    gap: 8,
    marginBottom: 10,
  },
  quickSlotLabel: { fontSize: 13, fontWeight: 700, color: "#334155" },
  analysisBox: {
    marginTop: 16,
    borderTop: "1px solid #cbd5e1",
    paddingTop: 14,
  },
  analysisResult: {
    marginTop: 12,
    background: "#0f172a",
    color: "#e2e8f0",
    padding: 12,
    borderRadius: 8,
    whiteSpace: "pre-wrap",
    lineHeight: 1.5,
    fontSize: 14,
    maxHeight: 420,
    overflowY: "auto",
  },
  exportDetails: {
    marginTop: 16,
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    padding: "8px 12px",
    background: "#fff",
  },
  exportSummary: {
    cursor: "pointer",
    fontWeight: 700,
    color: "#1e293b",
    fontSize: 15,
  },
  exportPre: {
    marginTop: 10,
    background: "#f1f5f9",
    color: "#0f172a",
    padding: 12,
    borderRadius: 8,
    whiteSpace: "pre-wrap",
    lineHeight: 1.45,
    fontSize: 12,
    maxHeight: 360,
    overflowY: "auto",
    border: "1px solid #e2e8f0",
  },
  gateCard: {
    maxWidth: 420,
    margin: "48px auto",
    padding: 24,
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
};
