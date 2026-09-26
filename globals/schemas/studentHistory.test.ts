import assert from "node:assert/strict";
import test from "node:test";
import { parseHistoryQuery } from "./studentHistory";

const today = new Date("2026-09-25T16:30:00+08:00");
test("defaults to 90 Manila calendar dates", () => {
  const query = parseHistoryQuery(new URLSearchParams(), today);
  assert.equal(query.to, "2026-09-25");
  assert.equal(query.from, "2026-06-28");
  assert.equal(query.view, "recorded");
});
test("rejects invalid days and oversized ranges", () => {
  assert.throws(() => parseHistoryQuery(new URLSearchParams("from=2026-02-30&to=2026-03-01"), today));
  assert.throws(() => parseHistoryQuery(new URLSearchParams("from=2025-01-01&to=2026-09-25"), today));
  assert.throws(() => parseHistoryQuery(new URLSearchParams("outcome=bogus"), today));
  assert.throws(() => parseHistoryQuery(new URLSearchParams("userId=admin"), today));
  assert.throws(() => parseHistoryQuery(new URLSearchParams("page=0"), today));
  assert.throws(() => parseHistoryQuery(new URLSearchParams("pageSize=7"), today));
});
