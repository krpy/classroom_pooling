import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";

const COLORS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a"];

export default function LiveResultsChart({ results }) {
  if (!results) return <p>Žádná data</p>;

  if (results.kind === "slider") {
    const data = results.labels.map((name, i) => ({
      name: name.length > 32 ? `${name.slice(0, 30)}…` : name,
      fullName: name,
      průměr: results.averages[i],
    }));
    return (
      <div style={{ width: "100%", height: 360 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 80 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" interval={0} angle={-25} textAnchor="end" height={90} />
            <YAxis domain={[0, 100]} tickFormatter={(v) => `${v} %`} />
            <Tooltip formatter={(v) => [`${v} %`, "Průměr"]} />
            <Legend />
            <Bar dataKey="průměr" name="Průměr %" fill="#2563eb" />
          </BarChart>
        </ResponsiveContainer>
        <p style={{ color: "#64748b", fontSize: 14 }}>
          Počet odpovědí: {results.responseCount}
        </p>
      </div>
    );
  }

  if (results.kind === "ranking") {
    const data = [...results.items].sort((a, b) => a.avgRank - b.avgRank);
    const scaleMax = Math.max(...data.map((x) => x.avgRank), 1);
    return (
      <div style={{ width: "100%" }}>
        <p style={{ marginTop: 0, color: "#64748b", fontSize: 14, marginBottom: 14 }}>
          Nižší číslo = důležitější (průměrné pořadí).
        </p>
        <div style={{ display: "grid", gap: 12 }}>
          {data.map((row, index) => (
            <div key={row.label} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: 6,
                  fontWeight: 600,
                }}
              >
                <span>
                  {index + 1}. {row.label}
                </span>
                <span style={{ color: "#6d28d9" }}>Průměr: {row.avgRank}</span>
              </div>
              <div
                style={{
                  height: 12,
                  borderRadius: 999,
                  background: "#ede9fe",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.max(8, (row.avgRank / scaleMax) * 100)}%`,
                    background: "linear-gradient(90deg, #a78bfa, #7c3aed)",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <p style={{ color: "#64748b", fontSize: 14 }}>
          Počet odpovědí: {results.responseCount}
        </p>
      </div>
    );
  }

  if (results.kind === "number_guess") {
    const data = (results.buckets || []).map((b) => ({
      name: String(b.value),
      Počet: b.count,
    }));
    return (
      <div style={{ width: "100%", height: 360 }}>
        <p style={{ marginTop: 0, color: "#64748b", fontSize: 14 }}>
          Rozsah: {results.min}–{results.max}
          {results.average != null ? ` · průměr: ${results.average}` : ""}
        </p>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" name="Hodnota" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="Počet" name="Počet" fill="#7c3aed" />
          </BarChart>
        </ResponsiveContainer>
        <p style={{ color: "#64748b", fontSize: 14 }}>
          Počet odpovědí: {results.responseCount}
        </p>
      </div>
    );
  }

  if (results.kind === "multiple_choice") {
    const data = results.labels.map((name, i) => ({
      name,
      value: results.counts[i],
    }));
    return (
      <div style={{ width: "100%", height: 380 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={120}
              label={({ name, percent }) =>
                `${name}: ${(percent * 100).toFixed(0)} %`
              }
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
        <p style={{ color: "#64748b", fontSize: 14 }}>
          Počet odpovědí: {results.responseCount}
        </p>
      </div>
    );
  }

  return <p>Neznámý typ grafu</p>;
}
