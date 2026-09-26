import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  createDisposableDb,
  createTestClient,
  type DisposableDb,
} from "@/globals/libs/testDb";

let disposable: DisposableDb;
let db: PrismaClient;
let disconnect: () => Promise<void>;
let eventId: string;
let studentId: string;
let userId: string;

before(async () => {
  disposable = await createDisposableDb("test");
  const client = createTestClient(disposable.url);
  db = client.db;
  disconnect = client.disconnect;
  const user = await db.user.create({ data: {
    name: "Operator", email: "operator@example.test", password: "test", status: "ACTIVE",
  } });
  userId = user.id;
  const student = await db.student.create({ data: {
    id: "00000123456", firstName: "Juan", lastName: "Cruz", schoolLevel: "COLLEGE", yearLevel: "YEAR_1",
  } });
  studentId = student.id;
  const event = await db.event.create({ data: {
    title: "Test event", category: "ALL", status: "APPROVED", start: new Date("2026-09-25T00:00:00Z"),
    end: new Date("2026-09-26T00:00:00Z"), createdById: user.id,
  } });
  eventId = event.id;
});

after(async () => { await disconnect?.(); await disposable?.cleanup(); });

test("expected mode selects only a matching time-in and preserves first writer", async () => {
  const { recordAttendance } = await import("./recordAttendance");
  const input = { eventId, studentId, method: "SCANNED" as const, expectedMode: "TIME_IN" as const };
  const user = { id: userId, role: "ORGANIZER" as const };
  const first = await recordAttendance(db, input, user);
  assert.equal(first.operation, "TIME_IN");
  assert.equal(first.changed, true);
  assert.equal(first.created, true);
  assert.ok(first.record.timein);
  assert.equal(first.record.recordedById, userId);
  const again = await recordAttendance(db, input, user);
  assert.equal(again.changed, false);
  assert.equal(again.created, false);
  assert.equal(again.record.timein?.toISOString(), first.record.timein?.toISOString());
  assert.equal(again.record.method, "SCANNED");
});

test("a stale time-in request cannot write after global mode changes", async () => {
  const { recordAttendance, RecordingError } = await import("./recordAttendance");
  await db.event.update({ where: { id: eventId }, data: { isTimeout: true } });
  await assert.rejects(
    recordAttendance(db, { eventId, studentId, method: "MANUAL", expectedMode: "TIME_IN" }, { id: userId, role: "ORGANIZER" }),
    (error: unknown) => error instanceof RecordingError && error.code === "EVENT_MODE_CHANGED",
  );
  const current = await db.record.findUniqueOrThrow({ where: { eventId_studentId: { eventId, studentId } } });
  assert.equal(current.timeout, null);
});

test("time-out without time-in creates a record with null time-in and preserves the first time-out", async () => {
  const { recordAttendance } = await import("./recordAttendance");
  const other = await db.student.create({ data: {
    id: "00000987654", firstName: "Maria", lastName: "Santos", schoolLevel: "COLLEGE", yearLevel: "YEAR_1",
  } });
  const timeoutOnlyInput = { eventId, studentId: other.id, method: "SCANNED" as const, expectedMode: "TIME_OUT" as const };
  const timeoutOnly = await recordAttendance(db, timeoutOnlyInput, { id: userId, role: "ORGANIZER" });
  const timeoutOnlyAgain = await recordAttendance(db, timeoutOnlyInput, { id: userId, role: "ORGANIZER" });
  assert.equal(timeoutOnly.created, true);
  assert.equal(timeoutOnly.changed, true);
  assert.equal(timeoutOnly.record.timein, null);
  assert.ok(timeoutOnly.record.timeout);
  assert.equal(timeoutOnly.record.recordedById, userId);
  assert.equal(timeoutOnlyAgain.changed, false);
  assert.equal(timeoutOnlyAgain.record.timein, null);
  assert.equal(timeoutOnlyAgain.record.timeout?.toISOString(), timeoutOnly.record.timeout?.toISOString());
  const input = { eventId, studentId, method: "MANUAL" as const, expectedMode: "TIME_OUT" as const };
  const user = { id: userId, role: "ORGANIZER" as const };
  const first = await recordAttendance(db, input, user);
  const again = await recordAttendance(db, input, user);
  assert.equal(first.changed, true);
  assert.equal(again.changed, false);
  assert.equal(first.record.lastModifiedById, userId);
  assert.equal(again.record.timeout?.toISOString(), first.record.timeout?.toISOString());
  assert.equal(again.record.method, "SCANNED");
});

