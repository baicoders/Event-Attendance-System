import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { createDisposableDatabase } from "./pg-test-db.mjs";

const { Pool } = pg;
const secret = "issue48-integration-test-secret";
const port = await new Promise((resolve, reject) => {
  const listener = createServer();
  listener.once("error", reject);
  listener.listen(0, "127.0.0.1", () => {
    const address = listener.address();
    listener.close(() => resolve(address.port));
  });
});
let db;
let server;
let pool;
let disposable;

const cookieFor = (user) => {
  const session = { id: user.id, name: user.name, email: user.email, role: user.role,
    status: user.status, rejectionReason: null, mustChangePassword: false,
    credentialVersion: user.credentialVersion };
  const payload = Buffer.from(JSON.stringify({ session, exp: Math.floor(Date.now() / 1000) + 3600 }), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `event-attendance-auth=${payload}.${signature}`;
};

try {
  disposable = await createDisposableDatabase("test_issue48_api");
  pool = new Pool({ connectionString: disposable.url });
  db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const owner = await db.user.create({ data: { name: "Owner", email: "owner@example.test", password: "test", status: "ACTIVE" } });
  const other = await db.user.create({ data: { name: "Other", email: "other@example.test", password: "test", status: "ACTIVE" } });
  const student = await db.student.create({ data: { id: "00000123456", firstName: "Juan", lastName: "Cruz", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
  const event = await db.event.create({ data: { title: "API review", category: "ALL", status: "APPROVED", createdById: owner.id, start: new Date(Date.now() - 3600000), end: new Date(Date.now() + 3600000) } });
  server = spawn("pnpm", ["exec", "next", "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: disposable.url, AUTH_SECRET: secret, NODE_ENV: "production" }, stdio: "pipe",
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (server.exitCode !== null) throw new Error("Next server exited before readiness");
    try { await fetch(`${base}/api/auth/session`); ready = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  assert.ok(ready, "Next server became ready");
  const call = async (path, user, method = "GET", body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookieFor(user), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, result: await response.json() };
  };

  const denied = await call(`/api/events/${event.id}/attendance-review`, other);
  assert.equal(denied.status, 403);
  const scan = await call("/api/records", owner, "POST", { eventId: event.id, studentId: student.id, method: "SCANNED" });
  assert.equal(scan.status, 201);
  assert.equal(scan.result.data.revision, 1);
  const recordId = scan.result.data.id;
  const oldDelete = await call(`/api/records/${recordId}`, owner, "DELETE");
  assert.equal(oldDelete.status, 400);
  assert.equal(oldDelete.result.code, "CORRECTION_REQUIRED");
  const voided = await call(`/api/events/${event.id}/attendance-corrections`, owner, "POST", {
    commandId: randomUUID(), action: "VOID", studentId: student.id, recordId, expectedRevision: 1, reason: "Incorrect student scan",
  });
  assert.equal(voided.status, 200);
  assert.equal(voided.result.data.after, null);
  assert.match(voided.result.data.changeId, /^[1-9][0-9]*$/);
  const history = await call(`/api/events/${event.id}/attendance-history?studentId=${student.id}`, owner);
  assert.equal(history.status, 200);
  assert.deepEqual(history.result.data.changes.map((change) => change.action), ["VOID", "CREATE"]);
  const directory = await call(`/api/events/${event.id}/attendance-review?state=voided`, owner);
  assert.equal(directory.status, 200);
  assert.equal(directory.result.data.total, 1);
  const second = await db.student.create({ data: { id: "00000123457", firstName: "Mia", lastName: "Santos", schoolLevel: "COLLEGE", yearLevel: "YEAR_1" } });
  const secondScan = await call("/api/records", owner, "POST", { eventId: event.id, studentId: second.id, method: "MANUAL" });
  assert.equal(secondScan.status, 201);
  const directCommand = { commandId: randomUUID(), expectedRevision: 1, reason: "Wrong student selected" };
  const directVoid = await call(`/api/records/${secondScan.result.data.id}`, owner, "DELETE", directCommand);
  assert.equal(directVoid.status, 200);
  assert.equal(directVoid.result.data.action, "VOID");
  assert.equal(await db.record.count({ where: { eventId: event.id, studentId: second.id } }), 0);
  const replay = await call(`/api/records/${secondScan.result.data.id}`, owner, "DELETE", directCommand);
  assert.equal(replay.status, 200);
  assert.equal(replay.result.data.replayed, true);
  assert.equal(replay.result.data.changeId, directVoid.result.data.changeId);
  console.log("Authenticated attendance API scan, reasoned DELETE, void, history, review, and authorization checks passed.");
} finally {
  if (server && server.exitCode === null) server.kill("SIGTERM");
  await db?.$disconnect();
  await pool?.end();
  await disposable?.cleanup();
}
