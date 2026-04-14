import test from "node:test";
import assert from "node:assert/strict";
import { getAdminUiPassword } from "./envAdminUi.js";

test("getAdminUiPassword trims and strips BOM", () => {
  const prev = process.env.ADMIN_UI_PASSWORD;
  try {
    process.env.ADMIN_UI_PASSWORD = "\uFEFF  secret  ";
    assert.equal(getAdminUiPassword(), "secret");
  } finally {
    if (prev === undefined) delete process.env.ADMIN_UI_PASSWORD;
    else process.env.ADMIN_UI_PASSWORD = prev;
  }
});

test("getAdminUiPassword reads env on each call", () => {
  const prev = process.env.ADMIN_UI_PASSWORD;
  try {
    process.env.ADMIN_UI_PASSWORD = "first";
    assert.equal(getAdminUiPassword(), "first");
    process.env.ADMIN_UI_PASSWORD = "second";
    assert.equal(getAdminUiPassword(), "second");
  } finally {
    if (prev === undefined) delete process.env.ADMIN_UI_PASSWORD;
    else process.env.ADMIN_UI_PASSWORD = prev;
  }
});
