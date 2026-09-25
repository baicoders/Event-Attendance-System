import assert from "node:assert/strict";
import { test } from "node:test";
import { createScanGate } from "./scanGate";

test("a continuously visible QR only submits once, even after one second", () => {
  const gate = createScanGate();
  const scan = { value: "00000123456", eventId: "event-a", mode: "TIME_IN" as const };
  assert.equal(gate.accept(scan), true);
  assert.equal(gate.accept(scan), false);
  assert.equal(gate.accept(scan), false);
});

test("a different code or event mode remains immediately scannable", () => {
  const gate = createScanGate();
  assert.equal(gate.accept({ value: "00000123456", eventId: "event-a", mode: "TIME_IN" }), true);
  assert.equal(gate.accept({ value: "00000987654", eventId: "event-a", mode: "TIME_IN" }), true);
  assert.equal(gate.accept({ value: "00000123456", eventId: "event-a", mode: "TIME_OUT" }), true);
});
