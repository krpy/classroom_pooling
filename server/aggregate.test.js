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

const rankJust =
  "Ekonomicky davam naklady prvni kvuli marzi a cash flow riziku u e-commerce.";

test("ranking aggregate average rank", () => {
  const rows = [
    { student_token: "a", value: { order: [0, 1, 2], justification: rankJust } },
    { student_token: "b", value: { order: [2, 0, 1], justification: rankJust } },
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

test("ranking validation requires economic justification", () => {
  assert.equal(
    validateResponseValue(rankQ, { order: [0, 1, 2], justification: "kratke" }),
    false
  );
  assert.equal(
    validateResponseValue(rankQ, { order: [0, 1, 2], justification: rankJust }),
    true
  );
});

test("ranking aggregate ignores responses without justification", () => {
  const rows = [
    { student_token: "a", value: { order: [0, 1, 2] } },
    { student_token: "b", value: { order: [0, 1, 2], justification: rankJust } },
  ];
  const r = computeResults(rankQ, rows);
  assert.equal(r.responseCount, 1);
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

const numQ = {
  id: 4,
  type: "number_guess",
  options: { min: 1, max: 10 },
};

test("number_guess aggregate buckets and average", () => {
  const rows = [
    { student_token: "a", value: { guess: 3 } },
    { student_token: "b", value: { guess: 7 } },
    { student_token: "c", value: { guess: 3 } },
  ];
  const r = computeResults(numQ, rows);
  assert.equal(r.kind, "number_guess");
  assert.equal(r.responseCount, 3);
  assert.equal(r.average, 4.3);
  assert.deepEqual(
    r.buckets.map((b) => [b.value, b.count]),
    [
      [3, 2],
      [7, 1],
    ]
  );
});

test("number_guess validation range", () => {
  assert.equal(validateResponseValue(numQ, { guess: 5 }), true);
  assert.equal(validateResponseValue(numQ, { guess: 0 }), false);
  assert.equal(validateResponseValue(numQ, { guess: 11 }), false);
});
