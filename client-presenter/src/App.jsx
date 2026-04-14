import { useCallback, useEffect, useMemo, useState } from "react";
import LiveResultsChart from "./components/LiveResultsChart.jsx";

function apiHeaders(adminToken) {
  return {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };
}

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

  const wsUrl = useMemo(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  }, []);

  const loadSession = useCallback(
    async (sid, token) => {
      const res = await fetch(`/api/sessions/${sid}/present`, {
        headers: apiHeaders(token),
      });
      if (!res.ok) throw new Error("Naètení relace selhalo");
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
    [selectedResultQuestionId]
  );

  useEffect(() => {
    if (!sessionId || !adminToken) return undefined;
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "join_presenter",
          sessionId,
          adminToken,
        })
      );
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

  const createSession = async () => {
    setError(null);
    try {
      const res = await fetch("/api/sessions", { method: "POST" });
      if (!res.ok) throw new Error("Vytvoøení relace selhalo");
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
      if (!res.ok) throw new Error("Uzavøení selhalo");
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
      if (!res.ok) throw new Error("Reset otázky selhal");
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
      if (!res.ok) throw new Error("Odeslání výsledkù selhalo");
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
      if (!res.ok) throw new Error("Pøepnutí na reading selhalo");
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
      if (!res.ok) throw new Error("Pøepnutí na otázku/èekání selhalo");
      await loadSession(sessionId, adminToken);
    } catch (e) {
      setError(e.message || "Chyba");
    }
  };

  const selectedResultQuestion = questions.find((q) => q.id === selectedResultQuestionId) || null;

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.h1}>Tøídní anketa – lektor</h1>
        {!sessionId && (
          <button type="button" style={styles.primary} onClick={createSession}>
            Vytvoøit relaci
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
              <img src={qr.dataUrl} alt="QR kód pro pøipojení" width={280} height={280} />
              <p style={styles.muted}>{qr.url}</p>
            </div>
          )}
          <div style={styles.row}>
            <button type="button" style={styles.secondary} onClick={showReading}>
              Pustit reading studentùm
            </button>
            <button type="button" style={styles.secondary} onClick={showQuestionMode}>
              Zpìt na otázku / èekání
            </button>
          </div>
          <p style={styles.muted}>Aktuální studentský režim: {studentView.mode}</p>
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
          <h2 style={styles.h2}>Otázky</h2>
          <ul style={styles.list}>
            {questions.map((q) => (
              <li key={q.id} style={styles.qItem}>
                <div>
                  <strong>Otázka {q.order_index + 1}</strong> ({q.type}) — {q.status}
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
                        Uzavøít
                      </button>
                      <button type="button" style={styles.primary} onClick={() => showResults(q.id)}>
                        Ukázat výsledky studentùm
                      </button>
                    </>
                  )}
                  {q.status === "closed" && (
                    <button type="button" style={styles.secondary} onClick={() => showResults(q.id)}>
                      Ukázat výsledky studentùm
                    </button>
                  )}
                  <button type="button" style={styles.secondary} onClick={() => resetQuestion(q.id)}>
                    Resetovat otázku
                  </button>
                </div>
                {(q.status === "active" || progress?.questionId === q.id) && (
                  <div style={styles.progressBox}>
                    <span style={styles.progressPill}>
                      Odesláno: {progress?.questionId === q.id ? progress.submittedCount : 0}
                    </span>
                    <span style={styles.progressPill}>
                      Èekáme na: {progress?.questionId === q.id ? progress.waitingCount : 0}
                    </span>
                    <span style={styles.progressPill}>
                      Pøipojeno: {progress?.questionId === q.id ? progress.connectedStudents : 0}
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
          <h2 style={styles.h2}>Živé výsledky</h2>
          <LiveResultsChart results={liveResults} />
        </section>
      )}

      {questions.length > 0 && (
        <section style={styles.card}>
          <h2 style={styles.h2}>Výsledky otázek</h2>
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
                Otázka {q.order_index + 1}
              </button>
            ))}
          </div>
          {selectedResultQuestion?.results ? (
            <LiveResultsChart results={selectedResultQuestion.results} />
          ) : (
            <p style={styles.muted}>Pro vybranou otázku zatím nejsou odpovìdi.</p>
          )}
        </section>
      )}

      <section style={styles.card}>
        <h2 style={styles.h2}>Dotazy studentù</h2>
        {studentQuestions.length === 0 && (
          <p style={styles.muted}>Zatím žádné dotazy.</p>
        )}
        <ul style={styles.list}>
          {studentQuestions.map((q) => (
            <li key={q.id} style={styles.qItem}>
              <div style={styles.qText}>{q.text}</div>
              <div style={styles.muted}>Student: {q.student_token.slice(0, 8)}…</div>
            </li>
          ))}
        </ul>
      </section>

      {session && (
        <p style={styles.muted}>
          Stav relace: {session.status} · ID {session.id}
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
};
