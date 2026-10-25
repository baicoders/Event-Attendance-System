/** Production-build browser tests against disposable PostgreSQL and isolated Caddy. */
import "dotenv/config";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, X509Certificate, timingSafeEqual } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import QRCode from "react-qr-code";
import { createDisposableDatabase } from "./pg-test-db.mjs";
import { cleanupAll } from "./attendance-e2e/cleanup.mjs";
import { recordInfrastructureFailure } from "./attendance-e2e/report.mjs";
import { assertLocalMaintenanceUrl, buildTestEnv } from "./attendance-e2e/safety.mjs";

const runId = new Date().toISOString().replace(/[:.]/g, "-") + "-" + process.pid;
const artifacts = resolve("test-results", "attendance-e2e", runId);
mkdirSync(artifacts, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "attendance-e2e-"));
const children = new Set();
const logs = [];
let disposable, pool, db, evidence;
const reportPath = join(artifacts, "report.json");
const json = (value) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? String(item) : item, 2);
const python = process.env.E2E_PYTHON || "python3";
const chrome = process.env.E2E_CHROME || "/usr/bin/google-chrome";
const caddy = process.env.E2E_CADDY || "caddy";

async function freePort() {
  const listener = netServer();
  await new Promise((ok, fail) => { listener.once("error", fail); listener.listen(0, "127.0.0.1", ok); });
  const port = listener.address().port;
  await new Promise((ok) => listener.close(ok));
  return port;
}
function start(command, args, env, label) {
  const log = createWriteStream(join(artifacts, `${label}.log`));
  logs.push(log);
  const child = spawn(command, args, { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on("error", (error) => log.write(`${error.message}\n`));
  child.on("exit", (code, signal) => log.write(`Process exited: code=${code}, signal=${signal}\n`));
  return child;
}
async function run(command, args, env, label, timeout = 420_000) {
  const child = start(command, args, env, label);
  const status = await new Promise((ok, fail) => {
    const timer = setTimeout(() => { stop(child).then(() => fail(new Error(`${label} timed out; see ${label}.log`))); }, timeout);
    child.once("error", (error) => { clearTimeout(timer); fail(error); });
    child.once("exit", (code, signal) => { clearTimeout(timer); ok({ code, signal }); });
  });
  if (status.code !== 0) throw new Error(`${label} exited ${status.code ?? status.signal}; see ${label}.log`);
}
async function stop(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { return; }
  await Promise.race([new Promise((ok) => child.once("exit", ok)), delay(1500)]);
  // A parent can exit before its descendants; kill the entire private process group.
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* group already gone */ }
}
async function ready(check, child, label) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} stopped before readiness; see its log.`);
    try { if (await check()) return; } catch { /* wait for startup */ }
    await delay(250);
  }
  throw new Error(`${label} did not become ready.`);
}
function findFile(dir, predicate) {
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { const found = findFile(path, predicate); if (found) return found; }
    else if (predicate(path)) return path;
  }
  return null;
}
function verifyHttps(base, ca) {
  return new Promise((ok, fail) => {
    const req = httpsRequest(`${base}/api/auth/session`, { ca, rejectUnauthorized: true }, (response) => {
      response.resume();
      ok(response.statusCode < 500 && response.socket.authorized);
    });
    req.on("error", fail);
    req.setTimeout(5000, () => req.destroy(new Error("TLS probe timed out")));
    req.end();
  });
}
function infrastructureFailure(message) {
  let report = { completed: false, results: [], artifacts };
  if (existsSync(reportPath)) {
    try { report = JSON.parse(readFileSync(reportPath, "utf8")); } catch { /* incomplete report */ }
  }
  writeFileSync(reportPath, json(recordInfrastructureFailure(report, message)));
}
let cleanupPromise;
function cleanup() {
  return cleanupPromise ??= cleanupResources();
}
async function cleanupResources() {
  await cleanupAll([
    ...[...children].reverse().map((child) => () => stop(child)),
    async () => { if (evidence) await new Promise((ok) => evidence.close(ok)); },
    async () => { await db?.$disconnect(); },
    async () => { await pool?.end(); },
    async () => { await disposable?.cleanup(); },
    async () => { for (const log of logs) log.end(); },
    async () => { rmSync(scratch, { recursive: true, force: true }); },
  ]);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    cleanup().catch((error) => infrastructureFailure(`Cleanup failed: ${error.message}`))
      .finally(() => { infrastructureFailure(`Interrupted by ${signal}`); process.exit(130); });
  });
}

try {
  assertLocalMaintenanceUrl(process.env.TEST_DATABASE_URL);
  for (const [command, args] of [[python, ["-c", "import playwright.sync_api"]], [chrome, ["--version"]], [caddy, ["version"]], ["ffmpeg", ["-version"]]]) {
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 60_000 });
    if (result.error?.code === "ETIMEDOUT") throw new Error(`Prerequisite probe timed out for ${command}; the local machine may be busy.`);
    assert.equal(result.status, 0, `Missing test prerequisite: ${command}. See docs/testing/attendance-e2e.md`);
  }
  console.log(`Attendance E2E artifacts: ${artifacts}`);
  disposable = await createDisposableDatabase("test_attendance_e2e");
  const env = buildTestEnv(process.env, disposable.url, randomBytes(32).toString("hex"));
  pool = new Pool({ connectionString: disposable.url, max: 5 });
  db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const password = "synthetic-attendance-password";
  const admin = await db.user.create({ data: { name: "E2E Admin", email: "admin@attendance.example.test", password, role: "ADMIN", status: "ACTIVE" } });
  const operators = [];
  for (let index = 0; index < 5; index++) operators.push(await db.user.create({ data: {
    name: `E2E Operator ${index + 1}`, email: `operator${index + 1}@attendance.example.test`, password, status: "ACTIVE",
  } }));
  const students = Array.from({ length: 2000 }, (_, index) => ({
    id: index === 2 ? "00000000003" : "c" + String(index + 1).padStart(24, "0"),
    usn: index === 2 ? null : String(26000000001 + index),
    lrn: index === 2 ? null : String(126000000001 + index),
    firstName: "E2E", lastName: `Student${String(index + 1).padStart(4, "0")}`,
    schoolLevel: index === 1999 ? "SHS" : "COLLEGE", yearLevel: index === 1999 ? "GRADE_11" : "YEAR_1",
  }));
  await db.student.createMany({ data: students });
  const section = await db.group.create({ data: { name: "E2E Section", slug: "e2e-section", category: "SECTION", students: { connect: students.slice(0, 20).map(({ id }) => ({ id })) } } });
  const eventDefaults = { category: "ALL", status: "APPROVED", createdById: operators[0].id,
    start: new Date(Date.now() - 3600_000), end: new Date(Date.now() + 3600_000) };
  const events = {};
  for (const name of ["manual", "qr", "concurrency", "network", "mode", "corrections", "reports", "eligibility", "live", "conflict", "permission"]) {
    events[name] = await db.event.create({ data: { ...eventDefaults, title: `E2E ${name}`, ...(name === "eligibility" ? { category: "COLLEGE" } : {}) } });
  }
  const evidenceToken = randomBytes(32).toString("hex");
  evidence = createServer(async (req, res) => {
    const provided = Buffer.from(req.headers.authorization || "");
    const expected = Buffer.from(`Bearer ${evidenceToken}`);
    if (req.method !== "GET" || provided.length !== expected.length || !timingSafeEqual(provided, expected)) { res.writeHead(403).end(); return; }
    try {
      const params = new URL(req.url, "http://127.0.0.1").searchParams;
      const eventId = params.get("eventId");
      const title = params.get("title");
      const event = await db.event.findFirst({ where: eventId ? { id: eventId } : { title } });
      const where = event ? { eventId: event.id, ...(params.get("studentId") ? { studentId: params.get("studentId") } : {}) } : { eventId: "missing" };
      const records = await db.record.findMany({ where, orderBy: { studentId: "asc" } });
      const changes = await db.attendanceChange.findMany({ where, orderBy: { id: "asc" } });
      res.writeHead(200, { "content-type": "application/json" }).end(json({ event, records, changes, eligible: event?.category === "COLLEGE" ? 1999 : 2000 }));
    } catch { res.writeHead(500).end("Evidence read failed"); }
  });
  await new Promise((ok) => evidence.listen(0, "127.0.0.1", ok));
  // Build under fixture overrides, so .env.local cannot select the real database.
  if (process.env.E2E_SKIP_BUILD !== "1") {
    console.log("Building production app with disposable database overrides…");
    await run("pnpm", ["build"], env, "build");
  } else assert.ok(existsSync(".next/BUILD_ID"), "E2E_SKIP_BUILD requires an existing production build.");
  const appPort = await freePort();
  const tlsPort = await freePort();
  const server = start("pnpm", ["exec", "next", "start", "--hostname", "127.0.0.1", "--port", String(appPort)], env, "app");
  await ready(async () => (await fetch(`http://127.0.0.1:${appPort}/api/auth/session`, { signal: AbortSignal.timeout(5000) })).status < 500, server, "app");
  const storage = join(scratch, "caddy-storage");
  const config = join(scratch, "Caddyfile");
  writeFileSync(config, `{\n admin off\n skip_install_trust\n auto_https disable_redirects\n storage file_system ${storage}\n}\nhttps://127.0.0.1:${tlsPort} {\n bind 127.0.0.1\n tls internal\n reverse_proxy 127.0.0.1:${appPort}\n}\n`);
  const proxy = start(caddy, ["run", "--config", config, "--adapter", "caddyfile"], { ...env, XDG_CONFIG_HOME: join(scratch, "config"), XDG_DATA_HOME: join(scratch, "data") }, "caddy");
  await ready(() => !!findFile(join(storage, "certificates"), (path) => path.endsWith(".crt")), proxy, "caddy");
  const certificate = new X509Certificate(readFileSync(findFile(join(storage, "certificates"), (path) => path.endsWith(".crt"))));
  const pin = createHash("sha256").update(certificate.publicKey.export({ type: "spki", format: "der" })).digest("base64");
  const base = `https://127.0.0.1:${tlsPort}`;
  const fixtureCa = readFileSync(join(storage, "pki/authorities/local/root.crt"));
  await ready(() => verifyHttps(base, fixtureCa), proxy, "caddy HTTPS");
  const qrComponent = QRCode.default || QRCode;
  const qr = Object.fromEntries(["usn", "lrn", "legacy", "invalid", "excluded"].map((key) => {
    const code = key === "usn" ? students[0].usn : key === "lrn" ? students[1].lrn : key === "legacy" ? students[2].id : key === "excluded" ? students[1999].usn : "99999999999";
    return [key, { code, svg: renderToStaticMarkup(React.createElement(qrComponent, { value: code, size: 320 })) }];
  }));
  const fixture = { base, pin, chrome, password, admin: { id: admin.id, email: admin.email }, operators: operators.map(({ id, email }) => ({ id, email })),
    students: [...students.slice(0, 30), students[1999]], events, section, qr, scratch, artifacts,
    evidenceUrl: `http://127.0.0.1:${evidence.address().port}`, evidenceToken };
  const fixturePath = join(scratch, "fixture.json");
  writeFileSync(fixturePath, json(fixture), { mode: 0o600 });
  console.log("Running desktop and mobile browser scenarios through Caddy HTTPS…");
  await run(python, ["scripts/test-attendance-e2e.py", fixturePath], { ...env, NODE_EXTRA_CA_CERTS: join(storage, "pki/authorities/local/root.crt") }, "browser", 1800_000);
} catch (error) {
  let completedFailure = false;
  if (existsSync(reportPath)) {
    try { const report = JSON.parse(readFileSync(reportPath, "utf8")); completedFailure = report.completed === true && report.status === "failed"; } catch { /* incomplete report */ }
  }
  if (!completedFailure) infrastructureFailure(error.message);
  console.error(error.message);
  process.exitCode = 1;
} finally {
  try { await cleanup(); } catch (error) { infrastructureFailure(`Cleanup failed: ${error.message}`); console.error(`Cleanup failed: ${error.message}`); process.exitCode = 1; }
  console.log(`Results: ${reportPath}`);
}
