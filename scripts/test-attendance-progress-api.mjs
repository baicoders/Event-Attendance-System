import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const temp = await mkdtemp(join(tmpdir(), "issue72-progress-api-"));
const databaseUrl = `file:${join(temp, "test.db")}`;
const port = 42000 + Math.floor(Math.random() * 10000);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATABASE_URL: databaseUrl, AUTH_SECRET: "issue72-progress-test-secret" };
assert.ok(!(process.env.PROGRESS_BROWSER_TEST === "1" && process.env.PROGRESS_BENCHMARK === "1"), "Run browser and benchmark fixtures separately.");
let server;
let db;

async function request(path, cookie) {
  const response = await fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });
  return { status: response.status, body: await response.json() };
}

async function login(email) {
  const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "password-123" }) });
  assert.equal(response.status, 200, await response.text());
  return response.headers.get("set-cookie").split(";")[0];
}

try {
  const push = spawnSync("pnpm", ["exec", "prisma", "db", "push"], { env, encoding: "utf8" });
  assert.equal(push.status, 0, push.stderr || push.stdout);
  db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
  const owner = await db.user.create({ data: { name: "Owner", email: "progress-owner@example.test", password: "password-123", status: "ACTIVE" } });
  const viewer = await db.user.create({ data: { name: "Viewer", email: "progress-viewer@example.test", password: "password-123", status: "ACTIVE" } });
  const section = await db.group.create({ data: { name: "Section A", slug: "section-a", category: "SECTION" } });
  const now = new Date();
  const event = await db.event.create({ data: { title: "Progress contract", category: "ALL", status: "APPROVED", createdById: owner.id, start: now, end: new Date(now.getTime() + 3_600_000) } });
  const draft = await db.event.create({ data: { title: "Private draft", category: "ALL", status: "DRAFT", createdById: owner.id, start: now, end: new Date(now.getTime() + 3_600_000) } });
  for (const id of ["S1", "S2", "S3"]) await db.student.create({ data: { id, firstName: id, lastName: "Student", yearLevel: "YEAR_1", schoolLevel: "COLLEGE", groups: id !== "S3" ? { connect: { id: section.id } } : undefined } });
  await db.record.create({ data: { eventId: event.id, studentId: "S1", method: "SCANNED", timein: now, timeout: now } });
  await db.record.create({ data: { eventId: event.id, studentId: "S2", method: "SCANNED", timeout: now } });

  server = spawn("pnpm", [process.env.PROGRESS_DEV_SERVER === "1" ? "dev" : "start", "--port", String(port)], {
    env, detached: true, stdio: process.env.PROGRESS_BENCHMARK === "1" ? "inherit" : "ignore",
  });
  let ready = false;
  for (let i = 0; i < 200; i++) {
    try { const response = await fetch(`${base}/api/auth/session`); if (response.status < 500) { ready = true; break; } } catch { /* starting */ }
    await delay(250);
  }
  assert.ok(ready, "local Next server did not start");
  const ownerCookie = await login(owner.email);
  const viewerCookie = await login(viewer.email);
  const path = `/api/events/${event.id}/progress`;

  assert.equal((await request(path)).status, 401);
  assert.equal((await request(`/api/events/${draft.id}/progress`, viewerCookie)).status, 403);
  assert.equal((await request(`/api/events/${draft.id}/progress`, ownerCookie)).status, 409);
  const progress = await request(`${path}?includeRows=1&bucket=g:${section.id}`, viewerCookie);
  assert.equal(progress.status, 200, JSON.stringify(progress.body));
  assert.deepEqual(progress.body.data.totals, { eligible: 3, checkedIn: 1, notYet: 2, rate: (1 / 3) * 100 });
  assert.deepEqual(progress.body.data.detail.rows.map((row) => row.studentId), ["S2"]);
  assert.equal(progress.body.data.detail.bucketTotals.eligible, 2);
  assert.equal(JSON.stringify(progress.body).includes("password"), false);

  for (const query of ["groupBy=ALL", "page=0", "pageSize=20", "groupBy=YEAR&bucket=none", "bucket=g:deleted"]) {
    assert.equal((await request(`${path}?${query}`, viewerCookie)).status, 400, query);
  }
  const stats = await request(`/api/events/${event.id}/stats`, viewerCookie);
  assert.deepEqual(stats.body.data, { eligible: 3, present: 1, absent: 2 });
  const liveRows = await request(`/api/events/${event.id}/records`, viewerCookie);
  assert.deepEqual(liveRows.body.data.map((row) => row.studentId), ["S1"]);
  const reviewRows = await request(`/api/events/${event.id}/records?onlyNeedsReview=true`, viewerCookie);
  assert.deepEqual(reviewRows.body.data.map((row) => row.studentId), ["S2"]);
  assert.equal(reviewRows.body.data[0].status, "absent");
  assert.notEqual(reviewRows.body.data[0].id, "S2");
  const allRows = await request(`/api/events/${event.id}/records?includeAbsent=true`, viewerCookie);
  assert.equal(allRows.body.data.find((row) => row.studentId === "S2").status, "absent");
  const report = await request(`/api/reports/events/${event.id}`, viewerCookie);
  assert.equal(report.body.data.totals.attended, 1);
  assert.equal(report.body.data.totals.absent, 2);
  const from = new Date(now.getTime() - 60_000).toISOString();
  const to = new Date(now.getTime() + 60_000).toISOString();
  const overview = await request(`/api/reports/overview?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, viewerCookie);
  assert.equal(overview.body.data.events.find((item) => item.id === event.id).present, 1);

  await db.user.update({ where: { id: viewer.id }, data: { status: "PENDING" } });
  assert.equal((await request(path, viewerCookie)).status, 403);
  await db.user.update({ where: { id: viewer.id }, data: { status: "ACTIVE" } });
  console.log("Progress HTTP checks passed: authorization, validation, time-in counts, group details, live list, report, and overview.");

  if (process.env.PROGRESS_BROWSER_TEST === "1") {
    const browser = spawnSync("python3", ["scripts/test-attendance-progress-browser.py", base, event.id, owner.email, viewer.email],
      { env, encoding: "utf8", timeout: 180_000 });
    assert.equal(browser.status, 0, browser.stderr || browser.stdout);
    console.log(browser.stdout.trim());
  }

  if (process.env.PROGRESS_BENCHMARK === "1") {
    await db.student.createMany({ data: Array.from({ length: 1997 }, (_, index) => ({
      id: `B${String(index).padStart(7, "0")}`, firstName: "Benchmark", lastName: `Student ${index}`,
      schoolLevel: "COLLEGE", yearLevel: "YEAR_1",
    })) });
    const others = await Promise.all(Array.from({ length: 3 }, (_, index) => db.user.create({ data: {
      name: `Viewer ${index + 2}`, email: `progress-viewer-${index + 2}@example.test`, password: "password-123", status: "ACTIVE",
    } })));
    const extraCookies = [];
    for (const user of others) extraCookies.push(await login(user.email));
    const cookies = [ownerCookie, viewerCookie, ...extraCookies];
    const samples = [];
    const recordingClosed = [];
    const recordingOpen = [];
    const percentile = (values, fraction) => {
      const sorted = [...values].sort((a, b) => a - b);
      return Math.round(sorted[Math.ceil(sorted.length * fraction) - 1]);
    };
    const scan = async (cookie, studentId) => {
      const started = performance.now();
      const response = await fetch(`${base}/api/records`, { method: "POST", headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ eventId: event.id, studentId, method: "SCANNED", expectedMode: "TIME_IN" }) });
      return { status: response.status, ms: performance.now() - started };
    };
    const progressPath = `${path}?groupBy=SECTION&includeRows=1&status=NOT_YET&page=1&pageSize=50`;
    const view = async (cookie) => {
      const started = performance.now();
      const response = await fetch(`${base}${progressPath}`, { headers: { cookie } });
      const body = await response.text();
      return { status: response.status, ms: performance.now() - started, bytes: Buffer.byteLength(body) };
    };
    recordingClosed.push(...await Promise.all(cookies.map((cookie, index) => scan(cookie, `B${String(index).padStart(7, "0")}`))));
    for (let round = 0; round < 4; round++) {
      const views = cookies.map(view);
      const writes = round === 0 ? cookies.map((cookie, index) => scan(cookie, `B${String(index + 5).padStart(7, "0")}`)) : [];
      const [viewResults, writeResults] = await Promise.all([Promise.all(views), Promise.all(writes)]);
      samples.push(...viewResults);
      recordingOpen.push(...writeResults);
    }
    assert.ok(samples.every((sample) => sample.status === 200), JSON.stringify(samples));
    assert.ok([...recordingClosed, ...recordingOpen].every((sample) => sample.status === 200 || sample.status === 201));
    const { readAttendanceProgress } = await import("../globals/utils/attendanceProgressRead.ts");
    const { parseProgressQuery } = await import("../globals/utils/attendanceProgressQuery.ts");
    let queryCount = 0;
    const metricDb = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }), log: [{ emit: "event", level: "query" }] });
    metricDb.$on("query", () => { queryCount += 1; });
    try { await readAttendanceProgress(metricDb, event.id, { id: owner.id }, parseProgressQuery(new URLSearchParams("includeRows=1"))); }
    finally { await metricDb.$disconnect(); }
    console.log("Progress 2,000-student benchmark:", JSON.stringify({
      clients: 5, progressRequests: samples.length, responseBytes: samples[0].bytes,
      progressP50Ms: percentile(samples.map((sample) => sample.ms), 0.5),
      progressP95Ms: percentile(samples.map((sample) => sample.ms), 0.95),
      recordingClosedP50Ms: percentile(recordingClosed.map((sample) => sample.ms), 0.5),
      recordingClosedP95Ms: percentile(recordingClosed.map((sample) => sample.ms), 0.95),
      recordingOpenP50Ms: percentile(recordingOpen.map((sample) => sample.ms), 0.5),
      recordingOpenP95Ms: percentile(recordingOpen.map((sample) => sample.ms), 0.95),
      directReadQueryEvents: queryCount,
    }));
  }

} finally {
  if (server?.pid) { try { process.kill(-server.pid, "SIGTERM"); } catch { /* already stopped */ } }
  await db?.$disconnect();
  await rm(temp, { recursive: true, force: true });
}
