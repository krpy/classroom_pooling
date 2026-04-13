import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [qr, setQr] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [liveResults, setLiveResults] = useState(null);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);

  const wsUrl = useMemo(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  }, []);

  const loadSession = useCallback(
    async (sid, token) => {
      const res = await fetch(`/api/sessions/${sid}/present`, {
        headers: apiHeaders(token),
      });
      if (!res.ok) throw new Error("Načtení relace selhalo");
      const data = await res.json();
      setSession(data.session);
      setQuestions(data.questions);
      const active = data.questions.find((q) => q.status === "active");
      setActiveId(active ? active.id : null);
      setLiveResults(active?.results || null);
      const qrRes = await fetch(`/api/sessions/${sid}/qr`, {
        headers: apiHeaders(token),
      });
      if (qrRes.ok) {
        const qd = await qrRes.json();
        setQr(qd);
      }
    },
    []
  );

  useEffect(() => {
    if (!sessionId || !adminToken) return undefined;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
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
        }
      } catch {
        /* ignore */
      }
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId, adminToken, wsUrl]);

  const createSession = async () => {
    setError(null);
    try {
      const res = await fetch("/api/sessions", { method: "POST" });
      if (!res.ok) throw new Error("Vytvoření relace selhalo");
      const data = await res.json();
      setSessionId(data.sessionId);
      setAdminToken(data.adminToken);
      setCode(data.code);
      await loadSession(data.sessionId, data.adminToken);
    } catch (e) {
      setError(e.message || "Chyba");
    }
  };

  const activate = async (questionId) => {
    setError(null);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/questions/${questionId}/activate`,
        { method: "POST", headers: apiHeaders(adminToken) }
      );
      if (!res.ok) throw new Error("Aktivace selhala");
      const data = await res.json();
      setActiveId(questionId);
      setLiveResults(data.results);
      await loadSession(sessionId, adminToken);
    } catch (e) {
      setError(e.message || "Chyba");
    }
  };

  const closeQuestion = async (questionId) => {
    setError(null);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/questions/${questionId}/close`,
        { method: "POST", headers: apiHeaders(adminToken) }
      );
      if (!res.ok) throw new Error("Uzavření selhalo");
      setActiveId(null);
      setLiveResults(null);
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
      if (!res.ok) throw new Error("Odeslání výsledků selhalo");
    } catch (e) {
      setError(e.message || "Chyba");
    }
  };

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.h1}>Třídní anketa – lektor</h1>
        {!sessionId && (
          <button type="button" style={styles.primary} onClick={createSession}>
            Vytvořit relaci
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
              <img src={qr.dataUrl} alt="QR kód pro připojení" width={280} height={280} />
              <p style={styles.muted}>{qr.url}</p>
            </div>
          )}
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
                    <button
                      type="button"
                      style={styles.secondary}
                      onClick={() => activate(q.id)}
                    >
                      Aktivovat
                    </button>
                  )}
                  {q.status === "active" && (
                    <>
                      <button
                        type="button"
                        style={styles.warn}
                        onClick={() => closeQuestion(q.id)}
                      >
                        Uzavřít
                      </button>
                      <button
                        type="button"
                        style={styles.primary}
                        onClick={() => showResults(q.id)}
                      >
                        Ukázat výsledky studentům
                      </button>
                    </>
                  )}
                  {q.status === "closed" && (
                    <button
                      type="button"
                      style={styles.secondary}
                      onClick={() => showResults(q.id)}
                    >
                      Ukázat výsledky studentům
                    </button>
                  )}
                </div>
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
    maxWidth: 960,
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
  muted: { color: "#64748b", fontSize: 14 },
  err: { color: "#b91c1c" },
};
