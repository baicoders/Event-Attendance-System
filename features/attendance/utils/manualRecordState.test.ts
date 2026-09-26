import assert from "node:assert/strict";
import { test } from "node:test";
import { manualRecordState, detailActionDisabled, recordActionLabel } from "./manualRecordState";

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

test("the action names an existing timestamp before another attempt", () => {
  const timedIn = manualRecordState(true, false, false, { timein: "2026-09-25T00:00:00Z", timeout: null });
  const timedOut = manualRecordState(true, false, false, { timein: null, timeout: "2026-09-25T01:00:00Z" });
  assert.equal(recordActionLabel("TIME_IN", timedIn), "Already timed in");
  assert.equal(recordActionLabel("TIME_OUT", timedOut), "Already timed out");
  assert.equal(detailActionDisabled("TIME_IN", timedIn), true);
  assert.equal(detailActionDisabled("TIME_OUT", timedOut), true);
  assert.equal(recordActionLabel("TIME_OUT", manualRecordState(true, false, false, null)), "Record time out");
});

test("an initial status check does not offer a record action yet", () => {
  const loading = manualRecordState(true, true, false, null);
  assert.equal(recordActionLabel("TIME_IN", loading), "Checking status…");
  assert.equal(detailActionDisabled("TIME_IN", loading), true);
  assert.equal(detailActionDisabled("TIME_OUT", loading), true);
});
