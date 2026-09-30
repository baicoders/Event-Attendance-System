/** Additive #100 migration and real whole-database backup/restore evidence.
 * node --import tsx scripts/test-student-import-durability.mjs
 * Requires explicit TEST_DATABASE_URL and version-matched BACKUP_PG_* tools.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { createDisposableDatabase } from "./pg-test-db.mjs";
const contractModule = await import("../features/students/import/receiptContract.ts");
const { receiptResultSchema, receiptSchema } = contractModule.default ?? contractModule;

const maintenance = process.env.TEST_DATABASE_URL;
assert.ok(maintenance && /^postgres(ql)?:\/\//.test(maintenance), "TEST_DATABASE_URL must explicitly name a PostgreSQL maintenance database");
assert.ok(!["event_attendance_dev", "event_attendance_prod", "event_attendance"].includes(new URL(maintenance).pathname.slice(1)), "never use a live database as the maintenance target");
const name = `test_import_upgrade_${randomBytes(6).toString("hex")}`;
const url = new URL(maintenance); url.pathname = `/${name}`;
const admin = new Pool({ connectionString: maintenance, max: 2 });
const target = new Pool({ connectionString: url.toString(), max: 2 });
let fresh, restoredName, restored;
const backupDir = mkdtempSync(join(tmpdir(), "student-import-durable-"));
const migrations = readdirSync("prisma/migrations", { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const receiptMigration = migrations.find((directory) => readFileSync(join("prisma/migrations", directory, "migration.sql"), "utf8").includes('CREATE TABLE "StudentImportBatch"'));
assert.ok(receiptMigration, "receipt migration exists");
const tables = ["User", "Group", "Student", "_GroupToStudent", "Event", "Record", "AttendanceChange"];
async function snapshots(pool) {
  const result = {};
  for (const table of tables) result[table] = (await pool.query(`SELECT to_jsonb(t) AS data FROM "${table}" t ORDER BY to_jsonb(t)::text`)).rows.map((r) => r.data);
  return result;
}
async function indexEvidence(pool) {
  const { rows } = await pool.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='StudentImportBatch' ORDER BY indexname");
  assert.ok(rows.some((r) => r.indexdef.includes("UNIQUE") && r.indexdef.includes('"actorId", "commandId"')));
  assert.ok(rows.some((r) => r.indexdef.includes('"committedAt", id')));
  const { rows: columns } = await pool.query("SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='StudentImportBatch' AND column_name='result'");
  assert.equal(columns[0].data_type, "jsonb");
  return rows;
}
function cli(...args) {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/backups/cli.ts", ...args], {
    encoding: "utf8", timeout: 120000,
    env: { ...process.env, DATABASE_URL: url.toString(), DIRECT_URL: url.toString(), AUTH_SECRET: "import-backup-disposable-secret", BACKUP_DIR: backupDir, BACKUP_SOURCE_LABEL: "Disposable import receipt", BACKUP_RETENTION_CONFIRMED: "true", BACKUP_PG_DUMP_PATH: process.env.BACKUP_PG_DUMP_PATH ?? "/tmp/student-import-pg17-tools/pg_dump", BACKUP_PG_RESTORE_PATH: process.env.BACKUP_PG_RESTORE_PATH ?? "/tmp/student-import-pg17-tools/pg_restore" },
  });
  assert.equal(result.status, 0, `backup ${args[0]} failed: ${result.stderr || result.stdout}`);
  const start = Math.min(...["{", "["].map((character) => { const index = result.stdout.indexOf(character); return index < 0 ? Infinity : index; }));
  return JSON.parse(result.stdout.slice(start));
}
async function drop(name) {
  assert.ok(/^(?:test_import_upgrade_|eas_restore_)[a-z0-9_]+$/.test(name));
  await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [name]);
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
}
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  for (const directory of migrations.filter((directory) => directory < receiptMigration)) await target.query(readFileSync(join("prisma/migrations", directory, "migration.sql"), "utf8"));
  await target.query(`INSERT INTO "User" (id,name,email,password,role,status,"updatedAt") VALUES ('durability-admin','Historical Admin','durability@example.test','fixture','ADMIN','ACTIVE',NOW())`);
  await target.query(`INSERT INTO "Group" (id,name,slug,category,"updatedAt") VALUES ('durability-section','Durability Section','durability-section','SECTION',NOW())`);
  await target.query(`INSERT INTO "Student" (id,"firstName","lastName","yearLevel","schoolLevel","updatedAt") VALUES ('00000123900','Historical','Student','YEAR_1','COLLEGE',NOW())`);
  await target.query(`INSERT INTO "_GroupToStudent" ("A","B") VALUES ('durability-section','00000123900')`);
  await target.query(`INSERT INTO "Event" (id,title,category,status,start,"end","updatedAt","createdById") VALUES ('durability-event','Historical event','ALL','APPROVED','2026-09-29T00:00:00Z','2026-09-30T00:00:00Z',NOW(),'durability-admin')`);
  await target.query(`INSERT INTO "Record" (id,"eventId","studentId",method,timein,timeout,"updatedAt") VALUES ('durability-record','durability-event','00000123900','SCANNED',NULL,'2026-09-29T01:00:00Z',NOW())`);
  await target.query(`INSERT INTO "AttendanceChange" ("eventId","studentId","recordId",action,"eventTitle","studentLabel") VALUES ('durability-event','00000123900','durability-record','VOID','Historical event','Historical Student')`);
  const before = await snapshots(target);
  await target.query(readFileSync(join("prisma/migrations", receiptMigration, "migration.sql"), "utf8"));
  assert.deepEqual(await snapshots(target), before, "additive upgrade preserves every seeded pre-feature row and relation");
  assert.equal((await target.query('SELECT COUNT(*)::int AS n FROM "StudentImportBatch"')).rows[0].n, 0, "no receipts fabricated for old imports");
  const indexes = await indexEvidence(target);
  fresh = await createDisposableDatabase("test_import_fresh");
  const freshPool = new Pool({ connectionString: fresh.url });
  try { await indexEvidence(freshPool); } finally { await freshPool.end(); }
  console.log("Fresh real migrations and populated #99 upgrade preserve roster, Group joins, attendance and history; receipt indexes/JSONB exist with zero backfill.");

  const commandId = randomUUID();
  const result = { v: 1, rows: [{ csvRow: 2, studentId: "00000123900", status: "UNCHANGED" }] };
  const hash = "a".repeat(64);
  const insert = 'INSERT INTO "StudentImportBatch" (id,"commandId","actorId","actorNameSnapshot","fileName","sourceFileHash","normalizedInputHash","requestHash","totalRows","createdCount","updatedCount","unchangedCount",result,"contractVersion","createdAt","committedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,0,0,1,$9,1,$10,$10)';
  const values = ["durability-receipt", commandId, "durability-admin", "Historical Admin", "restored-roster.csv", hash, "b".repeat(64), "c".repeat(64), JSON.stringify(result), "2026-09-30T00:00:00.000Z"];
  await target.query(insert, values);
  await assert.rejects(target.query(insert, ["collision", ...values.slice(1)]), (error) => error.code === "23505");
  await target.query(insert, ["other-actor-receipt", commandId, "another-admin", ...values.slice(3)]);
  const originalReceipts = (await target.query('SELECT to_jsonb(t) AS data FROM "StudentImportBatch" t ORDER BY id')).rows.map((r) => r.data);
  assert.deepEqual(originalReceipts[0].result, result, "JSONB historical result round-trips exactly");
  receiptResultSchema.parse(originalReceipts[0].result);
  for (const receipt of originalReceipts) receiptSchema.parse({
    v: receipt.contractVersion, id: receipt.id, commandId: receipt.commandId,
    actorId: receipt.actorId, actorNameSnapshot: receipt.actorNameSnapshot,
    fileName: receipt.fileName, sourceFileHash: receipt.sourceFileHash,
    normalizedInputHash: receipt.normalizedInputHash, requestHash: receipt.requestHash,
    counts: { total: receipt.totalRows, create: receipt.createdCount, update: receipt.updatedCount, unchanged: receipt.unchangedCount, blocked: 0 },
    createdAt: new Date(receipt.createdAt).toISOString(), committedAt: new Date(receipt.committedAt).toISOString(), result: receipt.result,
  });
  const queued = cli("request", "--kind", "manual");
  const captured = cli("run", "--job", queued.id); assert.equal(captured.ok, true);
  const verified = cli("verify", captured.artifactId, "--keep"); assert.equal(verified.ok, true); restoredName = verified.targetDb;
  const restoredUrl = new URL(maintenance); restoredUrl.pathname = `/${restoredName}`;
  restored = new Pool({ connectionString: restoredUrl.toString() });
  assert.deepEqual(await snapshots(restored), before, "whole-database dump restores all pre-feature data");
  assert.deepEqual((await restored.query('SELECT to_jsonb(t) AS data FROM "StudentImportBatch" t ORDER BY id')).rows.map((r) => r.data), originalReceipts, "whole-database backup preserves every receipt field/result/hash/timestamp");
  assert.deepEqual(await indexEvidence(restored), indexes);
  console.log("Real PostgreSQL17 whole-database custom dump/isolated restore preserves exact receipts, actor-command uniqueness, JSONB, hashes and indexes.");
} finally {
  await restored?.end(); if (restoredName) await drop(restoredName);
  await target.end(); await drop(name); await fresh?.cleanup(); await admin.end(); rmSync(backupDir, { recursive: true, force: true });
}
