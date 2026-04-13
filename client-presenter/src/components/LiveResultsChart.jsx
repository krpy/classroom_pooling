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
    const data = results.items.map((row) => ({
      name: row.label.length > 28 ? `${row.label.slice(0, 26)}…` : row.label,
      hodnocení: row.avgRank,
    }));
    return (
      <div style={{ width: "100%", height: 360 }}>
        <p style={{ marginTop: 0, color: "#64748b", fontSize: 14 }}>
          Nižší číslo = důležitější (průměrné pořadí).
        </p>
        <ResponsiveContainer>
          <BarChart
            layout="vertical"
            data={data}
            margin={{ top: 8, right: 24, left: 120, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" domain={[1, "auto"]} />
            <YAxis type="category" dataKey="name" width={110} />
            <Tooltip formatter={(v) => [v, "Prům. pořadí"]} />
            <Legend />
            <Bar dataKey="hodnocení" name="Prům. pořadí" fill="#7c3aed" />
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
