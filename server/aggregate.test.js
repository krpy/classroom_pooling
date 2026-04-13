import test from "node:test";
import assert from "node:assert/strict";
import { computeResults, validateResponseValue } from "./aggregate.js";

const sliderQ = {
  id: 1,
  type: "slider",
  options: { items: ["A", "B", "C"] },
};

test("slider aggregate averages", () => {
  const rows = [
    { student_token: "a", value: { percentages: [30, 30, 40] } },
    { student_token: "b", value: { percentages: [10, 50, 40] } },
  ];
  const r = computeResults(sliderQ, rows);
  assert.equal(r.kind, "slider");
  assert.deepEqual(r.averages, [20, 40, 40]);
  assert.equal(r.responseCount, 2);
});

test("slider validation requires sum 100", () => {
  assert.equal(
    validateResponseValue(sliderQ, { percentages: [33, 33, 34] }),
    true
  );
  assert.equal(
    validateResponseValue(sliderQ, { percentages: [10, 10, 10] }),
    false
  );
});

const rankQ = {
  id: 2,
  type: "ranking",
  options: { items: ["X", "Y", "Z"] },
};

test("ranking aggregate average rank", () => {
  const rows = [
    { student_token: "a", value: { order: [0, 1, 2] } },
    { student_token: "b", value: { order: [2, 0, 1] } },
  ];
  const r = computeResults(rankQ, rows);
  assert.equal(r.kind, "ranking");
  assert.equal(r.responseCount, 2);
  const byLabel = Object.fromEntries(r.items.map((x) => [x.label, x.avgRank]));
  assert.equal(byLabel.X, 1.5);
  assert.equal(byLabel.Y, 2.5);
  assert.equal(byLabel.Z, 2);
});

test("ranking validation rejects duplicates", () => {
  assert.equal(
    validateResponseValue(rankQ, { order: [0, 0, 1] }),
    false
  );
});

const mcQ = {
  id: 3,
  type: "multiple_choice",
  options: { choices: ["A", "B"] },
};

test("multiple choice counts", () => {
  const rows = [
    { student_token: "a", value: { choice: 0 } },
    { student_token: "b", value: { choice: 0 } },
    { student_token: "c", value: { choice: 1 } },
  ];
  const r = computeResults(mcQ, rows);
  assert.equal(r.kind, "multiple_choice");
  assert.deepEqual(r.counts, [2, 1]);
  assert.equal(r.responseCount, 3);
});
