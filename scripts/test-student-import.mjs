/** Reviewed-import PostgreSQL/HTTP fixture. Run after pnpm build:
 * node --import tsx scripts/test-student-import.mjs [--large] [--browser]
 * All writes use a migrated disposable database; no production fallback.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createDisposableDatabase } from "./pg-test-db.mjs";
const locksModule = await import("../globals/utils/pgLocks.ts");
const { ROSTER_EXCLUSIVE_KEY } = locksModule.default ?? locksModule;

const secret = "reviewed-import-disposable-test-secret";
const headers = ["id", "lastName", "firstName", "middleName", "schoolLevel", "yearLevel", "section", "house", "program", "department", "strand"];
const row = (id, extra = {}) => ({ id, lastName: "Import", firstName: "Student", middleName: "", schoolLevel: "COLLEGE", yearLevel: "YEAR_1", section: "section-a", house: "azul", program: "bsit", department: "computer-studies", strand: "", ...extra });
const csvCell = (value) => /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value);
export const toCsv = (rows) => `${headers.join(",")}\n${rows.map((r) => headers.map((h) => csvCell(r[h] ?? "")).join(",")).join("\n")}\n`;
const command = (rows, fileName = "reviewed-roster.csv") => fromCsv(toCsv(rows), fileName);
const fromCsv = (csv, fileName = "reviewed-roster.csv") => ({ v: 1, fileName, sourceHash: createHash("sha256").update(csv, "utf8").digest("hex"), csv });
const signedCookie = (user) => {
  const payload = Buffer.from(JSON.stringify({ session: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status, rejectionReason: null, mustChangePassword: false, credentialVersion: user.credentialVersion }, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `event-attendance-auth=${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
};
const port = await new Promise((resolve) => { const listener = createServer(); listener.listen(0, "127.0.0.1", () => { const selected = listener.address().port; listener.close(() => resolve(selected)); }); });
const base = `http://127.0.0.1:${port}`;
let disposable, pool, db, server;
let serverOutput = "";
const evidence = [];
const record = (label, details = {}) => { evidence.push({ label, ...details }); console.log(JSON.stringify({ label, ...details })); };

async function api(path, body, cookie, options = {}) {
  const started = performance.now();
  const response = await fetch(`${base}${path}`, { method: options.method ?? "POST", headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json", ...options.headers }, body: options.raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  let result = null;
  try { result = await response.json(); } catch { /* retain non-JSON as evidence */ }
  return { status: response.status, result, elapsedMs: performance.now() - started, cache: response.headers.get("cache-control") };
}
async function preview(input, cookie) {
  const response = await api("/api/students/imports/preview", input, cookie);
  assert.equal(response.status, 200, `preview: ${JSON.stringify(response.result)}`);
  assert.equal(response.result?.success, true);
  assert.equal(response.cache, "private, no-store");
  const data = response.result.data;
  assert.equal(data.v, 1);
  assert.equal(data.counts.total, data.rows.length);
  assert.equal(data.counts.total, data.counts.create + data.counts.update + data.counts.unchanged + data.counts.blocked);
  assert.ok(Number.isFinite(Date.parse(data.preparedAt)) && Date.parse(data.expiresAt) > Date.parse(data.preparedAt));
  return { ...response, data };
}
async function commit(input, review, cookie) {
  return api("/api/students/imports/commit", { ...input, previewToken: review.data.previewToken }, cookie);
}
const accepted = (response) => { assert.equal(response.status, 200, JSON.stringify(response.result)); assert.equal(response.result?.success, true); return response.result.data; };
const rejected = (response, statuses = [400, 403, 409, 413]) => { assert.ok(statuses.includes(response.status), `expected rejection, got ${response.status}: ${JSON.stringify(response.result)}`); assert.equal(response.result?.success, false); };
const stale = (response) => { rejected(response, [409]); assert.equal(response.result.code, "STALE_PREVIEW"); };
const snapshot = async () => JSON.stringify({ students: await db.student.findMany({ orderBy: { id: "asc" }, include: { groups: { orderBy: { id: "asc" } } } }), events: await db.event.findMany({ orderBy: { id: "asc" } }), records: await db.record.findMany({ orderBy: { id: "asc" } }) });
const studentWrites = async () => Number((await pool.query('SELECT COUNT(*)::int AS n FROM "ImportTestWrites"')).rows[0].n);
const serverRss = () => {
  const visit = (pid) => { try { const status = readFileSync(`/proc/${pid}/status`, "utf8"); const own = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024; const children = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim().split(/\s+/).filter(Boolean); return own + children.reduce((sum, child) => sum + visit(child), 0); } catch { return 0; } };
  return server?.pid ? visit(server.pid) : 0;
};
async function heldRoster(run) {
  const connection = await pool.connect();
  await connection.query("BEGIN");
  await connection.query("SELECT pg_advisory_xact_lock($1)", [ROSTER_EXCLUSIVE_KEY.toString()]);
  try { await run(() => connection.query("COMMIT")); } finally { await connection.query("ROLLBACK"); connection.release(); }
}
async function waitForBlockedBackend(pid) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM pg_locks WHERE pid=$1 AND NOT granted", [pid]);
    if (rows[0].n > 0) return;
    await delay(20);
  }
  throw new Error(`Independent backend ${pid} never reached its PostgreSQL lock barrier`);
}
async function waitForAdvisoryWait(key) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query("SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE locktype='advisory' AND NOT granted AND a.datname=$1 AND classid::bigint=$2::bigint AND objid::bigint=$3::bigint", [disposable.dbName, (key >> BigInt(32)).toString(), (key & BigInt("4294967295")).toString()]);
    if (rows.length) return rows[0].pid;
    await delay(20);
  }
  throw new Error("Import/attendance never reached its expected PostgreSQL advisory lock barrier");
}

