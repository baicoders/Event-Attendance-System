import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const temp = await mkdtemp(join(tmpdir(), "issue70-operator-api-"));
const databaseUrl = `file:${join(temp, "test.db")}`;
const port = 42000 + Math.floor(Math.random() * 10000);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATABASE_URL: databaseUrl, AUTH_SECRET: "issue70-operator-api-test-secret" };
let server;
let prisma;

async function request(path, { cookie, method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { response, result: await response.json() };
}

async function login(email) {
  const { response, result } = await request("/api/auth/login", {
    method: "POST", body: { email, password: "password-123" },
  });
  assert.equal(response.status, 200, JSON.stringify(result));
  return response.headers.get("set-cookie").split(";")[0];
}

try {
  const push = spawnSync("pnpm", ["exec", "prisma", "db", "push"], { env, encoding: "utf8" });
  assert.equal(push.status, 0, push.stderr || push.stdout);
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
  const owner = await prisma.user.create({ data: {
    name: "Owner", email: "issue70-owner@example.test", password: "password-123", status: "ACTIVE",
  } });
  const operator = await prisma.user.create({ data: {
    name: "Operator", email: "issue70-operator@example.test", password: "password-123", status: "ACTIVE",
  } });
  const admin = await prisma.user.create({ data: {
    name: "Admin", email: "issue70-admin@example.test", password: "password-123", status: "ACTIVE", role: "ADMIN",
  } });
  const otherOperators = await Promise.all(Array.from({ length: 4 }, (_, index) => prisma.user.create({ data: {
    name: `Operator ${index + 2}`, email: `issue70-operator-${index + 2}@example.test`,
    password: "password-123", status: "ACTIVE",
  } })));
  await prisma.student.createMany({ data: Array.from({ length: 2_000 }, (_, index) => ({
    id: String(index + 1).padStart(11, "0"), firstName: "Test", lastName: `Student ${index}`,
    schoolLevel: "COLLEGE", yearLevel: "YEAR_1",
  })) });
  const eventData = {
    category: "ALL", status: "APPROVED", createdById: owner.id,
    start: new Date(Date.now() - 24 * 60 * 60 * 1000),
    end: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
  const event = await prisma.event.create({ data: { title: "HTTP contract", ...eventData } });
  const draft = await prisma.event.create({ data: { title: "Private draft", ...eventData, status: "DRAFT" } });

  server = spawn("pnpm", ["start", "--port", String(port)], { env, detached: true, stdio: "ignore" });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`${base}/api/auth/session`);
      if (response.status < 500) { ready = true; break; }
    } catch { /* Starting */ }
    await delay(250);
  }
  assert.ok(ready, "local Next server did not start");

  const ownerCookie = await login(owner.email);
  const operatorCookie = await login(operator.email);
  const adminCookie = await login(admin.email);
  const operatorCookies = [operatorCookie, ...await Promise.all(otherOperators.map((user) => login(user.email)))];
  assert.equal((await request(`/api/students?eventId=${draft.id}`)).response.status, 401);
  assert.equal((await request(`/api/students?eventId=${draft.id}`, { cookie: ownerCookie })).response.status, 200);
  assert.equal((await request(`/api/students?eventId=${draft.id}&studentId=00000000001`, { cookie: ownerCookie })).response.status, 200);
  assert.equal((await request(`/api/students?eventId=${draft.id}`, { cookie: adminCookie })).response.status, 200);
  assert.equal((await request(`/api/students?eventId=${draft.id}`, { cookie: operatorCookie })).response.status, 403);
  assert.equal((await request(`/api/students?eventId=${draft.id}&studentId=00000000001`, { cookie: operatorCookie })).response.status, 403);
  assert.equal((await request(`/api/students?eventId=${event.id}`, { cookie: operatorCookie })).response.status, 200);
  assert.equal((await request(`/api/students?eventId=${event.id}&studentId=00000000001`, { cookie: operatorCookie })).response.status, 200);
  assert.equal((await request(`/api/students?eventId=`, { cookie: operatorCookie })).response.status, 400);
  assert.equal((await request(`/api/students?eventId=&studentId=00000000001`, { cookie: operatorCookie })).response.status, 400);
  assert.equal((await request(`/api/students`, { cookie: operatorCookie })).response.status, 200);
  await prisma.user.update({ where: { id: operator.id }, data: { status: "PENDING" } });
  assert.equal((await request(`/api/students?eventId=${event.id}`, { cookie: operatorCookie })).response.status, 403);
  await prisma.user.update({ where: { id: operator.id }, data: { status: "ACTIVE" } });
  const input = { eventId: event.id, studentId: "00000000001", method: "SCANNED", expectedMode: "TIME_IN" };
  assert.equal((await request("/api/records", { method: "POST", body: input })).response.status, 401);
  const created = await request("/api/records", { cookie: operatorCookie, method: "POST", body: input });
  assert.equal(created.response.status, 201, JSON.stringify(created.result));
  assert.equal(created.result.data.operation, "TIME_IN");
  assert.equal(created.result.data.changed, true);
  assert.ok(created.result.data.timein);
  assert.equal(created.result.data.recordedById, operator.id);
  const repeated = await request("/api/records", { cookie: operatorCookie, method: "POST", body: input });
  assert.equal(repeated.response.status, 200);
  assert.equal(repeated.result.data.changed, false);
  assert.equal(repeated.result.data.timein, created.result.data.timein);
  assert.equal(repeated.result.data.method, "SCANNED");

  assert.equal((await request(`/api/events/${event.id}/timeout`, {
    cookie: operatorCookie, method: "POST", body: { isTimeout: true },
  })).response.status, 403);
  const modeChange = await request(`/api/events/${event.id}/timeout`, {
    cookie: ownerCookie, method: "POST", body: { isTimeout: true },
  });
  assert.equal(modeChange.response.status, 200, JSON.stringify(modeChange.result));
  const stale = await request("/api/records", { cookie: operatorCookie, method: "POST", body: input });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.result.code, "EVENT_MODE_CHANGED");
  assert.equal((await prisma.record.findUniqueOrThrow({ where: { eventId_studentId: {
    eventId: event.id, studentId: input.studentId,
  } } })).timeout, null);

  const noTimeIn = await request("/api/records", { cookie: operatorCookie, method: "POST", body: {
    ...input, studentId: "00000000002", expectedMode: "TIME_OUT",
  } });
  assert.equal(noTimeIn.response.status, 409);
  assert.equal(noTimeIn.result.code, "NO_TIME_IN");
  const timedOut = await request("/api/records", { cookie: operatorCookie, method: "POST", body: {
    ...input, method: "MANUAL", expectedMode: "TIME_OUT",
  } });
  assert.equal(timedOut.response.status, 200, JSON.stringify(timedOut.result));
  assert.equal(timedOut.result.data.operation, "TIME_OUT");
  assert.equal(timedOut.result.data.changed, true);
  assert.equal(timedOut.result.data.timein, created.result.data.timein);
  assert.equal(timedOut.result.data.method, "SCANNED");
  assert.equal(timedOut.result.data.lastModifiedById, operator.id);

  const raceEvent = await prisma.event.create({ data: { title: "HTTP race", ...eventData } });
  const raceStudent = "00000000003";
  const [scan] = await Promise.all([
    request("/api/records", { cookie: operatorCookie, method: "POST", body: {
      eventId: raceEvent.id, studentId: raceStudent, method: "SCANNED", expectedMode: "TIME_IN",
    } }),
    request(`/api/events/${raceEvent.id}/timeout`, { cookie: ownerCookie, method: "POST", body: { isTimeout: true } }),
  ]);
  const raceRecord = await prisma.record.findUnique({ where: { eventId_studentId: {
    eventId: raceEvent.id, studentId: raceStudent,
  } } });
  assert.equal(raceRecord?.timeout ?? null, null);
  if (scan.response.ok) {
    assert.equal(scan.result.data.operation, "TIME_IN");
    assert.ok(raceRecord?.timein);
  } else {
    assert.equal(scan.response.status, 409, JSON.stringify(scan.result));
    assert.equal(scan.result.code, "EVENT_MODE_CHANGED");
    assert.equal(raceRecord, null);
  }

  const throughputEvent = await prisma.event.create({ data: { title: "HTTP load", ...eventData } });
  const started = performance.now();
  const throughput = await Promise.all(Array.from({ length: 5 }, (_, index) => request("/api/records", {
    cookie: operatorCookies[index], method: "POST", body: {
      eventId: throughputEvent.id, studentId: String(index + 4).padStart(11, "0"),
      method: "SCANNED", expectedMode: "TIME_IN",
    },
  })));
  const wallMs = Math.round(performance.now() - started);
  assert.ok(throughput.every(({ response }) => response.status === 201), JSON.stringify(throughput.map(({ response, result }) => [response.status, result])));
  assert.equal(await prisma.record.count({ where: { eventId: throughputEvent.id } }), 5);
  console.log(`Operator HTTP checks passed: seven sessions, event-roster permissions, mode conflict, actor/method/timestamp, no prior time-in, mode race; five writes in ${wallMs} ms.`);
  if (process.env.MANUAL_BROWSER_TEST === "1") {
    const browser = spawnSync("python3", ["scripts/test-manual-browser.py", base, throughputEvent.id, owner.email],
      { env, encoding: "utf8", timeout: 120_000 });
    assert.equal(browser.status, 0, browser.stderr || browser.stdout);
    console.log(browser.stdout.trim());
  }
} finally {
  if (server?.pid) {
    try { process.kill(-server.pid, "SIGTERM"); } catch { /* Already stopped */ }
  }
  await prisma?.$disconnect();
  await rm(temp, { recursive: true, force: true });
}
