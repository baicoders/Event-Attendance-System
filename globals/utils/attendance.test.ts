import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveOutcome } from "./attendance";

test("a time-out-only record has no recorded check-in evidence", () => {
  const event = { start: "2026-09-25T00:00:00.000Z", allDay: false };
  assert.equal(deriveOutcome({ timein: null, timeout: "2026-09-25T01:00:00.000Z" }, event), "ABSENT");
  assert.equal(deriveOutcome({ timein: null, timeout: null }, event), "ABSENT");
});
