import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalysisInput, buildPrompt } from "./ai.js";

test("buildAnalysisInput anonymizes respondent and maps multiple choice", () => {
  const question = {
    id: 77,
    type: "multiple_choice",
    text: "Test",
    options: { choices: ["Ano", "Ne"] },
  };
  const rows = [
    {
      student_token: "student-token-123",
      value: { choice: 1, reasoning: "Vyssi riziko nakladu." },
    },
  ];

  const input = buildAnalysisInput(question, rows);
  assert.equal(input.responses.length, 1);
  assert.equal(input.responses[0].respondentId.length, 12);
  assert.equal(input.responses[0].respondentId.includes("student-token"), false);
  assert.equal(input.responses[0].answer.choiceIndex, 1);
  assert.equal(input.responses[0].answer.choiceLabel, "Ne");
  assert.equal(input.responses[0].answer.reasoning, "Vyssi riziko nakladu.");
});

test("buildAnalysisInput maps number_guess and keeps null reasoning", () => {
  const question = {
    id: 78,
    type: "number_guess",
    text: "Tipni cislo",
    options: { min: 1, max: 50 },
  };
  const rows = [{ student_token: "abc", value: { guess: 33 } }];
  const input = buildAnalysisInput(question, rows);

  assert.equal(input.responses[0].answer.guess, 33);
  assert.equal(input.responses[0].answer.reasoning, null);
});

test("buildAnalysisInput maps ranking justification to reasoning", () => {
  const question = {
    id: 9,
    type: "ranking",
    text: "Rank",
    options: { items: ["A", "B"] },
  };
  const rows = [
    {
      student_token: "tok",
      value: { order: [0, 1], justification: "Dlouhe ekonomicke zduvodneni textu." },
    },
  ];
  const input = buildAnalysisInput(question, rows);
  assert.equal(input.responses[0].answer.reasoning.length > 15, true);
  assert.deepEqual(input.responses[0].answer.order, [0, 1]);
});

test("buildPrompt injects JSON and drops template placeholder", () => {
  const question = {
    id: 1,
    type: "multiple_choice",
    text: "X",
    options: { choices: ["A", "B"] },
  };
  const input = buildAnalysisInput(question, []);
  const prompt = buildPrompt(input, "");
  assert.equal(prompt.includes("{{DATA}}"), false);
  assert.ok(prompt.includes('"question"'));
  assert.ok(prompt.includes("Souhrn třídy"));
});