test("independent PostgreSQL clients never commit the opposite mode during a switch", async () => {
  const { recordAttendance } = await import("./recordAttendance");
  const second = createTestClient(disposable.url);
  try {
    for (let i = 0; i < 12; i++) {
      const currentEvent = await db.event.create({ data: {
        title: `Race ${i}`, category: "ALL", status: "APPROVED", createdById: userId,
        start: new Date("2026-09-25T00:00:00Z"), end: new Date("2026-09-26T00:00:00Z"),
      } });
      const [scan] = await Promise.allSettled([
        recordAttendance(db, { eventId: currentEvent.id, studentId, method: "SCANNED", expectedMode: "TIME_IN" }, { id: userId, role: "ORGANIZER" }),
        second.db.event.update({ where: { id: currentEvent.id }, data: { isTimeout: true } }),
      ]);
      const persisted = await db.record.findUnique({ where: { eventId_studentId: { eventId: currentEvent.id, studentId } } });
      assert.equal(persisted?.timeout ?? null, null);
      if (scan.status === "fulfilled") {
        assert.equal(scan.value.operation, "TIME_IN");
        assert.ok(persisted?.timein);
      } else {
        assert.equal(persisted, null);
      }
    }
  } finally { await second.disconnect(); }
});

test("a time-out racing a switch back to time-in preserves the prior time-in", async () => {
  const { recordAttendance } = await import("./recordAttendance");
  const second = createTestClient(disposable.url);
  try {
    const event = await db.event.create({ data: {
      title: "Reverse race", category: "ALL", status: "APPROVED", createdById: userId,
      start: new Date("2026-09-25T00:00:00Z"), end: new Date("2026-09-26T00:00:00Z"),
    } });
    const owner = { id: userId, role: "ORGANIZER" as const };
    const before = await recordAttendance(db,
      { eventId: event.id, studentId, method: "SCANNED", expectedMode: "TIME_IN" }, owner);
    await db.event.update({ where: { id: event.id }, data: { isTimeout: true } });
    const [scan] = await Promise.allSettled([
      recordAttendance(db, { eventId: event.id, studentId, method: "MANUAL", expectedMode: "TIME_OUT" }, owner),
      second.db.event.update({ where: { id: event.id }, data: { isTimeout: false } }),
    ]);
    const persisted = await db.record.findUniqueOrThrow({ where: { eventId_studentId: { eventId: event.id, studentId } } });
    assert.equal(persisted.timein?.toISOString(), before.record.timein?.toISOString());
    assert.equal(persisted.method, "SCANNED");
    if (scan.status === "fulfilled") {
      assert.equal(scan.value.operation, "TIME_OUT");
      assert.ok(persisted.timeout);
    } else {
      assert.equal(persisted.timeout, null);
    }
  } finally { await second.disconnect(); }
});

test("five concurrent requests preserve one record and write-once timestamps", async () => {
  const { recordAttendance } = await import("./recordAttendance");
  // Same-client concurrency plus two independent pools: the pair advisory lock
  // + unique constraint converge to one record regardless of pool.
  const second = createTestClient(disposable.url);
  const third = createTestClient(disposable.url);
  try {
    const clients = [db, db, db, second.db, third.db];
    const event = await db.event.create({ data: {
      title: "Concurrent scans", category: "ALL", status: "APPROVED", createdById: userId,
      start: new Date("2026-09-25T00:00:00Z"), end: new Date("2026-09-26T00:00:00Z"),
    } });
    const timeins = await Promise.allSettled(clients.map((client) => recordAttendance(client,
      { eventId: event.id, studentId, method: "SCANNED", expectedMode: "TIME_IN" }, { id: userId, role: "ORGANIZER" })));
    assert.ok(timeins.some((result) => result.status === "fulfilled"));
    const before = await db.record.findUniqueOrThrow({ where: { eventId_studentId: { eventId: event.id, studentId } } });
    await db.event.update({ where: { id: event.id }, data: { isTimeout: true } });
    const timeouts = await Promise.allSettled(clients.map((client) => recordAttendance(client,
      { eventId: event.id, studentId, method: "MANUAL", expectedMode: "TIME_OUT" }, { id: userId, role: "ORGANIZER" })));
    assert.ok(timeouts.some((result) => result.status === "fulfilled"));
    const after = await db.record.findMany({ where: { eventId: event.id, studentId } });
    assert.equal(after.length, 1);
    assert.equal(after[0].timein?.toISOString(), before.timein?.toISOString());
    assert.ok(after[0].timeout);
    assert.equal(after[0].method, "SCANNED");
  } finally {
    await second.disconnect();
    await third.disconnect();
  }
});

