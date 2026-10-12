import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { createDisposableDatabase } from "./pg-test-db.mjs";

const disposable = await createDisposableDatabase();
const pool = new Pool({ connectionString: disposable.url });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });
const port = 42000 + Math.floor(Math.random() * 10000);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATABASE_URL: disposable.url, DIRECT_URL: disposable.url, AUTH_SECRET: "library-api-disposable-test-secret" };
let server;
async function request(path, { cookie, method = "GET", body } = {}) {
  const response = await fetch(base + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const result = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text();
  return { response, result };
}
async function login(email) {
  const r = await request("/api/auth/login", { method: "POST", body: { email, password: "password-123" } });
  assert.equal(r.response.status, 200, JSON.stringify(r.result));
  return r.response.headers.get("set-cookie").split(";")[0];
}
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
try {
  const organizer = await db.user.create({ data: { name: "Librarian", email: "library-org@example.test", password: "password-123", status: "ACTIVE" } });
  const admin = await db.user.create({ data: { name: "Admin", email: "library-admin@example.test", password: "password-123", status: "ACTIVE", role: "ADMIN" } });
  const pending = await db.user.create({ data: { name: "Pending", email: "library-pending@example.test", password: "password-123", status: "ACTIVE" } });
  const student = await db.student.create({ data: { id: "00000000001", firstName: "Juan", lastName: "Cruz", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
  await db.student.create({ data: { id: "00000000002", firstName: "Anna", lastName: "Reyes", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
  const event = await db.event.create({ data: { title: "Event regression", category: "ALL", status: "APPROVED", createdById: organizer.id, start: new Date(), end: new Date(Date.now() + 3600000) } });
  server = spawn("pnpm", ["start", "--port", String(port)], { env, detached: true, stdio: "ignore" });
  let ready = false;
  for (let i = 0; i < 100; i++) { try { const r = await fetch(base + "/api/auth/session"); if (r.status < 500) { ready = true; break; } } catch {} await delay(250); }
  assert.ok(ready, "Next production server did not start");
  const orgCookie = await login(organizer.email), adminCookie = await login(admin.email), pendingCookie = await login(pending.email);
  await db.user.update({ where: { id: pending.id }, data: { status: "PENDING" } });
  for (const path of ["/api/library/visits", "/api/library/people?search=Juan", "/api/library/visits?format=csv"]) {
    assert.equal((await request(path)).response.status, 401);
    assert.equal((await request(path, { cookie: pendingCookie })).response.status, 403);
  }
  for (const path of ["/api/library/scan", "/api/library/close-forgotten", "/api/library/people"]) {
    assert.equal((await request(path, { method: "POST", body: {} })).response.status, 401);
    assert.equal((await request(path, { cookie: pendingCookie, method: "POST", body: {} })).response.status, 403);
  }
  assert.equal((await request("/api/library/visits?date=2026-02-30", { cookie: orgCookie })).response.status, 400);
  assert.equal((await request("/api/library/scan", { cookie: orgCookie, method: "POST", body: { studentId: "bad", requestId: randomUUID() } })).response.status, 400);
  assert.equal((await request("/api/library/scan", { cookie: orgCookie, method: "POST", body: { studentId: "00000000999", requestId: randomUUID() } })).response.status, 404);
  const scanBody = { studentId: student.id, requestId: randomUUID() };
  const first = await request("/api/library/scan", { cookie: orgCookie, method: "POST", body: scanBody });
  assert.equal(first.result.data.operation, "TIME_IN", JSON.stringify(first.result));
  const replay = await request("/api/library/scan", { cookie: adminCookie, method: "POST", body: scanBody });
  assert.equal(replay.result.data.replayed, true);
  const duplicate = await request("/api/library/scan", { cookie: adminCookie, method: "POST", body: { ...scanBody, requestId: randomUUID() } });
  assert.equal(duplicate.response.status, 409); assert.equal(duplicate.result.code, "SCAN_COOLDOWN");
  // Age the fixture in the disposable DB, then exercise the real HTTP toggle.
  await db.libraryVisit.update({ where: { id: first.result.data.visit.id }, data: { timeIn: new Date(Date.now() - 11000), visitDay: day } });
  const out = await request("/api/library/scan", { cookie: orgCookie, method: "POST", body: { ...scanBody, requestId: randomUUID() } });
  assert.equal(out.result.data.operation, "TIME_OUT");
  const employeeBody = { id: "EMP00000001", firstName: "Maria", lastName: "Santos" };
  assert.equal((await request("/api/library/people", { cookie: adminCookie, method: "POST", body: employeeBody })).response.status, 200);
  assert.equal((await request("/api/library/people", { cookie: adminCookie, method: "POST", body: { ...employeeBody, id: student.id } })).response.status, 409);
  const academicGroups = await Promise.all([ ["sec", "SECTION"], ["house", "HOUSE"], ["dept", "DEPARTMENT"], ["program", "PROGRAM"] ].map(([slug, category]) => db.group.create({ data: { name: slug, slug, category } })));
  const studentBody = { personType: "STUDENT", id: "LIBSTUD0001", firstName: "Library", lastName: "Student", schoolLevel: "COLLEGE", yearLevel: "YEAR_2", section: "sec", house: "house", department: "dept", program: "program" };
  const newStudent = await request("/api/library/people", { cookie: adminCookie, method: "POST", body: studentBody });
  assert.equal(newStudent.response.status, 200, JSON.stringify(newStudent.result));
  assert.equal(newStudent.result.data.yearLevel, "YEAR_2");
  assert.deepEqual(newStudent.result.data.groups.map(g => g.slug).sort(), ["dept", "house", "program", "sec"]);
  assert.equal((await request("/api/library/people", { cookie: orgCookie, method: "POST", body: { ...employeeBody, id: "EMPORG00001" } })).response.status, 200);
  for (const id of [studentBody.id, student.id, employeeBody.id]) {
    assert.equal((await request("/api/library/people", { cookie: orgCookie, method: "POST", body: { ...studentBody, id, firstName: "Overwrite" } })).response.status, 409);
  }
  assert.equal((await db.student.findUniqueOrThrow({ where: { id: student.id } })).firstName, "Juan");
  assert.equal((await db.student.findUniqueOrThrow({ where: { id: employeeBody.id } })).firstName, "Maria");
  for (const invalid of [{ department: "" }, { section: "employees" }, { section: "house" }, { program: "unknown" }, { personType: "UNKNOWN" }]) {
    assert.equal((await request("/api/library/people", { cookie: orgCookie, method: "POST", body: { ...studentBody, id: "LIBSTUD0002", ...invalid } })).response.status, 400);
  }
  assert.equal((await request("/api/library/people", { method: "POST", body: studentBody })).response.status, 401);
  assert.equal((await request("/api/library/people", { cookie: pendingCookie, method: "POST", body: studentBody })).response.status, 403);
  const competingCreates = await Promise.all([orgCookie, adminCookie].map(cookie => request("/api/library/people", { cookie, method: "POST", body: { ...studentBody, id: "LIBSTUD0003" } })));
  assert.deepEqual(competingCreates.map(r => r.response.status).sort(), [200, 409]);
  assert.equal(await db.student.count({ where: { id: "LIBSTUD0003" } }), 1);
  const academic = { id: employeeBody.id, firstName: "Wrong", lastName: "Overwrite", schoolLevel: "COLLEGE", yearLevel: "YEAR_1", section: "sec", house: "house", department: "dept", program: "program" };
  assert.equal((await request("/api/students", { cookie: orgCookie, method: "POST", body: academic })).response.status, 409);
  assert.equal((await db.student.findUniqueOrThrow({ where: { id: employeeBody.id } })).firstName, "Maria");
  assert.equal((await request("/api/students", { cookie: orgCookie, method: "POST", body: { ...academic, id: "00000000998", section: "employees" } })).response.status, 400);
  const reserved = await db.group.findUniqueOrThrow({ where: { slug: "employees" } });
  assert.equal((await request(`/api/groups/${reserved.id}`, { cookie: adminCookie, method: "DELETE" })).response.status, 409);
  assert.equal((await request(`/api/groups/${academicGroups[0].id}`, { cookie: adminCookie, method: "DELETE", body: { reassignToGroupId: reserved.id } })).response.status, 409);
  const employeeScan = await request("/api/library/scan", { cookie: orgCookie, method: "POST", body: { studentId: employeeBody.id, requestId: randomUUID() } });
  assert.equal(employeeScan.result.data.visit.personType, "EMPLOYEE");
  assert.equal((await request("/api/library/people?search=Juan%20Cruz", { cookie: orgCookie })).result.data.length, 1);
  const eventScan = await request("/api/records", { cookie: orgCookie, method: "POST", body: { eventId: event.id, studentId: student.id, method: "SCANNED", expectedMode: "TIME_IN" } });
  assert.equal(eventScan.response.status, 201, JSON.stringify(eventScan.result));
  const employeeEventScan = await request("/api/records", { cookie: orgCookie, method: "POST", body: { eventId: event.id, studentId: employeeBody.id, method: "SCANNED", expectedMode: "TIME_IN" } });
  assert.equal(employeeEventScan.response.status, 404);
  const old = await db.libraryVisit.create({ data: { studentId: student.id, personType: "STUDENT", visitDay: "2026-08-01", timeIn: new Date("2026-08-01T08:00:00+08:00") } });
  const late = await db.libraryVisit.create({ data: { studentId: student.id, personType: "STUDENT", visitDay: "2026-08-02", timeIn: new Date("2026-08-02T17:15:00+08:00") } });
  await db.libraryVisit.create({ data: { studentId: student.id, personType: "STUDENT", visitDay: "2026-07-01", timeIn: new Date("2026-07-01T08:00:00+08:00"), isDemo: true } });
  const history = await request(`/api/library/visits?date=${day}`, { cookie: orgCookie });
  assert.equal(history.result.data.summary.visitsToday, 2);
  const closed = await request("/api/library/close-forgotten", { cookie: orgCookie, method: "POST", body: {} });
  assert.ok(closed.result.data.count >= 1);
  const correction = await db.libraryVisit.findUniqueOrThrow({ where: { id: old.id } });
  assert.equal(correction.timeOut.toISOString(), "2026-08-01T09:00:00.000Z");
  assert.equal(correction.administrativelyClosedById, organizer.id);
  assert.equal((await db.libraryVisit.findUniqueOrThrow({ where: { id: late.id } })).timeOut, null);
  assert.equal((await request("/api/library/close-forgotten", { cookie: adminCookie, method: "POST", body: {} })).result.data.count, 0);
  assert.equal((await request("/api/library/close-forgotten", { cookie: orgCookie, method: "POST", body: { visitId: late.id, timeOut: "2026-08-02T17:00:00+08:00" } })).response.status, 400);
  assert.equal((await request("/api/library/close-forgotten", { cookie: adminCookie, method: "POST", body: { visitId: late.id, timeOut: "2026-08-02T18:00:00+08:00" } })).result.data.count, 1);
  for (const period of ["daily", "weekly", "monthly"]) {
    const r = await request(`/api/library/visits?date=${day}&period=${period}&type=EMPLOYEE`, { cookie: orgCookie });
    assert.equal(r.result.data.total, 1); assert.ok(r.result.data.visits.every(v => v.personType === "EMPLOYEE"));
  }
  const csv = await request("/api/library/visits?date=2026-08-15&period=monthly&format=csv", { cookie: orgCookie });
  assert.equal(csv.response.status, 200); assert.ok(csv.result.includes("Closed by librarian")); assert.ok(csv.result.includes("2026-08-01 17:00:00")); assert.ok(!csv.result.includes("SIMULATED"));
  const demoCsv = await request("/api/library/visits?date=2026-07-01&demo=true&format=csv", { cookie: orgCookie }); assert.ok(demoCsv.result.includes("SIMULATED"));
  // Optional tooling itself must be non-destructive and idempotent.
  const runDemo = () => spawnSync("pnpm", ["library:demo", "--confirm-demo"], { env: { ...env, NODE_ENV: "development" }, encoding: "utf8" });
  const demoResult = runDemo(); assert.equal(demoResult.status, 0, demoResult.stderr + demoResult.stdout);
  assert.ok(demoResult.stdout.includes("authenticated /api/library/visits?demo=true"));
  assert.ok(!demoResult.stdout.includes("View simulated demonstration data only"));
  const demoCount = await db.libraryVisit.count({ where: { isDemo: true } });
  assert.ok(demoCount >= 20); assert.equal(runDemo().status, 0); assert.equal(await db.libraryVisit.count({ where: { isDemo: true } }), demoCount);
  assert.equal(await db.record.count(), 1);
  if (process.env.LIBRARY_BROWSER_TEST === "1") {
    await db.student.create({ data: { id: "00000000003", firstName: "Lost", lastName: "Response", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
    await db.libraryVisit.createMany({ data: [
      { studentId: "00000000002", personType: "STUDENT", visitDay: "2026-08-03", timeIn: new Date("2026-08-03T08:00:00+08:00") },
      { studentId: "00000000002", personType: "STUDENT", visitDay: "2026-08-04", timeIn: new Date("2026-08-04T17:15:00+08:00") },
    ] });
    const browser = spawnSync("python3", ["scripts/test-library-browser.py", base, organizer.email], { env, encoding: "utf8" });
    assert.equal(browser.status, 0, browser.stderr + browser.stdout); console.log(browser.stdout.trim());
  }
  await db.user.update({ where: { id: organizer.id }, data: { status: "REJECTED" } });
  assert.equal((await request("/api/library/visits", { cookie: orgCookie })).response.status, 403);
  console.log("Library HTTP integration passed: auth, scan replay/cooldown, employee onboarding, event exclusion/regression, history, CSV, corrections and demo isolation/idempotency.");
} finally {
  if (server?.pid) { try { process.kill(-server.pid, "SIGTERM"); } catch {} }
  await db.$disconnect(); await pool.end(); await disposable.cleanup();
}
