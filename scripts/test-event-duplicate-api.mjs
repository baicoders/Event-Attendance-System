import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { createDisposableDatabase } from "./pg-test-db.mjs";

const disposable = await createDisposableDatabase("test");
const databaseUrl = disposable.url;
const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const port = 41000 + Math.floor(Math.random() * 10000);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, AUTH_SECRET: "duplicate-event-api-test-secret" };
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
  const { response } = await request("/api/auth/login", {
    method: "POST", body: { email, password: "password-123" },
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

try {
  prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const users = await Promise.all([
    ["owner", "ORGANIZER", "ACTIVE"],
    ["other", "ORGANIZER", "ACTIVE"],
    ["admin", "ADMIN", "ACTIVE"],
    ["inactive", "ORGANIZER", "REJECTED"],
  ].map(([name, role, status]) => prisma.user.create({
    data: { name, email: `${name}@example.test`, password: "password-123", role, status },
  })));
  const [owner, other, admin] = users;
  const group = await prisma.group.create({ data: { name: "Computer Studies", slug: "computer-studies", category: "DEPARTMENT" } });
  const student = await prisma.student.create({ data: {
    id: "TEST-1", firstName: "Test", lastName: "Student", yearLevel: "YEAR_1", schoolLevel: "COLLEGE",
  } });
  const source = await prisma.event.create({ data: {
    title: "Foundation Day", location: "Hall", description: "Annual event", category: "DEPARTMENT",
    includedGroups: { connect: [{ id: group.id }] }, start: new Date("2026-09-21T01:00:00Z"),
    end: new Date("2026-09-21T02:00:00Z"), status: "APPROVED", allDay: false,
    isTimeout: true, createdById: owner.id, reviewedById: admin.id, reviewedAt: new Date(),
    records: { create: { studentId: student.id, method: "SCANNED" } },
  } });
  const privateSource = await prisma.event.create({ data: {
    title: "Private draft", category: "ALL", start: new Date(), end: new Date(), createdById: owner.id,
  } });
  const original = await prisma.event.findUnique({ where: { id: source.id }, include: { includedGroups: true, records: true } });

  server = spawn("pnpm", ["dev", "--port", String(port)], { env, detached: true, stdio: "ignore" });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      const response = await fetch(`${base}/api/auth/session`);
      if (response.status < 500) { ready = true; break; }
    } catch { /* server is starting */ }
    await delay(500);
  }
  assert.ok(ready, "development server did not start");

  const ownerCookie = await login(owner.email);
  const otherCookie = await login(other.email);
  const adminCookie = await login(admin.email);
  assert.equal((await request(`/api/events/${source.id}`, { cookie: otherCookie })).response.status, 200);
  assert.equal((await request(`/api/events/${source.id}`)).response.status, 401);
  assert.equal((await request(`/api/events/${privateSource.id}`, { cookie: otherCookie })).response.status, 403);
  assert.equal((await request(`/api/events/${privateSource.id}`, { cookie: adminCookie })).response.status, 200);

  const copied = {
    title: source.title, location: source.location, description: source.description,
    category: source.category, includedGroups: [group.id], allDay: source.allDay,
    start: "2026-10-01T01:00:00.000Z", end: "2026-10-01T02:00:00.000Z",
    status: "APPROVED", createdById: owner.id, reviewedById: admin.id,
    reviewedAt: new Date().toISOString(), isTimeout: true,
  };
  for (const [cookie, actor] of [[ownerCookie, owner], [otherCookie, other], [adminCookie, admin]]) {
    const { response, result } = await request("/api/events", { cookie, method: "POST", body: copied });
    assert.equal(response.status, 201, JSON.stringify(result));
    assert.notEqual(result.data.id, source.id);
    const created = await prisma.event.findUnique({ where: { id: result.data.id }, include: { includedGroups: true, records: true } });
    assert.equal(created.status, "DRAFT");
    assert.equal(created.createdById, actor.id);
    assert.equal(created.reviewedById, null);
    assert.equal(created.reviewedAt, null);
    assert.equal(created.rejectionReason, null);
    assert.equal(created.isTimeout, false);
    assert.equal(created.records.length, 0);
    assert.deepEqual(created.includedGroups.map((item) => item.id), [group.id]);
  }
  assert.equal((await request("/api/events", { method: "POST", body: copied })).response.status, 401);
  const beforeInvalid = await prisma.event.count();
  const invalid = await request("/api/events", { cookie: ownerCookie, method: "POST", body: { ...copied, includedGroups: ["missing-group"] } });
  assert.equal(invalid.response.status, 400);
  assert.equal(await prisma.event.count(), beforeInvalid);
  assert.equal((await request("/api/auth/login", { method: "POST", body: { email: "inactive@example.test", password: "password-123" } })).response.status, 403);
  assert.deepEqual(await prisma.event.findUnique({ where: { id: source.id }, include: { includedGroups: true, records: true } }), original);
  console.log("Duplicate API checks passed: roles, clean drafts, attendance, source invariance.");
} finally {
  if (server?.pid) {
    try { process.kill(-server.pid, "SIGTERM"); } catch { /* already stopped */ }
  }
  await prisma?.$disconnect();
  await pool.end();
  await disposable.cleanup();
}
