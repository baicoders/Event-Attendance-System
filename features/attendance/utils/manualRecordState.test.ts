import assert from "node:assert/strict";
import { test } from "node:test";
import { manualRecordState, detailActionDisabled } from "./manualRecordState";

test("unresolved and failed reads stay unknown", () => {
  assert.equal(manualRecordState(false, false, false, null).kind, "NOT_REQUESTED");
  assert.equal(manualRecordState(true, true, false, null).kind, "LOADING");
  assert.equal(manualRecordState(true, false, true, null).kind, "ERROR");
});

test("time-out remains available when a confirmed read has no record or no time-in", () => {
  assert.equal(manualRecordState(true, false, false, null).kind, "NO_RECORD");
  assert.equal(manualRecordState(true, false, false, { timein: null, timeout: null }).kind, "NO_TIME_IN");
  assert.equal(detailActionDisabled("TIME_OUT", manualRecordState(true, false, false, null)), false);
  assert.equal(detailActionDisabled("TIME_OUT", manualRecordState(true, false, false, { timein: null, timeout: null })), false);
  assert.equal(detailActionDisabled("TIME_OUT", manualRecordState(true, false, false, { timein: null, timeout: "2026-09-25T01:00:00Z" })), true);
  assert.equal(detailActionDisabled("TIME_OUT", manualRecordState(true, false, true, null)), false);
  assert.equal(detailActionDisabled("TIME_OUT", manualRecordState(true, false, false, { timein: "2026-09-25T00:00:00Z", timeout: null })), false);
  assert.equal(detailActionDisabled("TIME_IN", manualRecordState(true, false, false, { timein: "2026-09-25T00:00:00Z", timeout: null })), true);
});