test("different students scanning the same event proceed concurrently", async () => {
  const { recordAttendance } = await import("./recordAttendance");
  const second = createTestClient(disposable.url);
  try {
    const event = await db.event.create({ data: {
      title: "Different-pair concurrency", category: "ALL", status: "APPROVED", createdById: userId,
      start: new Date("2026-09-25T00:00:00Z"), end: new Date("2026-09-26T00:00:00Z"),
    } });
    const a = await db.student.create({ data: {
      id: "00000110011", firstName: "Pair", lastName: "A", schoolLevel: "COLLEGE", yearLevel: "YEAR_1",
    } });
    const b = await db.student.create({ data: {
      id: "00000110022", firstName: "Pair", lastName: "B", schoolLevel: "COLLEGE", yearLevel: "YEAR_1",
    } });
    const owner = { id: userId, role: "ORGANIZER" as const };
    const [ra, rb] = await Promise.all([
      recordAttendance(db, { eventId: event.id, studentId: a.id, method: "SCANNED" }, owner),
      recordAttendance(second.db, { eventId: event.id, studentId: b.id, method: "SCANNED" }, owner),
    ]);
    assert.equal(ra.changed, true);
    assert.equal(rb.changed, true);
    assert.equal(await db.record.count({ where: { eventId: event.id } }), 2);
  } finally { await second.disconnect(); }
});

test("legacy requests follow server mode, while authorization and eligibility still deny writes", async () => {
  const { recordAttendance, RecordingError } = await import("./recordAttendance");
  const owner = { id: userId, role: "ORGANIZER" as const };
  const event = await db.event.create({ data: {
    title: "Legacy", category: "ALL", status: "APPROVED", createdById: userId,
    start: new Date("2026-09-25T00:00:00Z"), end: new Date("2026-09-26T00:00:00Z"),
  } });
  const legacy = { eventId: event.id, studentId, method: "MANUAL" as const };
  assert.equal((await recordAttendance(db, legacy, owner)).operation, "TIME_IN");
  await db.event.update({ where: { id: event.id }, data: { isTimeout: true } });
  assert.equal((await recordAttendance(db, legacy, owner)).operation, "TIME_OUT");

  const draft = await db.event.create({ data: {
    title: "Draft", category: "ALL", status: "DRAFT", createdById: userId,
    start: new Date("2026-09-25T00:00:00Z"), end: new Date("2026-09-26T00:00:00Z"),
  } });
  await assert.rejects(recordAttendance(db, { ...legacy, eventId: draft.id }, owner),
    (error: unknown) => error instanceof RecordingError && error.code === "INVALID_STATUS");
  await assert.rejects(recordAttendance(db, { ...legacy, eventId: draft.id }, { id: "another-organizer", role: "ORGANIZER" }),
    (error: unknown) => error instanceof RecordingError && error.code === "FORBIDDEN");
  const scoped = await db.event.create({ data: {
    title: "Other group", category: "HOUSE", status: "APPROVED", createdById: userId,
    start: new Date("2026-09-25T00:00:00Z"), end: new Date("2026-09-26T00:00:00Z"),
  } });
  await assert.rejects(recordAttendance(db, { ...legacy, eventId: scoped.id }, owner),
    (error: unknown) => error instanceof RecordingError && error.code === "STUDENT_UNAVAILABLE");
  assert.equal(await db.record.count({ where: { eventId: scoped.id } }), 0);
});
