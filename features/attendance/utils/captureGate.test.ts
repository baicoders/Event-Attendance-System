import assert from "node:assert/strict";
import { test } from "node:test";
import { canSubmitAttendance } from "./captureGate";

test("manual and camera writes share the same mode and refresh safety gate", () => {
  const ready = { phase: "IDLE" as const, modeNotice: false, hasRefreshError: false, needsRefresh: false, modeChanging: false };
  assert.equal(canSubmitAttendance(ready), true);
  assert.equal(canSubmitAttendance({ ...ready, phase: "LOOKUP" }), false);
  assert.equal(canSubmitAttendance({ ...ready, phase: "SAVING" }), false);
  assert.equal(canSubmitAttendance({ ...ready, phase: "AWAITING_ACKNOWLEDGEMENT" }), false);
  assert.equal(canSubmitAttendance({ ...ready, modeNotice: true }), false);
  assert.equal(canSubmitAttendance({ ...ready, hasRefreshError: true }), false);
  assert.equal(canSubmitAttendance({ ...ready, needsRefresh: true }), false);
  assert.equal(canSubmitAttendance({ ...ready, modeChanging: true }), false);
});
