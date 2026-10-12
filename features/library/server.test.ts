import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createDisposableDb, createTestClient, type DisposableDb } from "@/globals/libs/testDb";
import { recordLibraryScan, closeForgottenVisits, registerEmployee, registerLibraryStudent, readLibraryVisits } from "./server";
import { buildEventStudentFilter } from "@/globals/utils/buildEventStudentFilter";

let disposable: DisposableDb, db: PrismaClient, disconnect: () => Promise<void>;
let actor: { id: string; role: "ADMIN"; credentialVersion: number };
const at = (clock: string) => new Date(`2026-10-12T${clock}+08:00`);
const person = (id: string) => db.student.create({ data: { id, firstName: "Juan", lastName: "Cruz", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
const scan = (studentId: string, now: Date, requestId = randomUUID()) => recordLibraryScan(db, { studentId, requestId }, actor, () => now);
before(async () => {
  disposable = await createDisposableDb();
  ({ db, disconnect } = createTestClient(disposable.url));
  const user = await db.user.create({ data: { name: "Librarian", email: "library@example.test", password: "test", role: "ADMIN", status: "ACTIVE" } });
  actor = { id: user.id, role: "ADMIN", credentialVersion: 0 };
});
after(async () => { await disconnect?.(); await disposable?.cleanup(); });

test("time in, cooldown, intentional time out, repeated visits and durable replay", async () => {
  const p = await person("00000000001");
  const requestId = randomUUID();
  const first = await scan(p.id, at("08:00:00"), requestId);
  assert.equal(first.operation, "TIME_IN");
  assert.equal(first.visit.timeIn.toISOString(), at("08:00:00").toISOString());
  assert.equal(first.visit.recordedById, actor.id);
  await assert.rejects(scan(p.id, at("08:00:09")), { code: "SCAN_COOLDOWN" });
  const out = await scan(p.id, at("08:00:10"));
  assert.equal(out.operation, "TIME_OUT");
  assert.equal(out.visit.id, first.visit.id);
  const again = await scan(p.id, at("08:00:20"));
  assert.equal(again.operation, "TIME_IN");
  assert.notEqual(again.visit.id, first.visit.id);
  const replay = await scan(p.id, at("12:00:00"), requestId);
  assert.equal(replay.operation, "TIME_IN");
  assert.equal(replay.visit.id, first.visit.id);
  assert.equal(await db.libraryVisit.count({ where: { studentId: p.id } }), 2);
  await assert.rejects(scan("00000000002", at("12:00:00"), requestId), { code: "REQUEST_REUSED" });
});
test("two devices cannot alternate a simultaneous toggle; other visitors remain scannable", async () => {
  const p = await person("00000000002");
  const other = createTestClient(disposable.url);
  try {
    const results = await Promise.allSettled([scan(p.id, at("09:00:00")), recordLibraryScan(other.db, { studentId: p.id, requestId: randomUUID() }, actor, () => at("09:00:00"))]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    const rejected = results.find(r => r.status === "rejected") as PromiseRejectedResult;
    assert.equal(rejected.reason.code, "SCAN_COOLDOWN");
    assert.equal(await db.libraryVisit.count({ where: { studentId: p.id, timeOut: null } }), 1);
    const p2 = await person("00000000003");
    assert.equal((await scan(p2.id, at("09:00:00"))).operation, "TIME_IN");
  } finally { await other.disconnect(); }
});
test("previous day remains forgotten and never becomes today's time out", async () => {
  const p = await person("00000000004");
  const old = await scan(p.id, new Date("2026-10-11T08:00:00+08:00"));
  const today = await scan(p.id, at("08:00:00"));
  assert.equal(today.operation, "TIME_IN");
  assert.notEqual(old.visit.id, today.visit.id);
  assert.equal((await db.libraryVisit.findUniqueOrThrow({ where: { id: old.visit.id } })).timeOut, null);
});
test("employee onboarding never overwrites a collision, supports explicit classification and snapshots history", async () => {
  const employee = await registerEmployee(db, { id: "EMP00000001", firstName: "Maria", lastName: "Santos" }, actor);
  const visit = await scan(employee.id, at("10:00:00"));
  assert.equal(visit.visit.personType, "EMPLOYEE");
  assert.equal(visit.visit.studentId, employee.id);
  await assert.rejects(registerEmployee(db, { id: employee.id, firstName: "Wrong", lastName: "Name" }, actor), { code: "ID_EXISTS" });
  const existing = await person("00000000005");
  await scan(existing.id, at("10:00:00"));
  await registerEmployee(db, { id: existing.id, assignExisting: true }, actor);
  assert.equal((await db.student.findUniqueOrThrow({ where: { id: existing.id } })).firstName, "Juan");
  assert.equal((await scan(existing.id, at("10:01:00"))).visit.personType, "STUDENT");
  assert.equal((await scan(existing.id, at("10:02:00"))).visit.personType, "EMPLOYEE");
  assert.equal(await db.student.count({ where: { id: employee.id, ...buildEventStudentFilter({ category: "ALL", includedGroups: [] }) } }), 0);
});
test("bulk close is attributed, uses each entry date, preserves completed and after-hours visits, and is repeatable", async () => {
  const p = await person("00000000006");
  const old = await scan(p.id, new Date("2026-09-01T08:00:00+08:00"));
  const late = await scan(p.id, new Date("2026-09-02T17:15:00+08:00"));
  const complete = await scan(p.id, new Date("2026-09-03T08:00:00+08:00"));
  await scan(p.id, new Date("2026-09-03T10:00:00+08:00"));
  const result = await closeForgottenVisits(db, actor, {}, () => at("16:00:00"));
  assert.ok(result.count > 0);
  const corrected = await db.libraryVisit.findUniqueOrThrow({ where: { id: old.visit.id } });
  assert.equal(corrected.timeOut?.toISOString(), "2026-09-01T09:00:00.000Z");
  assert.equal(corrected.administrativelyClosedById, actor.id);
  assert.equal(corrected.administrativelyClosedAt?.toISOString(), at("16:00:00").toISOString());
  assert.equal((await db.libraryVisit.findUniqueOrThrow({ where: { id: late.visit.id } })).timeOut, null);
  assert.equal((await db.libraryVisit.findUniqueOrThrow({ where: { id: complete.visit.id } })).timeOut?.toISOString(), "2026-09-03T02:00:00.000Z");
  assert.equal((await closeForgottenVisits(db, actor, {}, () => at("16:00:00"))).count, 0);
  await assert.rejects(closeForgottenVisits(db, actor, { visitId: late.visit.id, timeOut: new Date("2026-09-02T17:00:00+08:00") }, () => at("16:00:00")), { code: "INVALID_TIME_OUT" });
  assert.equal((await closeForgottenVisits(db, actor, { visitId: late.visit.id, timeOut: new Date("2026-09-02T17:30:00+08:00") }, () => at("16:00:00"))).count, 1);
});
test("history ranges, type snapshots, search, individual sessions and summary use persisted records", async () => {
  const daily = await readLibraryVisits(db, { date: "2026-10-12", period: "daily", type: "ALL", search: "", page: 1, demo: false }, at("16:00:00"));
  assert.ok(daily.total >= 8);
  assert.equal(daily.summary.visitsToday, daily.total);
  assert.ok(daily.summary.currentlyInside > 0);
  const employees = await readLibraryVisits(db, { date: "2026-10-14", period: "weekly", type: "EMPLOYEE", search: "", page: 1, demo: false }, at("17:00:00"));
  assert.ok(employees.visits.length >= 2);
  assert.ok(employees.visits.every(v => v.personType === "EMPLOYEE"));
  assert.equal(employees.summary.currentlyInside, 0);
  const monthly = await readLibraryVisits(db, { date: "2026-09-15", period: "monthly", type: "STUDENT", search: "00000000006", page: 1, demo: false }, at("18:00:00"));
  assert.equal(monthly.total, 3);
  assert.equal(monthly.visits.filter(v => v.status === "Closed by librarian").length, 2);
});
test("normal QR exits racing a bulk correction are never overwritten", async () => {
  const other = createTestClient(disposable.url);
  try {
    for (let i = 0; i < 8; i++) {
      const p = await person(`RACE${String(i).padStart(7, "0")}`);
      const entered = await scan(p.id, at("16:00:00"));
      const results = await Promise.allSettled([
        scan(p.id, at("18:00:00")),
        closeForgottenVisits(other.db, actor, {}, () => at("18:00:00")),
      ]);
      const persisted = await db.libraryVisit.findUniqueOrThrow({ where: { id: entered.visit.id } });
      const scanResult = results[0];
      assert.ok(persisted.timeOut);
      if (persisted.administrativelyClosedAt) {
        assert.equal(persisted.timeOut.toISOString(), at("17:00:00").toISOString());
        if (scanResult.status === "fulfilled") {
          assert.equal(scanResult.value.operation, "TIME_IN");
          assert.notEqual(scanResult.value.visit.id, persisted.id);
        } else assert.equal(scanResult.reason.code, "VISIT_CHANGED");
      } else {
        assert.equal(persisted.timeOut.toISOString(), at("18:00:00").toISOString());
        assert.equal(scanResult.status, "fulfilled");
      }
    }
  } finally { await other.disconnect(); }
});

test("same request across clients and UUID casing replays exactly one operation", async () => {
  const p = await person("REPLAY00001");
  const requestId = randomUUID();
  const other = createTestClient(disposable.url);
  try {
    const results = await Promise.all([
      scan(p.id, at("12:00:00"), requestId),
      recordLibraryScan(other.db, { studentId: p.id, requestId: requestId.toUpperCase() }, actor, () => at("12:00:00")),
    ]);
    assert.ok(results.every(r => r.operation === "TIME_IN"));
    assert.equal(results[0].visit.id, results[1].visit.id);
    assert.equal(results.filter(r => r.replayed).length, 1);
    assert.equal(await db.libraryVisit.count({ where: { studentId: p.id } }), 1);
  } finally { await other.disconnect(); }
});

test("database rejects duplicate opens and impossible dates independently of application locks", async () => {
  const p = await person("00000000007");
  const data = { studentId: p.id, visitDay: "2026-10-12", personType: "STUDENT", timeIn: at("08:00:00") };
  await db.libraryVisit.create({ data });
  await assert.rejects(db.libraryVisit.create({ data }), { code: "P2002" });
  await assert.rejects(db.libraryVisit.create({ data: { ...data, visitDay: "2026-10-13" } }));
  await assert.rejects(db.libraryVisit.updateMany({ where: { studentId: p.id }, data: { timeOut: at("07:00:00") } }));
});
test("library student registration keeps academic fields, rejects collisions and produces a scannable student identity", async () => {
  const organizer = await db.user.create({ data: { name: "Student librarian", email: "student-org@example.test", password: "test", status: "ACTIVE" } });
  const librarian = { id: organizer.id, credentialVersion: 0 };
  for (const [slug, category] of [["section", "SECTION"], ["house", "HOUSE"], ["dept", "DEPARTMENT"], ["program", "PROGRAM"]] as const) {
    await db.group.create({ data: { slug, name: slug, category } });
  }
  const payload = { id: "LIBSTUD0001", firstName: "Library", lastName: "Student", schoolLevel: "COLLEGE", yearLevel: "YEAR_2", section: "section", house: "house", department: "dept", program: "program" } as const;
  const created = await registerLibraryStudent(db, payload, librarian);
  assert.equal(created.yearLevel, "YEAR_2");
  assert.deepEqual(created.groups.map(g => g.slug).sort(), ["dept", "house", "program", "section"]);
  assert.equal((await scan(created.id, at("15:00:00"))).visit.personType, "STUDENT");
  assert.equal(await db.student.count({ where: { id: created.id, ...buildEventStudentFilter({ category: "ALL", includedGroups: [] }) } }), 1);
  for (const id of [created.id, "EMP00000001"]) {
    await assert.rejects(registerLibraryStudent(db, { ...payload, id, firstName: "Overwrite" }, librarian), { code: "ID_EXISTS" });
  }
  assert.equal((await db.student.findUniqueOrThrow({ where: { id: created.id } })).firstName, "Library");
  await assert.rejects(registerLibraryStudent(db, { ...payload, id: "LIBSTUD0002", section: "house" }, librarian), { code: "INVALID_GROUPS" });
  await assert.rejects(registerLibraryStudent(db, { ...payload, id: "LIBSTUD0002", section: "employees" }, librarian));
  await db.user.update({ where: { id: organizer.id }, data: { mustChangePassword: true } });
  await assert.rejects(registerLibraryStudent(db, { ...payload, id: "LIBSTUD0002" }, librarian), { code: "UNAUTHORIZED" });
  assert.equal(await db.student.count({ where: { id: "LIBSTUD0002" } }), 0);
});
test("active organizer librarians can register employees and classify existing identities", async () => {
  const organizer = await db.user.create({ data: { name: "Librarian organizer", email: "org@example.test", password: "test", status: "ACTIVE" } });
  const librarian = { id: organizer.id, credentialVersion: 0 };
  const employee = await registerEmployee(db, { id: "EMP00000002", firstName: "A", lastName: "B" }, librarian);
  assert.ok(employee.groups.some(g => g.slug === "employees"));
  const existing = await person("LIBEXIST001");
  const classified = await registerEmployee(db, { id: existing.id, assignExisting: true }, librarian);
  assert.equal(classified.firstName, existing.firstName);
  assert.ok(classified.groups.some(g => g.slug === "employees"));
  await assert.rejects(registerEmployee(db, { id: existing.id, firstName: "Overwrite", lastName: "Attempt" }, librarian), { code: "ID_EXISTS" });
  await db.user.update({ where: { id: organizer.id }, data: { status: "PENDING" } });
  await assert.rejects(registerEmployee(db, { id: "EMP00000003", firstName: "A", lastName: "B" }, librarian), { code: "UNAUTHORIZED" });
});
test("revoked actors, invalid identifiers and unknown people cannot write", async () => {
  await assert.rejects(scan("missing0000", at("08:00:00")), { code: "PERSON_NOT_FOUND" });
  await assert.rejects(scan("invalid", at("08:00:00")));
  await db.user.update({ where: { id: actor.id }, data: { status: "REJECTED" } });
  await assert.rejects(scan("00000000001", at("18:00:00")), { code: "UNAUTHORIZED" });
  await assert.rejects(closeForgottenVisits(db, actor), { code: "UNAUTHORIZED" });
});
