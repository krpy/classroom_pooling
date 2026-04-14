/**
 * @param {object} question - row with type, options (parsed object)
 * @param {Array<{ student_token: string, value: object }>} responses
 */
export function computeResults(question, responses) {
  if (question.type === "slider") {
    const items = question.options.items || [];
    const len = items.length;
    const sums = Array(len).fill(0);
    let validCount = 0;
    for (const r of responses) {
      const p = r.value?.percentages;
      if (!Array.isArray(p) || p.length !== len) continue;
      validCount += 1;
      for (let i = 0; i < len; i++) sums[i] += Number(p[i]) || 0;
    }
    const averages = sums.map((s) =>
      validCount ? Math.round((s / validCount) * 10) / 10 : 0
    );
    return {
      kind: "slider",
      questionId: question.id,
      labels: items,
      averages,
      responseCount: validCount,
    };
  }

  if (question.type === "ranking") {
    const items = question.options.items || [];
    const m = items.length;
    const rankSums = Array(m).fill(0);
    let validCount = 0;
    for (const r of responses) {
      const order = r.value?.order;
      if (!Array.isArray(order) || order.length !== m) continue;
      const seen = new Set();
      let valid = true;
      for (let pos = 0; pos < m; pos++) {
        const idx = order[pos];
        if (
          typeof idx !== "number" ||
          idx < 0 ||
          idx >= m ||
          seen.has(idx)
        ) {
          valid = false;
          break;
        }
        seen.add(idx);
      }
      if (!valid) continue;
      validCount += 1;
      for (let pos = 0; pos < m; pos++) {
        const itemIndex = order[pos];
        rankSums[itemIndex] += pos + 1;
      }
    }
    const avgRanks = items.map((label, i) => ({
      label,
      avgRank: validCount
        ? Math.round((rankSums[i] / validCount) * 10) / 10
        : 0,
    }));
    return {
      kind: "ranking",
      questionId: question.id,
      items: avgRanks,
      responseCount: validCount,
    };
  }

  if (question.type === "multiple_choice") {
    const choices = question.options.choices || [];
    const counts = Array(choices.length).fill(0);
    let validCount = 0;
    for (const r of responses) {
      const c = r.value?.choice;
      if (typeof c !== "number" || c < 0 || c >= choices.length) continue;
      counts[c] += 1;
      validCount += 1;
    }
    return {
      kind: "multiple_choice",
      questionId: question.id,
      labels: choices,
      counts,
      responseCount: validCount,
    };
  }

  if (question.type === "number_guess") {
    const min = Number(question.options.min);
    const max = Number(question.options.max);
    const countsMap = new Map();
    let validCount = 0;
    let sum = 0;
    for (const r of responses) {
      const g = r.value?.guess;
      if (!Number.isFinite(g)) continue;
      const gi = Math.trunc(Number(g));
      if (gi < min || gi > max) continue;
      validCount += 1;
      sum += gi;
      countsMap.set(gi, (countsMap.get(gi) || 0) + 1);
    }
    const entries = [...countsMap.entries()].sort((a, b) => a[0] - b[0]);
    const buckets = entries.map(([value, count]) => ({ value, count }));
    return {
      kind: "number_guess",
      questionId: question.id,
      min,
      max,
      buckets,
      average: validCount ? Math.round((sum / validCount) * 10) / 10 : null,
      responseCount: validCount,
    };
  }

  const n = responses.length;
  return { kind: "unknown", questionId: question.id, responseCount: n };
}

export function validateResponseValue(question, value) {
  if (question.type === "slider") {
    const items = question.options.items || [];
    const p = value?.percentages;
    if (!Array.isArray(p) || p.length !== items.length) return false;
    let sum = 0;
    for (const x of p) {
      const n = Number(x);
      if (!Number.isFinite(n) || n < 0 || n > 100) return false;
      sum += n;
    }
    return Math.abs(sum - 100) < 0.51;
  }
  if (question.type === "ranking") {
    const items = question.options.items || [];
    const m = items.length;
    const order = value?.order;
    if (!Array.isArray(order) || order.length !== m) return false;
    const seen = new Set();
    for (const idx of order) {
      if (typeof idx !== "number" || idx < 0 || idx >= m || seen.has(idx))
        return false;
      seen.add(idx);
    }
    return seen.size === m;
  }
  if (question.type === "multiple_choice") {
    const choices = question.options.choices || [];
    const c = value?.choice;
    return typeof c === "number" && c >= 0 && c < choices.length;
  }
  if (question.type === "number_guess") {
    const min = Number(question.options.min);
    const max = Number(question.options.max);
    const g = value?.guess;
    if (!Number.isFinite(g)) return false;
    const gi = Math.trunc(Number(g));
    return gi >= min && gi <= max;
  }
  return false;
}
