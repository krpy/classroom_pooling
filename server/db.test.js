import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";

function freshDbModule() {
  process.env.SQLITE_PATH = path.join(
    os.tmpdir(),
    `classroom-poolin-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`
  );
  return import(`./db.js?ts=${Date.now()}-${Math.random()}`);
}

test("new session starts in waiting mode with seeded questions", async () => {
  const db = await freshDbModule();
  const { sessionId, adminToken } = db.createSession();
  const presenter = db.getSessionForPresenter(sessionId, adminToken);

  assert.equal(presenter.session.student_view_mode, "waiting");
  assert.equal(presenter.questions.length, 3);
});

test("reset question clears responses and sets hidden status", async () => {
  const db = await freshDbModule();
  const { sessionId, adminToken } = db.createSession();
  const presenter = db.getSessionForPresenter(sessionId, adminToken);
  const q = presenter.questions[0];

  assert.equal(db.activateQuestion(sessionId, q.id, adminToken), true);
  db.upsertResponse(q.id, "student-1", { percentages: [20, 20, 20, 20, 20] });
  assert.equal(db.listResponsesForQuestion(q.id).length, 1);

  assert.equal(db.resetQuestion(sessionId, q.id, adminToken), true);
  assert.equal(db.listResponsesForQuestion(q.id).length, 0);

  const after = db.getQuestion(sessionId, q.id, adminToken);
  assert.equal(after.status, "hidden");
});
