import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Worker } from "node:worker_threads";
import type { PrismaClient } from "@prisma/client";
import {
  createDisposableDb,
  createTestClient,
  type DisposableDb,
} from "@/globals/libs/testDb";
import { readAttendanceProgress, ProgressReadError } from "./attendanceProgressRead";
import { parseProgressQuery } from "./attendanceProgressQuery";

let disposable: DisposableDb;
let db: PrismaClient;
let disconnect: () => Promise<void>;
let eventId: string;
let groupId: string;
const viewer = { id: "viewer", role: "ORGANIZER" as const };

before(async () => {
  disposable = await createDisposableDb("test");
  const client = createTestClient(disposable.url);
  db = client.db;
  disconnect = client.disconnect;
  await db.user.create({ data: { id: "owner", name: "Owner", email: "owner@example.test", password: "test", status: "ACTIVE" } });
  await db.user.create({ data: { id: "viewer", name: "Viewer", email: "viewer@example.test", password: "test", status: "ACTIVE" } });
  const group = await db.group.create({ data: { name: "Section A", slug: "section-a", category: "SECTION" } });
  groupId = group.id;
  const event = await db.event.create({ data: {
    title: "Progress", category: "ALL", status: "APPROVED", start: new Date(), end: new Date(), createdById: null,
  } });
  eventId = event.id;
  for (let i = 1; i <= 3; i++) await db.student.create({ data: {
    id: `S${i}`, firstName: `First${i}`, lastName: "Student", schoolLevel: "COLLEGE", yearLevel: "YEAR_1",
    groups: i < 3 ? { connect: { id: groupId } } : undefined,
  } });
  await db.record.create({ data: { eventId, studentId: "S1", method: "SCANNED", timein: new Date() } });
  await db.record.create({ data: { eventId, studentId: "S2", method: "SCANNED", timeout: new Date() } });
});
after(async () => { await disconnect?.(); await disposable?.cleanup(); });

test("read transaction returns one authorized current-roster evaluation", async () => {
  const query = parseProgressQuery(new URLSearchParams(`includeRows=1&bucket=g:${groupId}`));
  const result = await readAttendanceProgress(db, eventId, viewer, query);
  assert.deepEqual(result.totals, { eligible: 3, checkedIn: 1, notYet: 2, rate: (1 / 3) * 100 });
  assert.equal(result.detail?.bucketTotals.eligible, 2);
  assert.deepEqual(result.detail?.rows.map((row) => row.studentId), ["S2"]);
  assert.equal(result.diagnostics.recordsWithoutTimeIn, 1);
  assert.equal(JSON.stringify(result).includes("password"), false);
});

test("wrong-category and deleted group buckets fail instead of widening scope", async () => {
  const other = await db.group.create({ data: { name: "House", slug: "house", category: "HOUSE" } });
  for (const id of [other.id, "deleted-group"]) {
    await assert.rejects(readAttendanceProgress(db, eventId, viewer,
      parseProgressQuery(new URLSearchParams(`bucket=g:${id}`))),
    (error: unknown) => error instanceof ProgressReadError && error.code === "INVALID_PROGRESS_BUCKET");
  }
});

test("role and account changes are revalidated within the read transaction", async () => {
  await db.user.update({ where: { id: "viewer" }, data: { status: "PENDING" } });
  await assert.rejects(readAttendanceProgress(db, eventId, viewer, parseProgressQuery(new URLSearchParams())),
    (error: unknown) => error instanceof ProgressReadError && error.status === 403);
  await db.user.update({ where: { id: "viewer" }, data: { status: "ACTIVE" } });
});

test("a scan, roster edit, group rename, and status change cannot mix into one progress read", async () => {
  await db.student.create({ data: { id: "S4", firstName: "Fourth", lastName: "Student", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
  const writer = new Worker(new URL("./fixtures/progressConcurrentWriter.mjs", import.meta.url), {
    workerData: { url: disposable.url, eventId, groupId },
  });
  const message = () => new Promise<unknown>((resolve, reject) => {
    writer.once("message", resolve);
    writer.once("error", reject);
  });
  try {
    assert.equal(await message(), "ready");
    let releaseReader!: () => void;
    let signalEventRead!: () => void;
    const holdReader = new Promise<void>((resolve) => { releaseReader = resolve; });
    const eventRead = new Promise<void>((resolve) => { signalEventRead = resolve; });
    const query = parseProgressQuery(new URLSearchParams("includeRows=1&status=NOT_YET&groupBy=SECTION"));
    const readPromise = readAttendanceProgress(db, eventId, viewer, query, {
      afterEventRead: async () => { signalEventRead(); await holdReader; },
    });
    await eventRead;
    const attempting = message();
    writer.postMessage("start");
    assert.equal(await attempting, "attempting");
    const writeResult = message();
    // The writer runs on an independent pool/connection so it cannot block
    // this thread from releasing the reader's Repeatable Read snapshot.
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseReader();
    const [read, write] = await Promise.allSettled([readPromise, writeResult]);
    assert.equal(write.status, "fulfilled", write.status === "rejected" ? String(write.reason) : undefined);
    if (write.status === "fulfilled") assert.equal(write.value, "committed", JSON.stringify(write.value));
    if (read.status === "fulfilled") {
      const result = read.value;
      assert.equal(result.totals.eligible, 4);
      assert.equal(result.event.status, "APPROVED");
      assert.equal(result.totals.checkedIn, 1);
      assert.equal(result.totals.checkedIn + result.totals.notYet, 4);
      assert.equal(result.breakdown.reduce((sum, bucket) => sum + bucket.checkedIn, 0), result.totals.checkedIn);
      assert.equal(result.detail?.rows.length, result.totals.notYet);
      assert.equal(result.breakdown.find((bucket) => bucket.bucketKey === `g:${groupId}`)?.label, "Section A");
      assert.equal(result.breakdown.find((bucket) => bucket.bucketKey === `g:${groupId}`)?.eligible, 2);
    } else {
      // Repeatable Read serialization failures surface as P2034/40001 — still
      // proof the snapshot did not mix the concurrent write.
      assert.match(String(read.reason), /P2034|40001|serialization|deadlock|busy|locked|timeout/i);
    }
  } finally { await writer.terminate(); }
});

test("nonapproved events are unavailable after visibility check", async () => {
  await db.event.update({ where: { id: eventId }, data: { status: "DRAFT", createdById: "owner" } });
  const query = parseProgressQuery(new URLSearchParams());
  await assert.rejects(readAttendanceProgress(db, eventId, viewer, query),
    (error: unknown) => error instanceof ProgressReadError && error.status === 403);
  await assert.rejects(readAttendanceProgress(db, eventId, { id: "owner" }, query),
    (error: unknown) => error instanceof ProgressReadError && error.status === 409);
});
