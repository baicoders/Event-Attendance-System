import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const temp = await mkdtemp(join(tmpdir(), "issue83-account-recovery-"));
const databaseUrl = `file:${join(temp, "test.db")}`;
const secret = "issue83-account-recovery-test-secret";
const port = 42200 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATABASE_URL: databaseUrl, AUTH_SECRET: secret };
let server;
let prisma;

const ADMIN_PASS = "admin-pass-123";
const ADMIN2_PASS = "admin2-pass-123";
const TARGET_PASS = "target-pass-123";
const PENDING_PASS = "pending-pass-123";
const LEGACY_PASS = "legacy-pass-123";
const NEW_PASS = "brand-new-pass-456";

async function request(path, { cookie, method = "GET", body, redirect } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    redirect: redirect ?? "follow",
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
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
  assert.equal(response.status, 200, `${email}: ${JSON.stringify(result)}`);
  assert.match(
    response.headers.get("cache-control") ?? "",
    /no-store/,
    "login must be no-store",
  );
  return {
    cookie: response.headers.get("set-cookie").split(";")[0],
    session: result.data,
  };
}

/** A pre-versioning cookie: valid HMAC, but no credentialVersion field. */
function legacyCookie(user) {
  const payload = Buffer.from(
    JSON.stringify({
      session: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
      },
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `event-attendance-auth=${payload}.${sig}`;
}

try {
  const push = spawnSync("pnpm", ["exec", "prisma", "db", "push"], {
    env,
    encoding: "utf8",
  });
  assert.equal(push.status, 0, push.stderr || push.stdout);
  prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
  });

  const admin = await prisma.user.create({
    data: {
      name: "Recovery Admin",
      email: "issue83-admin@example.test",
      password: ADMIN_PASS,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });
  const admin2 = await prisma.user.create({
    data: {
      name: "Second Admin",
      email: "issue83-admin2@example.test",
      password: ADMIN2_PASS,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });
  const target = await prisma.user.create({
    data: {
      name: "Maria Santos",
      email: "issue83-maria@example.test",
      password: TARGET_PASS,
      role: "ORGANIZER",
      status: "ACTIVE",
    },
  });
  const pending = await prisma.user.create({
    data: {
      name: "Pending Pat",
      email: "issue83-pending@example.test",
      password: PENDING_PASS,
      role: "ORGANIZER",
      status: "PENDING",
    },
  });
  const legacy = await prisma.user.create({
    data: {
      name: "Legacy Lou",
      email: "issue83-legacy@example.test",
      password: LEGACY_PASS,
      role: "ORGANIZER",
      status: "ACTIVE",
    },
  });
  const event = await prisma.event.create({
    data: {
      title: "RecoveryFixture",
      category: "ALL",
      status: "APPROVED",
      createdById: admin.id,
      start: new Date(Date.now() - 3600000),
      end: new Date(Date.now() + 3600000),
    },
  });

  server = spawn("pnpm", ["start", "--port", String(port)], {
    env,
    detached: true,
    stdio: "ignore",
  });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`${base}/api/auth/session`);
      if (response.status < 500) {
        ready = true;
        break;
      }
    } catch {
      /* Starting */
    }
    await delay(250);
  }
  assert.ok(ready, "local Next server did not start");

  // 1. Baseline: target signs in, cookie A works.
  const a = await login(target.email, TARGET_PASS);
  assert.equal(a.session.mustChangePassword ?? false, false);
  const v0 = a.session.credentialVersion;
  assert.equal(typeof v0, "number");
  const adminAuth = await login(admin.email, ADMIN_PASS);
  const adminCookie = adminAuth.cookie;

  // Directory exposes the reviewed revision.
  const dir = await request("/api/admin/users", { cookie: adminCookie });
  assert.equal(dir.response.status, 200, JSON.stringify(dir.result));
  assert.equal(
    dir.result.data.find((u) => u.id === target.id).credentialVersion,
    v0,
  );

  // 2. Wrong admin password and self-reset are rejected without writes.
  const wrong = await request(`/api/admin/users/${target.id}/password`, {
    cookie: adminCookie,
    method: "PATCH",
    body: { adminPassword: "nope-nope-nope", expectedCredentialVersion: v0 },
  });
  assert.equal(wrong.response.status, 401);
  assert.equal(wrong.result.code, "INVALID_CREDENTIALS");
  const self = await request(`/api/admin/users/${admin.id}/password`, {
    cookie: adminCookie,
    method: "PATCH",
    body: { adminPassword: ADMIN_PASS, expectedCredentialVersion: adminAuth.session.credentialVersion },
  });
  assert.equal(self.response.status, 409);
  assert.equal(self.result.code, "USE_CHANGE_PASSWORD");

  // 3. Reset commits: old password dies, cookie A dies, role/status survive.
  const reset = await request(`/api/admin/users/${target.id}/password`, {
    cookie: adminCookie,
    method: "PATCH",
    body: { adminPassword: ADMIN_PASS, expectedCredentialVersion: v0 },
  });
  assert.equal(reset.response.status, 200, JSON.stringify(reset.result));
  assert.match(
    reset.response.headers.get("cache-control") ?? "",
    /no-store/,
    "reset must be no-store",
  );
  const tempPass = reset.result.data.temporaryPassword;
  assert.equal(typeof tempPass, "string");
  assert.equal(tempPass.length, 12);
  const v1 = reset.result.data.credentialVersion;
  assert.equal(v1, v0 + 1);
  const afterReset = await prisma.user.findUniqueOrThrow({
    where: { id: target.id },
  });
  assert.equal(afterReset.role, "ORGANIZER");
  assert.equal(afterReset.status, "ACTIVE");
  assert.equal(afterReset.mustChangePassword, true);
  assert.equal(afterReset.credentialVersion, v1);
  assert.ok(afterReset.password.startsWith("scrypt:"));

  const oldLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email: target.email, password: TARGET_PASS },
  });
  assert.equal(oldLogin.response.status, 401);
  const staleA = await request("/api/students", { cookie: a.cookie });
  assert.equal(staleA.response.status, 401);
  assert.equal(staleA.result.code, "UNAUTHORIZED");

  // 4. Forced-change session: identity yes, business no, print redirects out.
  const b = await login(target.email, tempPass);
  assert.equal(b.session.mustChangePassword, true);
  const bSession = await request("/api/auth/session", { cookie: b.cookie });
  assert.equal(bSession.response.status, 200);
  assert.equal(bSession.result.data.mustChangePassword, true);
  assert.match(
    bSession.response.headers.get("cache-control") ?? "",
    /no-store/,
    "session must be no-store",
  );
  const bBlocked = await request("/api/students", { cookie: b.cookie });
  assert.equal(bBlocked.response.status, 403);
  assert.equal(bBlocked.result.code, "PASSWORD_CHANGE_REQUIRED");
  const bPrint = await request(`/reports/events/${event.id}/print`, {
    cookie: b.cookie,
    redirect: "manual",
  });
  assert.ok([307, 308].includes(bPrint.response.status), `print status ${bPrint.response.status}`);
  assert.match(
    bPrint.response.headers.get("location") ?? "",
    /\/$/,
    "restricted print must leave for the main-shell gate, not a login loop",
  );
  const aPrint = await request(`/reports/events/${event.id}/print`, {
    cookie: a.cookie,
    redirect: "manual",
  });
  assert.ok([307, 308].includes(aPrint.response.status));
  assert.match(aPrint.response.headers.get("location") ?? "", /login/);

  // 5. Reusing the temporary password as the replacement is rejected server-side.
  const reuse = await request("/api/auth/change-password", {
    cookie: b.cookie,
    method: "POST",
    body: { currentPassword: tempPass, newPassword: tempPass },
  });
  assert.equal(reuse.response.status, 400);
  const afterReuse = await prisma.user.findUniqueOrThrow({
    where: { id: target.id },
  });
  assert.equal(afterReuse.credentialVersion, v1);
  assert.equal(afterReuse.mustChangePassword, true);

  // 6. Correct replacement: cookie C works, A and B stay dead, flag clears.
  const changed = await request("/api/auth/change-password", {
    cookie: b.cookie,
    method: "POST",
    body: { currentPassword: tempPass, newPassword: NEW_PASS },
  });
  assert.equal(changed.response.status, 200, JSON.stringify(changed.result));
  assert.match(
    changed.response.headers.get("cache-control") ?? "",
    /no-store/,
  );
  const v2 = changed.result.data.credentialVersion;
  assert.equal(v2, v1 + 1);
  const cCookie = changed.response.headers.get("set-cookie").split(";")[0];
  const cOk = await request("/api/students", { cookie: cCookie });
  assert.equal(cOk.response.status, 200);
  assert.equal(
    (await request("/api/auth/session", { cookie: b.cookie })).result.data,
    null,
    "replaced cookie B must be revoked",
  );
  const tempDead = await request("/api/auth/login", {
    method: "POST",
    body: { email: target.email, password: tempPass },
  });
  assert.equal(tempDead.response.status, 401);
  const freshLogin = await login(target.email, NEW_PASS);
  assert.equal(freshLogin.session.mustChangePassword ?? false, false);

  // A stale cookie cannot change the password after a newer reset.
  const admin2Auth = await login(admin2.email, ADMIN2_PASS);
  const reset2 = await request(`/api/admin/users/${target.id}/password`, {
    cookie: admin2Auth.cookie,
    method: "PATCH",
    body: { adminPassword: ADMIN2_PASS, expectedCredentialVersion: v2 },
  });
  assert.equal(reset2.response.status, 200, JSON.stringify(reset2.result));
  const v3 = reset2.result.data.credentialVersion;
  const staleChange = await request("/api/auth/change-password", {
    cookie: cCookie,
    method: "POST",
    body: { currentPassword: NEW_PASS, newPassword: "another-new-pass-789" },
  });
  assert.equal(staleChange.response.status, 401);

  // 7. Two resets from one reviewed version: exactly one winner.
  const pair = await Promise.all([
    request(`/api/admin/users/${target.id}/password`, {
      cookie: adminCookie,
      method: "PATCH",
      body: { adminPassword: ADMIN_PASS, expectedCredentialVersion: v3 },
    }),
    request(`/api/admin/users/${target.id}/password`, {
      cookie: admin2Auth.cookie,
      method: "PATCH",
      body: { adminPassword: ADMIN2_PASS, expectedCredentialVersion: v3 },
    }),
  ]);
  const statuses = pair.map((p) => p.response.status).sort();
  assert.deepEqual(statuses, [200, 409]);
  assert.equal(
    pair.find((p) => p.response.status === 409).result.code,
    "CREDENTIALS_CHANGED",
  );
  const afterRace = await prisma.user.findUniqueOrThrow({
    where: { id: target.id },
  });
  assert.equal(afterRace.credentialVersion, v3 + 1);

  // 8. Pending targets may be reset but stay pending.
  const pendingRow = await prisma.user.findUniqueOrThrow({
    where: { id: pending.id },
  });
  const pendingReset = await request(`/api/admin/users/${pending.id}/password`, {
    cookie: adminCookie,
    method: "PATCH",
    body: {
      adminPassword: ADMIN_PASS,
      expectedCredentialVersion: pendingRow.credentialVersion,
    },
  });
  assert.equal(pendingReset.response.status, 200, JSON.stringify(pendingReset.result));
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: pending.id } })).status,
    "PENDING",
  );
  const pendingLogin = await request("/api/auth/login", {
    method: "POST",
    body: {
      email: pending.email,
      password: pendingReset.result.data.temporaryPassword,
    },
  });
  assert.equal(pendingLogin.response.status, 403);

  // 9. Legacy plaintext upgrades, then a reset revokes the upgraded session.
  const legacyLogin = await login(legacy.email, LEGACY_PASS);
  assert.ok(
    (await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } })).password.startsWith("scrypt:"),
    "legacy row must be hashed after login",
  );
  const legacyRow = await prisma.user.findUniqueOrThrow({
    where: { id: legacy.id },
  });
  const legacyReset = await request(`/api/admin/users/${legacy.id}/password`, {
    cookie: adminCookie,
    method: "PATCH",
    body: {
      adminPassword: ADMIN_PASS,
      expectedCredentialVersion: legacyRow.credentialVersion,
    },
  });
  assert.equal(legacyReset.response.status, 200);
  const legacyStale = await request("/api/students", {
    cookie: legacyLogin.cookie,
  });
  assert.equal(legacyStale.response.status, 401);

  // 10. Old cookies without a version never verify.
  const oldCookie = legacyCookie(target);
  const oldSession = await request("/api/auth/session", { cookie: oldCookie });
  assert.equal(oldSession.response.status, 200);
  assert.equal(oldSession.result.data, null);

  console.log(
    "Account recovery HTTP checks passed: revocation, restriction, equality, conflicts, races, pending, legacy, old-cookie rejection.",
  );
} finally {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      /* Already stopped */
    }
  }
  await prisma?.$disconnect();
  await rm(temp, { recursive: true, force: true });
}