try {
  disposable = await createDisposableDatabase("test_student_import");
  pool = new Pool({ connectionString: disposable.url, max: 8 });
  db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const admins = await Promise.all(["admin", "other"].map((id) => db.user.create({ data: { id, name: `Import ${id}`, email: `${id}@import.example.test`, password: "fixture-password-123", role: "ADMIN", status: "ACTIVE" } })));
  const organizer = await db.user.create({ data: { id: "organizer", name: "Organizer", email: "org@import.example.test", password: "fixture-password-123", role: "ORGANIZER", status: "ACTIVE" } });
  const adminCookie = signedCookie(admins[0]), otherCookie = signedCookie(admins[1]), orgCookie = signedCookie(organizer);
  const groupData = [ ["section-a", "Section A", "SECTION"], ["section-b", "Section B", "SECTION"], ["azul", "Azul", "HOUSE"], ["bsit", "BSIT", "PROGRAM"], ["computer-studies", "Computer Studies", "DEPARTMENT"], ["stem", "STEM", "STRAND"] ].map(([slug, name, category]) => ({ id: slug, slug, name, category }));
  await db.group.createMany({ data: groupData });
  const save = async (input) => db.student.create({ data: { id: input.id, firstName: input.firstName, lastName: input.lastName, middleName: input.middleName || null, schoolLevel: input.schoolLevel, yearLevel: input.yearLevel, groups: { connect: [input.section, input.house, input.program, input.department, input.strand].filter(Boolean).map((id) => ({ id })) } } });
  const existing = row("00000123456"), identical = row("00000123457"), omitted = row("00000123458");
  await save(existing); await save(identical); await save(omitted);
  const event = await db.event.create({ data: { id: "import-event", title: "Import concurrency", category: "ALL", status: "APPROVED", createdById: admins[0].id, start: new Date(Date.now() - 3600000), end: new Date(Date.now() + 3600000) } });
  await db.record.create({ data: { eventId: event.id, studentId: omitted.id, method: "SCANNED", timeout: new Date(), recordedById: admins[0].id } });
  await pool.query('CREATE TABLE "ImportTestWrites" (id text NOT NULL, operation text NOT NULL)');
  await pool.query(`CREATE FUNCTION import_test_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO "ImportTestWrites" VALUES (NEW.id, TG_OP); RETURN NEW; END; $$`);
  await pool.query('CREATE TRIGGER import_test_write AFTER INSERT OR UPDATE ON "Student" FOR EACH ROW EXECUTE FUNCTION import_test_write()');
  server = spawn("pnpm", [process.env.IMPORT_TEST_DEV === "1" ? "dev" : "start", "--port", String(port)], { env: { ...process.env, DATABASE_URL: disposable.url, DIRECT_URL: disposable.url, AUTH_SECRET: secret, NODE_ENV: process.env.IMPORT_TEST_DEV === "1" ? "development" : "production" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => { serverOutput = (serverOutput + chunk).slice(-12000); });
  let ready = false;
  for (let i = 0; i < 160; i++) { if (server.exitCode !== null) throw new Error(`Server exited ${server.exitCode}`); try { if ((await fetch(`${base}/api/auth/session`)).status < 500) { ready = true; break; } } catch {} await delay(250); }
  assert.ok(ready, "isolated Next server became ready");
  const beforeLegacyRoster = await snapshot();
  const beforeLegacyGroups = await db.group.findMany({ orderBy: { id: "asc" } });
  rejected(await api("/api/bulk-import/students", [row("00000123840")]), [401]);
  rejected(await api("/api/bulk-import/students", [row("00000123840")], orgCookie), [403]);
  const retiredLegacy = await api("/api/bulk-import/students", [row("00000123840")], adminCookie);
  rejected(retiredLegacy, [410]); assert.equal(retiredLegacy.result.code, "REVIEW_REQUIRED");
  assert.equal(await snapshot(), beforeLegacyRoster);
  assert.deepEqual(await db.group.findMany({ orderBy: { id: "asc" } }), beforeLegacyGroups);
  record("retired direct-import route refuses anonymous, organizer and administrator bypasses with zero writes");

  if (!process.argv.includes("--browser-only") && !process.argv.includes("--browser-race")) {
  // This first assertion is deliberately the TDD route-availability gate.
  const small = command([row("00000123459")]);
  const first = await preview(small, adminCookie);
  assert.deepEqual(first.data.counts, { total: 1, create: 1, update: 0, unchanged: 0, blocked: 0 });
  record("preview route and classification");
  rejected(await api("/api/students/imports/preview", small), [401]);
  rejected(await commit(small, first), [401]);
  rejected(await api("/api/students/imports/preview", small, orgCookie), [403]);
  rejected(await commit(small, first, orgCookie), [403]);
  rejected(await commit(small, first, otherCookie), [400, 403, 409]);
  await db.user.update({ where: { id: admins[0].id }, data: { status: "REJECTED" } });
  rejected(await commit(small, first, adminCookie), [401, 403]);
  await db.user.update({ where: { id: admins[0].id }, data: { status: "ACTIVE" } });
  rejected(await api("/api/students/imports/commit", { ...small, previewToken: `${first.data.previewToken}x` }, adminCookie));
  const tokenBody = JSON.parse(Buffer.from(first.data.previewToken.split(".")[0], "base64url").toString("utf8"));
  const expiredBody = Buffer.from(JSON.stringify({ ...tokenBody, preparedAt: Date.now() - 700000, expiresAt: Date.now() - 100000 })).toString("base64url");
  const expiredToken = `${expiredBody}.${createHmac("sha256", secret).update(`student-import-review-v1.${expiredBody}`).digest("base64url")}`;
  const expiredResponse = await api("/api/students/imports/commit", { ...small, previewToken: expiredToken }, adminCookie);
  rejected(expiredResponse, [409]); assert.equal(expiredResponse.result.code, "PREVIEW_EXPIRED");
  rejected(await api("/api/students/imports/preview", { ...small, sourceHash: "0".repeat(64) }, adminCookie));
  rejected(await api("/api/students/imports/commit", { ...small, sourceHash: "0".repeat(64), previewToken: first.data.previewToken }, adminCookie));
  rejected(await api("/api/students/imports/commit", { ...small, fileName: "different.csv", previewToken: first.data.previewToken }, adminCookie));
  const otherPurpose = Buffer.from(JSON.stringify({ ...tokenBody, purpose: "student-bulk-commit-v1" })).toString("base64url");
  rejected(await api("/api/students/imports/commit", { ...small, previewToken: `${otherPurpose}.${createHmac("sha256", secret).update(`student-import-review-v1.${otherPurpose}`).digest("base64url")}` }, adminCookie));
  rejected(await api("/api/students/imports/preview", { ...small, students: [] }, adminCookie));
  rejected(await api("/api/students/imports/preview", undefined, adminCookie, { raw: "{" }));
  const beforeValidation = await snapshot();
  for (const csv of ["", headers.join(",") + "\n", toCsv([row("00000123459")]).replace("id,lastName", "studentNumber,lastName"), toCsv([row("00000123459")]).replace("id,lastName", "id,id"), toCsv([row("00000123459")]).replace("id,lastName", "id,unknown,lastName"), headers.join(",") + '\n"unterminated']) {
    rejected(await api("/api/students/imports/preview", fromCsv(csv), adminCookie));
  }
  const duplicate = await api("/api/students/imports/preview", command([row("00000123459"), row("00000123459")]), adminCookie);
  assert.equal(duplicate.status, 200); assert.equal(duplicate.result.data.counts.blocked, 2); assert.equal(duplicate.result.data.previewToken, null);
  assert.ok(duplicate.result.data.rows.every((r) => r.status === "BLOCKED" && r.reasons.some((reason) => reason.code === "DUPLICATE_ID")));
  const blocked = await preview(command([row("00000123459", { section: "unknown-section" }), row("00000123460", { section: "unknown-section" }), row("00000123461", { yearLevel: "GRADE_11" }), row("00000123462", { section: "azul" })]), adminCookie);
  assert.equal(blocked.data.counts.blocked, 4); assert.equal(blocked.data.previewToken, null);
  assert.ok(blocked.data.unknownGroups.some((g) => g.category === "SECTION" && g.slug === "unknown-section" && g.referenceCount === 2));
  assert.equal(await snapshot(), beforeValidation, "review and rejections are read-only");
  assert.equal((await preview(fromCsv(`\uFEFF${toCsv([row("00000123810")])}`), adminCookie)).data.counts.create, 1);
  for (const fileName of ["/tmp/roster.csv", "x".repeat(201), "a\u0000.csv"]) rejected(await api("/api/students/imports/preview", { ...small, fileName }, adminCookie));
  await save(row("00000123811"));
  await db.student.update({ where: { id: "00000123811" }, data: { groups: { connect: [{ id: "section-b" }] } } });
  const ambiguous = await preview(command([row("00000123811")]), adminCookie);
  assert.equal(ambiguous.data.counts.blocked, 1); assert.equal(ambiguous.data.previewToken, null);
  await db.student.delete({ where: { id: "00000123811" } });
  const bytes = 10 * 1024 * 1024;
  rejected(await api("/api/students/imports/preview", fromCsv("x".repeat(bytes + 1)), adminCookie), [413]);
  rejected(await api("/api/students/imports/preview", undefined, adminCookie, { raw: JSON.stringify(small) + " ".repeat(bytes) }), [413]);
  rejected(await api("/api/students/imports/commit", undefined, adminCookie, { raw: JSON.stringify({ ...small, previewToken: first.data.previewToken }) + " ".repeat(bytes) }), [413]);
  record("authorization, parser/header/duplicate/group/body validation");

  const missingInput = command([row("00000123459", { section: "review-created" })]);
  assert.equal((await preview(missingInput, adminCookie)).data.counts.blocked, 1);
  const noStudentWrites = await studentWrites();
  assert.equal((await api("/api/groups", { name: "Created during review", slug: "review-created", category: "SECTION" }, adminCookie)).status, 201);
  assert.equal(await studentWrites(), noStudentWrites);
  assert.equal((await preview(missingInput, adminCookie)).data.counts.create, 1);
  record("explicit group creation resolves blocker with zero Student writes");

  const mixed = command([row(existing.id, { section: "section-b", firstName: "Updated" }), identical, row("00000123459", { middleName: "   ", strand: "   " }), row("00ABC123456", { lastName: "Oñate, Jr.", firstName: "María" })], "mañana.csv");
  const review = await preview(mixed, adminCookie);
  assert.deepEqual(review.data.counts, { total: 4, create: 2, update: 1, unchanged: 1, blocked: 0 });
  assert.equal(review.data.rows.find((r) => r.student.id === existing.id).status, "UPDATE");
  assert.deepEqual(review.data.rows.find((r) => r.student.id === existing.id).changes.sort((a,b) => a.field.localeCompare(b.field)), [{ field: "firstName", before: "Student", after: "Updated" }, { field: "section", before: "section-a", after: "section-b" }]);
  const omittedBefore = await db.student.findUnique({ where: { id: omitted.id }, include: { groups: { orderBy: { id: "asc" } } } });
  const identicalBefore = await db.student.findUnique({ where: { id: identical.id } });
  const attendanceBefore = JSON.stringify(await db.record.findMany());
  const materialBefore = await studentWrites();
  const applied = accepted(await commit(mixed, review, adminCookie));
  assert.deepEqual(applied.counts, review.data.counts);
  assert.equal(await studentWrites() - materialBefore, 3);
  assert.deepEqual(await db.student.findUnique({ where: { id: omitted.id }, include: { groups: { orderBy: { id: "asc" } } } }), omittedBefore);
  assert.deepEqual(await db.student.findUnique({ where: { id: identical.id } }), identicalBefore);
  assert.equal(JSON.stringify(await db.record.findMany()), attendanceBefore);
  const noops = await preview(mixed, adminCookie); assert.equal(noops.data.counts.unchanged, 4);
  const noopsBefore = await snapshot(), writesBefore = await studentWrites();
  accepted(await commit(mixed, noops, adminCookie));
  assert.equal(await snapshot(), noopsBefore); assert.equal(await studentWrites(), writesBefore);
  record("mixed material writes, exact diffs, leading-zero/text IDs, Unicode, noops and omitted roster/attendance preservation");

  for (const mutation of ["student", "group-name", "group-slug", "group-delete", "appeared", "membership"]) {
    const input = command([row("00000123463")]);
    const reviewed = await preview(input, adminCookie);
    if (mutation === "student") { await save(row("00000123463")); }
    if (mutation === "group-name") await db.group.update({ where: { id: "section-a" }, data: { name: "Renamed section" } });
    if (mutation === "group-slug") await db.group.update({ where: { id: "section-a" }, data: { slug: "section-a-renamed" } });
    if (mutation === "group-delete") await db.group.delete({ where: { id: "section-a" } });
    if (mutation === "appeared") await save(row("00000123463"));
    if (mutation === "membership") {
      await save(row("00000123463"));
      const existingReview = await preview(input, adminCookie);
      await db.student.update({ where: { id: "00000123463" }, data: { groups: { set: [{ id: "section-b" }] } } });
      stale(await commit(input, existingReview, adminCookie));
    } else {
      const beforeRejected = await snapshot(); stale(await commit(input, reviewed, adminCookie)); assert.equal(await snapshot(), beforeRejected);
    }
    await db.student.deleteMany({ where: { id: "00000123463" } });
    await db.group.upsert({ where: { id: "section-a" }, create: groupData[0], update: { name: "Section A", slug: "section-a" } });
  }
  const changeInput = command([row(existing.id, { firstName: "Changed again" })]);
  const changeReview = await preview(changeInput, adminCookie);
  await db.student.update({ where: { id: existing.id }, data: { lastName: "Separate edit" } });
  stale(await commit(changeInput, changeReview, adminCookie));
  rejected(await commit(command([row(existing.id, { firstName: "Different input" })]), changeReview, adminCookie));
  record("stale existing/new Student and Group name/slug/deletion/membership rejection");

  const rollbackInput = command([row("00000123464"), row("00000123465", { firstName: "Force rollback" })]);
  const rollbackReview = await preview(rollbackInput, adminCookie);
  await pool.query(`CREATE FUNCTION import_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."firstName" = 'Force rollback' THEN RAISE EXCEPTION 'fixture student write failure'; END IF; RETURN NEW; END; $$`);
  await pool.query('CREATE TRIGGER import_test_failure BEFORE INSERT OR UPDATE ON "Student" FOR EACH ROW EXECUTE FUNCTION import_test_failure()');
  const rollbackBefore = await snapshot();
  try { const failure = await commit(rollbackInput, rollbackReview, adminCookie); rejected(failure, [409, 500]); assert.equal(failure.result.code, "IMPORT_REJECTED"); assert.equal(await snapshot(), rollbackBefore); } finally { await pool.query('DROP TRIGGER import_test_failure ON "Student"'); }
  record("mid-batch database failure rolls back entire roster");

  for (const change of [{ status: "REJECTED" }, { credentialVersion: { increment: 1 } }]) {
    const actorInput = command([row("00000123830")]);
    const actorReview = await preview(actorInput, adminCookie);
    const revoker = await pool.connect();
    let request;
    try {
      await revoker.query("BEGIN");
      if (change.status) await revoker.query('UPDATE "User" SET status=\'REJECTED\' WHERE id=$1', [admins[0].id]);
      else await revoker.query('UPDATE "User" SET "credentialVersion"="credentialVersion"+1 WHERE id=$1', [admins[0].id]);
      const beforeWrites = await studentWrites();
      request = commit(actorInput, actorReview, adminCookie);
      const deadline = Date.now() + 10000;
      let actorGuardPid;
      while (Date.now() < deadline) {
        const { rows: waiting } = await pool.query("SELECT DISTINCT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE NOT l.granted AND a.datname=$1 AND a.query LIKE '%FOR SHARE%'", [disposable.dbName]);
        if (waiting.length) { actorGuardPid = waiting[0].pid; break; }
        await delay(20);
      }
      assert.ok(actorGuardPid, "commit actor guard waits for independently held account change");
      await revoker.query("COMMIT");
      rejected(await request, change.status ? [403] : [401]);
      assert.equal(await studentWrites(), beforeWrites);
      assert.equal(await db.student.count({ where: { id: "00000123830" } }), 0);
      record("account revocation wins at actor lock barrier", { kind: change.status ? "deactivation" : "credential-version", actorGuardPid });
    } finally {
      await revoker.query("ROLLBACK"); await Promise.allSettled([request].filter(Boolean)); revoker.release();
      await db.user.update({ where: { id: admins[0].id }, data: { status: "ACTIVE", credentialVersion: admins[0].credentialVersion } });
    }
  }

  // Hold the second INSERT inside the real import transaction. The first
  // tentative INSERT exists in that transaction, but outsiders must see none.
  const halfInput = command([row("00000123820"), row("00000123821")]);
  const halfReview = await preview(halfInput, adminCookie);
  const gateKey = BigInt("812370000000") + BigInt(process.pid);
  const controller = await pool.connect(), reader = await pool.connect(), renamer = await pool.connect();
  let halfCommit, readerResult, renameResult;
  try {
    await controller.query("SELECT pg_advisory_lock($1)", [gateKey.toString()]);
    await pool.query(`CREATE FUNCTION import_test_half() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '00000123821' THEN PERFORM pg_advisory_xact_lock(${gateKey}); END IF; RETURN NEW; END; $$`);
    await pool.query('CREATE TRIGGER import_test_half BEFORE INSERT ON "Student" FOR EACH ROW EXECUTE FUNCTION import_test_half()');
    halfCommit = commit(halfInput, halfReview, adminCookie);
    const waitingImportPid = await waitForAdvisoryWait(gateKey);
    assert.ok(waitingImportPid, "second Student INSERT reached the trigger barrier after the first tentative write");
    assert.equal(await db.student.count({ where: { id: { in: ["00000123820", "00000123821"] } } }), 0, "unlocked independent reader sees no uncommitted half import");
    await reader.query("BEGIN");
    const readerPid = (await reader.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    readerResult = reader.query("SELECT pg_advisory_xact_lock_shared($1)", [ROSTER_EXCLUSIVE_KEY.toString()]).then(async () => {
      const result = await reader.query('SELECT COUNT(*)::int AS n FROM "Student" WHERE id=ANY($1::text[])', [["00000123820", "00000123821"]]);
      await reader.query("COMMIT"); return result.rows[0].n;
    });
    await waitForBlockedBackend(readerPid);
    const renamerPid = (await renamer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    renameResult = renamer.query('UPDATE "Group" SET name=$1 WHERE id=$2', ["After import label", "section-a"]);
    await waitForBlockedBackend(renamerPid);
    await controller.query("SELECT pg_advisory_unlock($1)", [gateKey.toString()]);
    accepted(await halfCommit); assert.equal(await readerResult, 2, "guarded roster reader resumes with the complete import"); await renameResult;
    record("half-import atomic visibility and referenced Group rename freeze", { waitingImportPid, independentReaderPid: readerPid, independentRenamerPid: renamerPid });
  } finally {
    await controller.query("SELECT pg_advisory_unlock($1)", [gateKey.toString()]);
    await Promise.allSettled([halfCommit, readerResult, renameResult].filter(Boolean));
    await reader.query("ROLLBACK");
    await pool.query('DROP TRIGGER IF EXISTS import_test_half ON "Student"');
    controller.release(); reader.release(); renamer.release();
  }

  const lockedInput = command([row("00000123466")]);
  const lockedReview = await preview(lockedInput, adminCookie);
  await heldRoster(async (release) => {
    let settled = false;
    const pending = commit(lockedInput, lockedReview, adminCookie).finally(() => { settled = true; });
    await waitForAdvisoryWait(ROSTER_EXCLUSIVE_KEY); assert.equal(settled, false, "import waits for independently held roster lock");
    await release(); accepted(await pending);
  });
  await heldRoster(async (release) => {
    let settled = false;
    const pending = api("/api/records", { eventId: event.id, studentId: existing.id, method: "MANUAL", expectedMode: "TIME_IN" }, orgCookie).finally(() => { settled = true; });
    await waitForAdvisoryWait(ROSTER_EXCLUSIVE_KEY); assert.equal(settled, false, "attendance waits for exclusive roster writer");
    await release(); const scan = await pending; assert.ok([200, 201].includes(scan.status), JSON.stringify(scan.result));
  });
  const concurrentInput = command([row("00000123467")]);
  const concurrentReview = await preview(concurrentInput, adminCookie);
  const concurrent = await Promise.all([commit(concurrentInput, concurrentReview, adminCookie), commit(concurrentInput, concurrentReview, adminCookie)]);
  assert.equal(concurrent.filter((r) => r.status === 200).length, 1);
  stale(concurrent.find((r) => r.status !== 200));
  record("independent PostgreSQL roster lock waiting, attendance and concurrent stale commit");

  if (process.argv.includes("--large")) {
    for (const count of [2000, 5005]) {
      const rows = Array.from({ length: count }, (_, index) => row(String(80000000000 + count * 10000 + index), { firstName: `Load${index}` }));
      const input = command(rows, `load-${count}.csv`);
      const memoryBefore = process.memoryUsage().rss;
      const appMemoryBefore = serverRss();
      const prepared = await preview(input, adminCookie);
      assert.equal(prepared.data.counts.create, count);
      const pending = commit(input, prepared, adminCookie);
      let importLockObserved = false;
      for (let attempt = 0; attempt < 300; attempt++) {
        const { rows: locks } = await pool.query("SELECT COUNT(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND l.mode='ExclusiveLock' AND l.granted AND a.datname=$1", [disposable.dbName]);
        if (locks[0].n > 0) { importLockObserved = true; break; }
        await delay(10);
      }
      const scanIds = [existing.id, identical.id, omitted.id, "00000123459"];
      const recordsBefore = await Promise.all(scanIds.map((studentId) => db.record.findUnique({ where: { eventId_studentId: { eventId: event.id, studentId } } })));
      const scans = await Promise.all(scanIds.map((studentId) => api("/api/records", { eventId: event.id, studentId, method: "MANUAL", expectedMode: "TIME_IN" }, orgCookie)));
      const result = await pending; accepted(result);
      const postCommitRetries = [];
      for (let index = 0; index < scans.length; index++) {
        const scan = scans[index];
        if ([200, 201].includes(scan.status)) continue;
        assert.equal(scan.status, 503, JSON.stringify(scan.result));
        assert.equal(scan.result?.success, false);
        assert.ok(["The database transaction did not complete and was rolled back. Retrying the operation is safe.", "The database detected a write conflict and rolled back. Retrying the operation is safe."].includes(scan.result.message), "only the existing confirmed-rollback attendance error is expected during a long roster lock");
        assert.deepEqual(await db.record.findUnique({ where: { eventId_studentId: { eventId: event.id, studentId: scanIds[index] } } }), recordsBefore[index], "timed-out attendance performed zero Record mutation");
        const retry = await api("/api/records", { eventId: event.id, studentId: scanIds[index], method: "MANUAL", expectedMode: "TIME_IN" }, orgCookie);
        assert.ok([200, 201].includes(retry.status), JSON.stringify(retry.result));
        postCommitRetries.push({ status: retry.status, elapsedMs: Math.round(retry.elapsedMs) });
      }
      assert.equal(await db.student.count({ where: { id: { in: rows.map((r) => r.id) } } }), count);
      const later = await preview(input, adminCookie); assert.equal(later.data.counts.unchanged, count);
      record("large reviewed import", { rows: count, csvBytes: Buffer.byteLength(input.csv), previewRequestBytes: Buffer.byteLength(JSON.stringify(input)), commitRequestBytes: Buffer.byteLength(JSON.stringify({ ...input, previewToken: prepared.data.previewToken })), previewMs: Math.round(prepared.elapsedMs), commitMs: Math.round(result.elapsedMs), fixtureRssChangeBytes: process.memoryUsage().rss - memoryBefore, appRssChangeBytes: serverRss() - appMemoryBefore, importLockObserved, concurrentAttendance: scans.map((scan) => ({ status: scan.status, elapsedMs: Math.round(scan.elapsedMs) })), postCommitRetries });
    }
  }
  }
  if (process.argv.includes("--browser") || process.argv.includes("--browser-only") || process.argv.includes("--browser-race")) {
    const { runStudentImportBrowser } = await import("./student-import-browser.mjs");
    await runStudentImportBrowser({ base, cookie: adminCookie, toCsv, row, db });
  }
  record("reviewed import fixture passed", { checks: evidence.length });
} catch (error) {
  // Never include connection URLs, cookie/token bodies or arbitrary server logs.
  console.error(error.stack ?? error.message);
  if (server?.exitCode !== null && server?.exitCode !== undefined) console.error(`Isolated server exit: ${server.exitCode}`);
  process.exitCode = 1;
} finally {
  if (server?.pid && server.exitCode === null) { try { process.kill(-server.pid, "SIGTERM"); } catch {} await delay(500); }
  await db?.$disconnect(); await pool?.end(); await disposable?.cleanup();
}
