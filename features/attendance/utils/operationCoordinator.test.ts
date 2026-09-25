import assert from "node:assert/strict";
import { test } from "node:test";
import { createOperationCoordinator } from "./operationCoordinator";

const context = { eventId: "event-a", viewerId: "user-a", expectedMode: "TIME_IN" as const };
const student = { id: "00000123456", name: "Juan Cruz" };
const saved = { eventId: context.eventId, studentId: student.id, changed: true, operation: "TIME_IN" as const,
  timein: "2026-09-25T00:00:00.000Z", timeout: null };

test("busy begins before lookup and drops a same-tick second scan", async () => {
  let resolveLookup!: (value: typeof student) => void;
  let saves = 0;
  const coordinator = createOperationCoordinator({
    lookup: () => new Promise((resolve) => { resolveLookup = resolve; }),
    save: async () => { saves++; return saved; },
  });
  coordinator.setContext(context);
  const first = coordinator.submit({ studentId: student.id, method: "SCANNED" });
  const second = coordinator.submit({ studentId: "00000987654", method: "SCANNED" });
  assert.equal(coordinator.getState().phase, "LOOKUP");
  assert.equal(await second, null);
  resolveLookup(student);
  assert.equal((await first)?.outcome, "RECORDED");
  assert.equal(saves, 1);
});

test("obsolete lookup cannot send a write or appear under another event", async () => {
  let resolveLookup!: (value: typeof student) => void;
  let saves = 0;
  const coordinator = createOperationCoordinator({
    lookup: () => new Promise((resolve) => { resolveLookup = resolve; }),
    save: async () => { saves++; return saved; },
  });
  coordinator.setContext(context);
  const attempt = coordinator.submit({ studentId: student.id, method: "SCANNED" });
  coordinator.setContext({ ...context, eventId: "event-b" });
  resolveLookup(student);
  assert.equal(await attempt, null);
  assert.equal(saves, 0);
  assert.equal(coordinator.getState().recent.length, 0);
});

test("unknown write response is never green and recent attempts stay bounded", async () => {
  const coordinator = createOperationCoordinator({
    lookup: async () => student,
    save: async () => { throw new Error("connection lost"); },
  });
  coordinator.setContext(context);
  for (let i = 0; i < 22; i++) {
    await coordinator.submit({ studentId: student.id, method: "SCANNED" });
    coordinator.acknowledge();
  }
  assert.equal(coordinator.getState().lastResult?.outcome, "RESULT_UNKNOWN");
  assert.equal(coordinator.getState().recent.length, 20);
});

test("malformed response never confirms attendance", async () => {
  const coordinator = createOperationCoordinator({
    lookup: async () => student,
    save: async () => ({ ...saved, operation: "TIME_OUT" }),
  });
  coordinator.setContext(context);
  const result = await coordinator.submit({ studentId: student.id, method: "MANUAL", student });
  assert.equal(result?.outcome, "RESULT_UNKNOWN");
});

test("lost response after commit stays unknown and never replays", async () => {
  const stored: typeof saved[] = [];
  let writes = 0;
  const coordinator = createOperationCoordinator({
    lookup: async () => student,
    save: async () => { writes++; stored.push(saved); throw new Error("response dropped"); },
  });
  coordinator.setContext(context);
  const attempt = await coordinator.submit({ studentId: student.id, method: "SCANNED" });
  assert.equal(attempt?.outcome, "RESULT_UNKNOWN");
  assert.equal(stored[0]?.timein, saved.timein);
  assert.equal(writes, 1);
  assert.equal(await coordinator.submit({ studentId: student.id, method: "SCANNED" }), null);
  assert.equal(writes, 1);
});

test("lookup failure reports no write; mode conflict pauses until acknowledgement", async () => {
  let writes = 0;
  const lookupFail = createOperationCoordinator({
    lookup: async () => { throw new Error("offline"); },
    save: async () => { writes++; return saved; },
  });
  lookupFail.setContext(context);
  assert.equal((await lookupFail.submit({ studentId: student.id, method: "SCANNED" }))?.outcome, "LOOKUP_FAILED");
  assert.equal(writes, 0);

  const conflict = createOperationCoordinator({
    lookup: async () => student,
    save: async () => { throw Object.assign(new Error("mode changed"), { status: 409, code: "EVENT_MODE_CHANGED" }); },
  });
  conflict.setContext(context);
  assert.equal((await conflict.submit({ studentId: student.id, method: "SCANNED" }))?.outcome, "MODE_CHANGED");
  assert.equal(conflict.getState().phase, "AWAITING_ACKNOWLEDGEMENT");
});

test("malformed QR text makes no request and is never stored in recent attempts", async () => {
  let lookups = 0;
  let writes = 0;
  const coordinator = createOperationCoordinator({
    lookup: async () => { lookups++; return student; },
    save: async () => { writes++; return saved; },
  });
  coordinator.setContext(context);
  assert.equal(await coordinator.submit({ studentId: "https://example.invalid/qr/payload", method: "SCANNED" }), null);
  assert.equal(lookups, 0);
  assert.equal(writes, 0);
  assert.equal(coordinator.getState().recent.length, 0);
});

test("mode changes preserve this view's recent attempts while event and viewer changes clear them", async () => {
  const coordinator = createOperationCoordinator({ lookup: async () => student, save: async () => saved });
  coordinator.setContext(context);
  await coordinator.submit({ studentId: student.id, method: "SCANNED" });
  assert.equal(coordinator.getState().recent.length, 1);
  coordinator.setContext({ ...context, expectedMode: "TIME_OUT" });
  assert.equal(coordinator.getState().recent.length, 1);
  coordinator.setContext({ ...context, viewerId: "user-b" });
  assert.equal(coordinator.getState().recent.length, 0);
});
