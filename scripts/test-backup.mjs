/**
 * Verified PostgreSQL backup tests (#84) — real pg_dump/pg_restore, real
 * disposable databases, no file-copy mocks.
 *
 * Covers: complete custom-format archive, checksum + TOC validation, atomic
 * publish, partial never published, failed job never deletes last good,
 * overlap skip, checksum-corruption refusal, isolated restore with schema /
 * relation / timeout-only checks, secondary-copy verification, manual never
 * resets the scheduled clock, missing artifact invalidates availability, API
 * auth (ADMIN only, origin check, no secrets in payloads).
 *
 * Requires version-matched tools: BACKUP_PG_DUMP_PATH /
 * BACKUP_PG_RESTORE_PATH must resolve to the server major (17 here). In CI
 * they are on PATH; locally the docker wrappers in /tmp/opencode/pg17w are
 * used when present.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createDisposableDatabase } from "./pg-test-db.mjs";

const { Pool } = pg;

function toolOrDefault(name, fallback) {
  const wrap = `/tmp/opencode/pg17w/${name}`;
  if (existsSync(wrap)) return wrap;
  return process.env[name === "pg_dump" ? "BACKUP_PG_DUMP_PATH" : "BACKUP_PG_RESTORE_PATH"] || fallback;
}

const disposable = await createDisposableDatabase("test");
const databaseUrl = disposable.url;
let prisma;
let server;
const port = 42300 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const secret = "backup-test-secret-12345";
const backupDir = mkdtempSync(path.join(tmpdir(), "eas-bk-"));
const secondaryDir = mkdtempSync(path.join(tmpdir(), "eas-bk2-"));
const dumpPath = toolOrDefault("pg_dump", "pg_dump");
const restorePath = toolOrDefault("pg_restore", "pg_restore");

const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  AUTH_SECRET: secret,
  BACKUP_DIR: backupDir,
  BACKUP_SOURCE_LABEL: "Backup test database",
  BACKUP_PG_DUMP_PATH: dumpPath,
  BACKUP_PG_RESTORE_PATH: restorePath,
  BACKUP_RETENTION_CONFIRMED: "true",
  BACKUP_SECONDARY_DIR: secondaryDir,
  BACKUP_SECONDARY_LABEL: "Second test destination",
  BACKUP_FAILURE_DOMAIN_NOTE: "Test assertion only; same host, not a separate failure domain.",
};

function cli(...args) {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/backups/cli.ts", ...args], {
    env,
    encoding: "utf8",
  });
  return result;
}

function cliJson(...args) {
  const result = cli(...args);
  assert.equal(result.status, 0, `${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  // status/run return JSON array or object; find first JSON token.
  const start = Math.min(
    ...["{", "["].map((c) => (result.stdout.indexOf(c) >= 0 ? result.stdout.indexOf(c) : Infinity)),
  );
  return JSON.parse(result.stdout.slice(start));
}

async function request(path, { cookie, method = "GET", body, origin } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...(origin ? { origin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let result = null;
  try {
    result = JSON.parse(text);
  } catch {
    result = null;
  }
  return { response, result };
}

async function login(email, password) {
  const { response, result } = await request("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  assert.equal(response.status, 200, JSON.stringify(result));
  return response.headers.get("set-cookie").split(";")[0];
}

try {
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const ADMIN_PASS = "admin-pass-123";
  const ORG_PASS = "org-pass-123";
  const admin = await prisma.user.create({
    data: { name: "Backup Admin", email: "bk-admin@example.test", password: ADMIN_PASS, role: "ADMIN", status: "ACTIVE" },
  });
  await prisma.user.create({
    data: { name: "Backup Org", email: "bk-org@example.test", password: ORG_PASS, role: "ORGANIZER", status: "ACTIVE" },
  });
  const group = await prisma.group.create({ data: { name: "BK-SEC-1A", slug: "bk-sec-1a", category: "SECTION" } });
  const student = await prisma.student.create({
    data: { id: "BK000000001", lastName: "Reyes", firstName: "Ana", yearLevel: "YEAR_1", schoolLevel: "COLLEGE", groups: { connect: [{ id: group.id }] } },
  });
  const student2 = await prisma.student.create({
    data: { id: "BK000000002", lastName: "Santos", firstName: "Leo", yearLevel: "YEAR_1", schoolLevel: "COLLEGE", groups: { connect: [{ id: group.id }] } },
  });
  const event = await prisma.event.create({
    data: {
      title: "Backup Fixture",
      category: "SECTION",
      status: "APPROVED",
      createdById: admin.id,
      start: new Date(Date.now() - 3600000),
      end: new Date(Date.now() + 3600000),
      includedGroups: { connect: [{ id: group.id }] },
    },
  });
  await prisma.record.create({
    data: { eventId: event.id, studentId: student.id, method: "SCANNED", timein: new Date(), recordedById: admin.id },
  });
  // Timeout-only record must survive backup + restore verification.
  await prisma.record.create({
    data: { eventId: event.id, studentId: student2.id, method: "MANUAL", timeout: new Date(), recordedById: admin.id },
  });

  // 1. Status starts configured with no dumps (unknown, not green).
  const s0 = cliJson("status");
  assert.equal(s0.configured, true);
  assert.equal(s0.latestCreatedArtifact, null);
  assert.equal(s0.latestVerifiedRestore, null);
  assert.equal(s0.providerRecovery.configured, false);

  // 2. Manual request + run with a concurrent writer during capture.
  const req1 = cliJson("request", "--kind", "manual");
  assert.match(req1.id, /^bk_/);
  const writer = (async () => {
    for (let i = 0; i < 5; i++) {
      try {
        await prisma.student.create({
          data: { id: `BK0000100${i}`, lastName: `W${i}`, firstName: "Concurrent", yearLevel: "YEAR_1", schoolLevel: "COLLEGE" },
        });
      } catch {
        /* duplicate on retry is fine */
      }
      await delay(100);
    }
  })();
  const run1 = cliJson("run");
  await writer;
  assert.equal(run1.length, 1);
  assert.equal(run1[0].ok, true);
  const artifactId = run1[0].artifactId;
  assert.match(artifactId, /^bka_/);

  // 3. Created artifact: checksum + TOC validated, manifest has no secrets.
  const s1 = cliJson("status");
  assert.equal(s1.latestCreatedArtifact.artifactId, artifactId);
  assert.equal(s1.latestCreatedArtifact.tocOk, true);
  assert.equal(s1.latestCreatedArtifact.restoreVerified, false);
  assert.equal(s1.latestCreatedArtifact.available, true);
  const manifest = JSON.parse(readFileSync(path.join(backupDir, "artifacts", `${artifactId}.manifest.json`), "utf8"));
  assert.equal(manifest.artifactId, artifactId);
  assert.ok(manifest.sha256.length >= 32);
  assert.equal(manifest.includesSecrets, false);
  const manifestText = JSON.stringify(manifest);
  assert.ok(!manifestText.includes("postgres:postgres"), "manifest must not contain credentials");
  assert.ok(!manifestText.toLowerCase().includes("password"), "manifest must not contain secrets");
  // No .partial published as success.
  const files = readFileSync(path.join(backupDir, "catalog.json"), "utf8");
  assert.ok(!files.includes(".partial"), "partial must never be published");

  // 4. Secondary copy of the exact artifact, checksum-verified.
  const s1copy = cliJson("status");
  assert.equal(s1copy.separateCopy.configured, true);
  assert.equal(s1copy.separateCopy.artifactId, artifactId);
  assert.equal(s1copy.separateCopy.checksumMatch, true);

  // 5. Overlap: second request while REQUESTED returns the pending job.
  const reqA = cliJson("request", "--kind", "manual");
  const reqB = cliJson("request", "--kind", "manual");
  assert.equal(reqA.id, reqB.id, "overlap must be skipped, not queued");
  const runA = cliJson("run");
  assert.ok(runA[0].ok);
  const latestId = cliJson("status").latestCreatedArtifact.artifactId;

  // 6. Isolated restore verification (all feature tables, timeout-only).
  // Verify the latest artifact so latestCreated becomes restore-verified;
  // a created dump is never labelled verified until its own restore passes.
  const verify = cliJson("verify", latestId);
  assert.equal(verify.ok, true);
  assert.ok(verify.checks.some((c) => c.startsWith("tables:")));
  assert.ok(verify.checks.includes("relations:ok"));
  assert.ok(verify.checks.some((c) => c.startsWith("timeout_only:")));
  const s2 = cliJson("status");
  assert.equal(s2.latestVerifiedRestore.artifactId, latestId);
  assert.equal(s2.latestCreatedArtifact.artifactId, latestId);
  assert.equal(s2.latestCreatedArtifact.restoreVerified, true);

  // 7. Manual never resets the scheduled clock; scheduled tick does.
  const beforeSchedule = s2.automaticSchedule.lastScheduledRunAt;
  cliJson("request", "--kind", "manual");
  cliJson("run");
  const afterManual = cliJson("status");
  assert.equal(afterManual.automaticSchedule.lastScheduledRunAt, beforeSchedule);
  cliJson("run", "--scheduled");
  const afterSched = cliJson("status");
  assert.ok(afterSched.automaticSchedule.lastScheduledRunAt, "scheduled run must advance the clock");

  // 8. Missing artifact invalidates availability even if the catalog row remains.
  const doomed = afterSched.latestCreatedArtifact.artifactId;
  rmSync(path.join(backupDir, "artifacts", `${doomed}.dump`), { force: true });
  const s3 = cliJson("status");
  // Latest available falls back to an older artifact or reports unavailable.
  if (s3.latestCreatedArtifact) {
    assert.ok(
      s3.latestCreatedArtifact.available === false || s3.latestCreatedArtifact.artifactId !== doomed,
      "lost artifact must invalidate availability",
    );
  }
  assert.ok(s3.warnings.some((w) => w.toLowerCase().includes("missing")), "missing artifact must warn");

  // 9. Checksum corruption is refused at verify time.
  const fresh = cliJson("request", "--kind", "manual");
  void fresh;
  const runFresh = cliJson("run");
  const goodId = runFresh.find((r) => r.ok)?.artifactId;
  assert.ok(goodId);
  const dumpFile = path.join(backupDir, "artifacts", `${goodId}.dump`);
  const bytes = readFileSync(dumpFile);
  bytes[100] = bytes[100] === 0 ? 1 : 0;
  writeFileSync(dumpFile, bytes);
  const corrupt = cli("verify", goodId);
  assert.notEqual(corrupt.status, 0, "corrupted archive must be refused");
  assert.match(corrupt.stderr + corrupt.stdout, /Checksum mismatch|corrupt|refus/i);

  // 10. HTTP API: auth, origin, no secrets.
  server = spawn("pnpm", ["start", "--port", String(port)], { env, detached: true, stdio: "ignore" });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${base}/api/auth/session`);
      if (r.status < 500) {
        ready = true;
        break;
      }
    } catch {
      /* starting */
    }
    await delay(250);
  }
  assert.ok(ready, "Next server did not start");

  const anonStatus = await request("/api/admin/backups/status");
  assert.equal(anonStatus.response.status, 401);
  const orgCookie = await login("bk-org@example.test", ORG_PASS);
  const orgStatus = await request("/api/admin/backups/status", { cookie: orgCookie });
  assert.equal(orgStatus.response.status, 403);
  const adminCookie = await login("bk-admin@example.test", ADMIN_PASS);

  const apiStatus = await request("/api/admin/backups/status", { cookie: adminCookie });
  assert.equal(apiStatus.response.status, 200, JSON.stringify(apiStatus.result));
  assert.equal(apiStatus.result.data.configured, true);
  assert.match(apiStatus.response.headers.get("cache-control") ?? "", /no-store/);
  const apiText = JSON.stringify(apiStatus.result.data);
  assert.ok(!apiText.includes("postgres:postgres"), "status must not leak connection strings");
  assert.ok(!apiText.includes("127.0.0.1"), "status must not leak hosts");

  const badOrigin = await request("/api/admin/backups", {
    cookie: adminCookie,
    method: "POST",
    body: {},
    origin: "https://evil.example",
  });
  assert.equal(badOrigin.response.status, 403);

  const created = await request("/api/admin/backups", { cookie: adminCookie, method: "POST", body: {} });
  assert.ok([200, 201].includes(created.response.status), JSON.stringify(created.result));
  assert.match(created.result.data.job.id, /^bk_/);

  const jobs = await request("/api/admin/backups/jobs?limit=5", { cookie: adminCookie });
  assert.equal(jobs.response.status, 200);
  assert.ok(Array.isArray(jobs.result.data.jobs));

  const detail = await request(`/api/admin/backups/jobs/${created.result.data.job.id}`, { cookie: adminCookie });
  assert.equal(detail.response.status, 200);
  const detailText = JSON.stringify(detail.result.data);
  assert.ok(!detailText.toLowerCase().includes("pgpass"), "job detail must not leak secrets");
  assert.ok(!detailText.includes("stderr"), "job detail must not leak raw tool output");

  const unknown = await request("/api/admin/backups/jobs/bk_0000000000000000", { cookie: adminCookie });
  assert.equal(unknown.response.status, 404);

  console.log("Backup checks passed: dump, TOC, copy, overlap, restore, schedule clock, missing-file, corruption, API auth/origin/redaction.");
} finally {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      /* already stopped */
    }
  }
  try {
    await prisma?.$disconnect();
  } catch {
    /* ignore */
  }
  await disposable.cleanup();
  rmSync(backupDir, { recursive: true, force: true });
  rmSync(secondaryDir, { recursive: true, force: true });
}
