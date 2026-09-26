import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const { Pool } = pg;
const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl || !/^postgres(ql)?:\/\//.test(adminUrl)) throw new Error("TEST_DATABASE_URL must name a PostgreSQL maintenance database");
const name = `test_issue48_upgrade_${randomBytes(5).toString("hex")}`;
const targetUrl = new URL(adminUrl);
targetUrl.pathname = `/${name}`;
const admin = new Pool({ connectionString: adminUrl });
let target;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  target = new Pool({ connectionString: targetUrl.toString() });
  const baseline = readFileSync(join(process.cwd(), "prisma/migrations/20260926075853_init_postgres_baseline/migration.sql"), "utf8");
  const change = readFileSync(join(process.cwd(), "prisma/migrations/20260926100000_attendance_change_history/migration.sql"), "utf8");
  await target.query(baseline);
  await target.query(`INSERT INTO "Event" (id, title, category, status, start, "end", "updatedAt")
    VALUES ('event-1', 'Historical event', 'ALL', 'APPROVED', '2026-09-25T00:00:00Z', '2026-09-26T00:00:00Z', NOW())`);
  await target.query(`INSERT INTO "Student" (id, "firstName", "lastName", "yearLevel", "schoolLevel", "updatedAt")
    VALUES ('student-1', 'Juan', 'Cruz', 'YEAR_1', 'COLLEGE', NOW())`);
  await target.query(`INSERT INTO "Record" (id, "eventId", "studentId", method, timein, timeout, "updatedAt")
    VALUES ('record-1', 'event-1', 'student-1', 'SCANNED', NULL, '2026-09-25T01:00:00Z', NOW())`);
  await target.query(change);
  const record = (await target.query('SELECT id, "eventId", "studentId", method, timein, timeout, revision FROM "Record" WHERE id = $1', ["record-1"])).rows[0];
  assert.equal(record.id, "record-1");
  assert.equal(record.revision, 0);
  assert.equal(record.timein, null);
  assert.equal(record.timeout.toISOString(), "2026-09-25T01:00:00.000Z");
  assert.equal((await target.query('SELECT COUNT(*)::int AS n FROM "AttendanceChange"')).rows[0].n, 0);
  await target.query(`INSERT INTO "AttendanceChange" ("eventId", "studentId", "recordId", action, "eventTitle", "studentLabel")
    VALUES ('event-1', 'student-1', 'record-1', 'VOID', 'Historical event', 'Juan Cruz')`);
  await target.query('DELETE FROM "Record" WHERE id = $1', ["record-1"]);
  await assert.rejects(target.query('DELETE FROM "Event" WHERE id = $1', ["event-1"]), (error) => error.code === "23503");
  await assert.rejects(target.query('DELETE FROM "Student" WHERE id = $1', ["student-1"]), (error) => error.code === "23503");
  console.log("PostgreSQL populated upgrade preserved timeout-only evidence at revision zero and retained history-only parents.");
} finally {
  await target?.end();
  await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [name]);
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.end();
}
