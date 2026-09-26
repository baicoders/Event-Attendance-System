import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createDisposableDb, createTestClient, type DisposableDb, type TestClient } from "@/globals/libs/testDb";

let disposable: DisposableDb;
let client: TestClient;
let db: PrismaClient;
let ownerId: string;
let eventId: string;
let studentId: string;

before(async () => {
  disposable = await createDisposableDb("test_issue48");
  client = createTestClient(disposable.url);
  db = client.db;
  const owner = await db.user.create({ data: { name: "Ana", email: "ana@example.test", password: "test", status: "ACTIVE" } });
  ownerId = owner.id;
  const student = await db.student.create({ data: { id: "00000123456", firstName: "Juan", lastName: "Cruz", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
  studentId = student.id;
  const event = await db.event.create({ data: { title: "Review", category: "ALL", status: "APPROVED", start: new Date("2026-09-25T00:00:00Z"), end: new Date("2026-09-26T00:00:00Z"), createdById: ownerId } });
  eventId = event.id;
});
after(async () => { await client?.disconnect(); await disposable?.cleanup(); });

test("correction writes authoritative before and after and exact replay does not mutate again", async () => {
  const { correctAttendance } = await import("./correctAttendance");
  const { parseSnapshot } = await import("./attendanceChange");
  const original = await db.record.create({ data: { eventId, studentId, method: "SCANNED", timein: new Date("2026-09-25T00:02:00Z"), timeout: new Date("2026-09-25T01:00:00Z") } });
  const command = { commandId: randomUUID(), action: "CORRECT" as const, studentId, recordId: original.id, expectedRevision: 0, timein: "2026-09-25T08:02:00+08:00", timeout: null, reason: "Accidental time-out" };
  const first = await correctAttendance(db, eventId, command, { id: ownerId, credentialVersion: 0 });
  assert.equal(first.replayed, false);
  assert.equal(first.before?.revision, 0);
  assert.equal(first.after?.revision, 1);
  assert.equal(first.after?.method, "SCANNED");
  assert.equal(first.after?.timeout, null);
  const replay = await correctAttendance(db, eventId, command, { id: ownerId, credentialVersion: 0 });
  assert.equal(replay.replayed, true);
  assert.equal(replay.changeId, first.changeId);
  assert.equal(await db.attendanceChange.count({ where: { eventId, studentId } }), 1);
  const change = await db.attendanceChange.findUniqueOrThrow({ where: { id: BigInt(first.changeId) } });
  assert.equal(change.reason, command.reason);
  assert.equal(change.actorId, ownerId);
  assert.equal(parseSnapshot(change.before)?.timeout, "2026-09-25T01:00:00.000Z");
});

test("void preserves evidence and restore creates a new incarnation", async () => {
  const { correctAttendance } = await import("./correctAttendance");
  const current = await db.record.findUniqueOrThrow({ where: { eventId_studentId: { eventId, studentId } } });
  const removed = await correctAttendance(db, eventId, { commandId: randomUUID(), action: "VOID", studentId, recordId: current.id, expectedRevision: current.revision, reason: "Wrong student scanned" }, { id: ownerId, credentialVersion: 0 });
  assert.equal(removed.after, null);
  assert.equal(await db.record.count({ where: { eventId, studentId } }), 0);
  const restored = await correctAttendance(db, eventId, { commandId: randomUUID(), action: "RESTORE", studentId, sourceChangeId: removed.changeId, reason: "Verified original scan" }, { id: ownerId, credentialVersion: 0 });
  assert.notEqual(restored.after?.id, current.id);
  assert.equal(restored.after?.revision, 1);
  assert.equal(restored.after?.method, current.method);
  assert.equal(await db.attendanceChange.count({ where: { eventId, studentId } }), 3);
});

test("review directory includes a history-only pair after void", async () => {
  const { listAttendanceReview } = await import("./attendanceReview");
  const { correctAttendance } = await import("./correctAttendance");
  const historyStudent = await db.student.create({ data: { id: "00000123457", firstName: "Maria", lastName: "Santos", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
  const current = await db.record.create({ data: { eventId, studentId: historyStudent.id, method: "MANUAL", timein: new Date("2026-09-25T00:00:00Z") } });
  await correctAttendance(db, eventId, { commandId: randomUUID(), action: "VOID", studentId: historyStudent.id, recordId: current.id, expectedRevision: current.revision, reason: "Duplicate evidence" }, { id: ownerId, credentialVersion: 0 });
  const page = await listAttendanceReview(db, eventId, { id: ownerId, credentialVersion: 0 }, { page: 1, pageSize: 30, state: "voided", search: "maria santos" });
  assert.equal(page.total, 1);
  assert.equal(page.items[0].studentId, historyStudent.id);
  assert.equal(page.items[0].record, null);
  assert.equal(page.items[0].latestAction, "VOID");
});

test("an old record ID cannot correct a later incarnation for the same pair", async () => {
  const { correctAttendance, CorrectionError } = await import("./correctAttendance");
  const { recordAttendance } = await import("./recordAttendance");
  const student = await db.student.create({ data: { id: "00000123466", firstName: "Rae", lastName: "Cruz", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
  const old = await db.record.create({ data: { eventId, studentId: student.id, method: "MANUAL", timein: new Date("2026-09-25T00:00:00Z") } });
  await correctAttendance(db, eventId, { commandId: randomUUID(), action: "VOID", studentId: student.id, recordId: old.id,
    expectedRevision: 0, reason: "Wrong attendance entry" }, { id: ownerId, credentialVersion: 0 });
  const fresh = await recordAttendance(db, { eventId, studentId: student.id, method: "SCANNED" }, { id: ownerId, role: "ORGANIZER", credentialVersion: 0 });
  assert.notEqual(fresh.record.id, old.id);
  await assert.rejects(correctAttendance(db, eventId, { commandId: randomUUID(), action: "CORRECT", studentId: student.id,
    recordId: old.id, expectedRevision: 0, timein: "2026-09-25T00:02:00Z", timeout: null,
    reason: "Trying stale editor" }, { id: ownerId, credentialVersion: 0 }),
  (error: unknown) => error instanceof CorrectionError && error.code === "RECORD_ALREADY_REPLACED");
});

test("failed history insertion rolls back a provisional normal record", async () => {
  const { recordAttendance } = await import("./recordAttendance");
  const student = await db.student.create({ data: { id: "00000123458", firstName: "Rosa", lastName: "Cruz", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
  await db.$executeRawUnsafe("CREATE FUNCTION fail_attendance_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'history failure'; END; $$");
  await db.$executeRawUnsafe('CREATE TRIGGER fail_attendance_history BEFORE INSERT ON "AttendanceChange" FOR EACH ROW EXECUTE FUNCTION fail_attendance_history()');
  try {
    await assert.rejects(recordAttendance(db, { eventId, studentId: student.id, method: "SCANNED" }, { id: ownerId, role: "ORGANIZER", credentialVersion: 0 }));
    assert.equal(await db.record.count({ where: { eventId, studentId: student.id } }), 0);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER fail_attendance_history ON "AttendanceChange"');
    await db.$executeRawUnsafe("DROP FUNCTION fail_attendance_history()");
  }
});

test("two independent corrections of one revision commit only one history entry", async () => {
  const { correctAttendance } = await import("./correctAttendance");
  const student = await db.student.create({ data: { id: "00000123459", firstName: "Lina", lastName: "Reyes", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
  const record = await db.record.create({ data: { eventId, studentId: student.id, method: "MANUAL", timein: new Date("2026-09-25T00:00:00Z") } });
  const other = createTestClient(disposable.url);
  try {
    const base = { action: "CORRECT" as const, studentId: student.id, recordId: record.id, expectedRevision: 0, timeout: null, reason: "Verified scan time" };
    const results = await Promise.allSettled([
      correctAttendance(db, eventId, { ...base, commandId: randomUUID(), timein: "2026-09-25T00:01:00Z" }, { id: ownerId, credentialVersion: 0 }),
      correctAttendance(other.db, eventId, { ...base, commandId: randomUUID(), timein: "2026-09-25T00:02:00Z" }, { id: ownerId, credentialVersion: 0 }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await db.record.findUniqueOrThrow({ where: { id: record.id } })).revision, 1);
    assert.equal(await db.attendanceChange.count({ where: { recordId: record.id } }), 1);
  } finally { await other.disconnect(); }
});

test("stale revision and reused command ID cannot rewrite evidence", async () => {
  const { correctAttendance, CorrectionError } = await import("./correctAttendance");
  const student = await db.student.create({ data: { id: "00000123460", firstName: "Nina", lastName: "Tan", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
  const record = await db.record.create({ data: { eventId, studentId: student.id, method: "MANUAL", timein: new Date("2026-09-25T00:00:00Z") } });
  const commandId = randomUUID();
  await correctAttendance(db, eventId, { commandId, action: "CORRECT", studentId: student.id, recordId: record.id, expectedRevision: 0,
    timein: "2026-09-25T00:01:00Z", timeout: null, reason: "Corrected scan time" }, { id: ownerId, credentialVersion: 0 });
  await assert.rejects(correctAttendance(db, eventId, { commandId: randomUUID(), action: "VOID", studentId: student.id,
    recordId: record.id, expectedRevision: 0, reason: "Wrong student scanned" }, { id: ownerId, credentialVersion: 0 }),
    (error: unknown) => error instanceof CorrectionError && error.code === "RECORD_CHANGED");
  await assert.rejects(correctAttendance(db, eventId, { commandId, action: "CORRECT", studentId: student.id, recordId: record.id,
    expectedRevision: 0, timein: "2026-09-25T00:02:00Z", timeout: null, reason: "Corrected scan time" }, { id: ownerId, credentialVersion: 0 }),
    (error: unknown) => error instanceof CorrectionError && error.code === "COMMAND_ID_REUSED");
  assert.equal(await db.attendanceChange.count({ where: { recordId: record.id } }), 1);
});

test("non-owner cannot read or mutate free-text attendance history", async () => {
  const { listAttendanceReview } = await import("./attendanceReview");
  const { correctAttendance, CorrectionError } = await import("./correctAttendance");
  const other = await db.user.create({ data: { name: "Other", email: "other@example.test", password: "test", status: "ACTIVE" } });
  await assert.rejects(listAttendanceReview(db, eventId, { id: other.id, credentialVersion: 0 }, {}),
    (error: unknown) => error instanceof CorrectionError && error.code === "FORBIDDEN");
  await assert.rejects(correctAttendance(db, eventId, { commandId: randomUUID(), action: "RESTORE", studentId,
    sourceChangeId: "1", reason: "Another request" }, { id: other.id, credentialVersion: 0 }),
    (error: unknown) => error instanceof CorrectionError && error.code === "FORBIDDEN");
});

test("active admin may correct, while a forced-password-change manager cannot", async () => {
  const { correctAttendance, CorrectionError } = await import("./correctAttendance");
  const { listAttendanceReview } = await import("./attendanceReview");
  const admin = await db.user.create({ data: { name: "Admin", email: "admin@example.test", password: "test", role: "ADMIN", status: "ACTIVE" } });
  const gated = await db.user.create({ data: { name: "Gated", email: "gated@example.test", password: "test", role: "ADMIN", status: "ACTIVE", mustChangePassword: true } });
  const student = await db.student.create({ data: { id: "00000123467", firstName: "Neri", lastName: "Mendoza", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
  const record = await db.record.create({ data: { eventId, studentId: student.id, method: "MANUAL", timein: new Date("2026-09-25T00:00:00Z") } });
  await assert.rejects(correctAttendance(db, eventId, { commandId: randomUUID(), action: "CORRECT", studentId: student.id,
    recordId: record.id, expectedRevision: 0, timein: "2026-09-25T00:01:00Z", timeout: null,
    reason: "Verified original scan" }, { id: gated.id, credentialVersion: 0 }),
  (error: unknown) => error instanceof CorrectionError && error.code === "UNAUTHORIZED");
  const command = { commandId: randomUUID(), action: "CORRECT" as const, studentId: student.id,
    recordId: record.id, expectedRevision: 0, timein: "2026-09-25T00:01:00Z", timeout: null,
    reason: "Verified original scan" };
  const corrected = await correctAttendance(db, eventId, command, { id: admin.id, credentialVersion: 0 });
  assert.equal(corrected.after?.revision, 1);
  await db.user.update({ where: { id: admin.id }, data: { credentialVersion: { increment: 1 } } });
  await assert.rejects(correctAttendance(db, eventId, command, { id: admin.id, credentialVersion: 0 }),
    (error: unknown) => error instanceof CorrectionError && error.code === "UNAUTHORIZED");
  await assert.rejects(listAttendanceReview(db, eventId, { id: admin.id, credentialVersion: 0 }, {}),
    (error: unknown) => error instanceof CorrectionError && error.code === "UNAUTHORIZED");
});

test("a committed credential reset wins before a correction can acquire its actor guard", async () => {
  const { correctAttendance, CorrectionError } = await import("./correctAttendance");
  const manager = await db.user.create({ data: { name: "Revoked", email: "revoked@example.test", password: "test", role: "ADMIN", status: "ACTIVE" } });
  const student = await db.student.create({ data: { id: "00000123468", firstName: "Lee", lastName: "Ramos", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
  const record = await db.record.create({ data: { eventId, studentId: student.id, method: "MANUAL", timein: new Date("2026-09-25T00:00:00Z") } });
  const blocker = createTestClient(disposable.url, 1);
  const caller = createTestClient(disposable.url, 1);
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { started = resolve; });
  try {
    const revoke = blocker.db.$transaction(async (tx) => { await tx.user.update({ where: { id: manager.id }, data: { credentialVersion: { increment: 1 } } }); started(); await held; });
    await ready;
    const correction = correctAttendance(caller.db, eventId, { commandId: randomUUID(), action: "CORRECT", studentId: student.id,
      recordId: record.id, expectedRevision: 0, timein: "2026-09-25T00:01:00Z", timeout: null,
      reason: "Verified original scan" }, { id: manager.id, credentialVersion: 0 });
    let settled = false;
    void correction.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(settled, false);
    release();
    await revoke;
    await assert.rejects(correction, (error: unknown) => error instanceof CorrectionError && error.code === "UNAUTHORIZED");
    assert.equal(await db.attendanceChange.count({ where: { recordId: record.id } }), 0);
  } finally { release(); await Promise.all([blocker.disconnect(), caller.disconnect()]); }
});

test("restore rejects a voided future timestamp instead of reintroducing invalid evidence", async () => {
  const { correctAttendance, CorrectionError } = await import("./correctAttendance");
  const student = await db.student.create({ data: { id: "00000123461", firstName: "Jo", lastName: "Lim", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
  const record = await db.record.create({ data: { eventId, studentId: student.id, method: "SCANNED", timein: new Date(Date.now() + 60000) } });
  const voided = await correctAttendance(db, eventId, { commandId: randomUUID(), action: "VOID", studentId: student.id,
    recordId: record.id, expectedRevision: 0, reason: "Incorrect future scan" }, { id: ownerId, credentialVersion: 0 });
  await assert.rejects(correctAttendance(db, eventId, { commandId: randomUUID(), action: "RESTORE", studentId: student.id,
    sourceChangeId: voided.changeId, reason: "Trying to restore" }, { id: ownerId, credentialVersion: 0 }),
    (error: unknown) => error instanceof CorrectionError && error.code === "INVALID_HISTORICAL_RECORD");
  assert.equal(await db.record.count({ where: { eventId, studentId: student.id } }), 0);
});

test("timeout-only evidence can be corrected and restored without inventing a time-in", async () => {
  const { correctAttendance } = await import("./correctAttendance");
  const student = await db.student.create({ data: { id: "00000123463", firstName: "Tia", lastName: "Lopez", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
  const record = await db.record.create({ data: { eventId, studentId: student.id, method: "SCANNED", timein: null,
    timeout: new Date("2026-09-25T01:00:00Z") } });
  const corrected = await correctAttendance(db, eventId, { commandId: randomUUID(), action: "CORRECT", studentId: student.id,
    recordId: record.id, expectedRevision: 0, timein: null, timeout: "2026-09-25T09:05:00+08:00",
    reason: "Verified time-out evidence" }, { id: ownerId, credentialVersion: 0 });
  assert.equal(corrected.after?.timein, null);
  assert.equal(corrected.after?.timeout, "2026-09-25T01:05:00.000Z");
  const voided = await correctAttendance(db, eventId, { commandId: randomUUID(), action: "VOID", studentId: student.id,
    recordId: record.id, expectedRevision: 1, reason: "Reviewing scan identity" }, { id: ownerId, credentialVersion: 0 });
  const restored = await correctAttendance(db, eventId, { commandId: randomUUID(), action: "RESTORE", studentId: student.id,
    sourceChangeId: voided.changeId, reason: "Verified time-out identity" }, { id: ownerId, credentialVersion: 0 });
  assert.equal(restored.after?.timein, null);
  assert.equal(restored.after?.timeout, corrected.after?.timeout);
});

test("exact replay returns its immutable receipt after a later correction", async () => {
  const { correctAttendance } = await import("./correctAttendance");
  const student = await db.student.create({ data: { id: "00000123462", firstName: "Mia", lastName: "Ong", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
  const record = await db.record.create({ data: { eventId, studentId: student.id, method: "SCANNED", timein: new Date("2026-09-25T00:00:00Z") } });
  const original = { commandId: randomUUID(), action: "CORRECT" as const, studentId: student.id, recordId: record.id,
    expectedRevision: 0, timein: "2026-09-25T00:01:00Z", timeout: null, reason: "Verified original scan" };
  const first = await correctAttendance(db, eventId, original, { id: ownerId, credentialVersion: 0 });
  await correctAttendance(db, eventId, { ...original, commandId: randomUUID(), expectedRevision: 1,
    timein: "2026-09-25T00:02:00Z", reason: "Verified later evidence" }, { id: ownerId, credentialVersion: 0 });
  const replay = await correctAttendance(db, eventId, original, { id: ownerId, credentialVersion: 0 });
  assert.equal(replay.replayed, true);
  assert.equal(replay.changeId, first.changeId);
  assert.equal(replay.after?.timein, first.after?.timein);
  assert.equal((await db.record.findUniqueOrThrow({ where: { id: record.id } })).revision, 2);
});

test("roster shared guards coexist and an exclusive roster writer waits", async () => {
  const { takeRosterSharedLock, takeRosterExclusiveLock } = await import("@/globals/utils/pgLocks");
  const first = createTestClient(disposable.url, 1);
  const second = createTestClient(disposable.url, 1);
  const writer = createTestClient(disposable.url, 1);
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  let firstAcquired!: () => void;
  let secondAcquired!: () => void;
  let writerAcquired = false;
  const firstReady = new Promise<void>((resolve) => { firstAcquired = resolve; });
  const secondReady = new Promise<void>((resolve) => { secondAcquired = resolve; });
  const firstHold = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const secondHold = new Promise<void>((resolve) => { releaseSecond = resolve; });
  try {
    const firstWork = first.db.$transaction(async (tx) => { await takeRosterSharedLock(tx); firstAcquired(); await firstHold; });
    await firstReady;
    const secondWork = second.db.$transaction(async (tx) => { await takeRosterSharedLock(tx); secondAcquired(); await secondHold; });
    await Promise.race([secondReady, new Promise((_, reject) => setTimeout(() => reject(new Error("Shared lock did not coexist")), 1000))]);
    const writerWork = writer.db.$transaction(async (tx) => { await takeRosterExclusiveLock(tx); writerAcquired = true; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(writerAcquired, false);
    releaseFirst(); releaseSecond();
    await Promise.all([firstWork, secondWork, writerWork]);
    assert.equal(writerAcquired, true);
  } finally {
    releaseFirst(); releaseSecond();
    await Promise.all([first.disconnect(), second.disconnect(), writer.disconnect()]);
  }
});

test("concurrent identical commands commit one receipt and replay the other", async () => {
  const { correctAttendance } = await import("./correctAttendance");
  const student = await db.student.create({ data: { id: "00000123464", firstName: "Dina", lastName: "Castro", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
  const record = await db.record.create({ data: { eventId, studentId: student.id, method: "MANUAL", timein: new Date("2026-09-25T00:00:00Z") } });
  const other = createTestClient(disposable.url);
  const command = { commandId: randomUUID(), action: "CORRECT" as const, studentId: student.id, recordId: record.id,
    expectedRevision: 0, timein: "2026-09-25T00:01:00Z", timeout: null, reason: "Verified original scan" };
  try {
    const results = await Promise.all([
      correctAttendance(db, eventId, command, { id: ownerId, credentialVersion: 0 }),
      correctAttendance(other.db, eventId, command, { id: ownerId, credentialVersion: 0 }),
    ]);
    assert.deepEqual(results.map((result) => result.replayed).sort(), [false, true]);
    assert.equal(results[0].changeId, results[1].changeId);
    assert.equal(await db.attendanceChange.count({ where: { recordId: record.id } }), 1);
  } finally { await other.disconnect(); }
});

test("BigInt journal IDs remain decimal strings through receipts and history cursors", async () => {
  const { correctAttendance } = await import("./correctAttendance");
  const { getAttendanceHistory } = await import("./attendanceReview");
  const student = await db.student.create({ data: { id: "00000123465", firstName: "Iris", lastName: "Diaz", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
  const record = await db.record.create({ data: { eventId, studentId: student.id, method: "MANUAL", timein: new Date("2026-09-25T00:00:00Z") } });
  await db.$executeRawUnsafe('SELECT setval(pg_get_serial_sequence(\'"AttendanceChange"\', \'id\'), 9007199254740993, true)');
  const first = await correctAttendance(db, eventId, { commandId: randomUUID(), action: "CORRECT", studentId: student.id,
    recordId: record.id, expectedRevision: 0, timein: "2026-09-25T00:01:00Z", timeout: null,
    reason: "Verified original scan" }, { id: ownerId, credentialVersion: 0 });
  assert.equal(first.changeId, "9007199254740994");
  const second = await correctAttendance(db, eventId, { commandId: randomUUID(), action: "VOID", studentId: student.id,
    recordId: record.id, expectedRevision: 1, reason: "Incorrect student scan" }, { id: ownerId, credentialVersion: 0 });
  const page = await getAttendanceHistory(db, eventId, student.id, { id: ownerId, credentialVersion: 0 }, { limit: 1 });
  assert.equal(page.changes[0].id, second.changeId);
  assert.equal(page.nextBeforeId, second.changeId);
  const older = await getAttendanceHistory(db, eventId, student.id, { id: ownerId, credentialVersion: 0 }, { limit: 1, beforeId: page.nextBeforeId });
  assert.equal(older.changes[0].id, first.changeId);
  const restored = await correctAttendance(db, eventId, { commandId: randomUUID(), action: "RESTORE", studentId: student.id,
    sourceChangeId: second.changeId, reason: "Verified original scan" }, { id: ownerId, credentialVersion: 0 });
  assert.ok(BigInt(restored.changeId) > BigInt(second.changeId));
});
