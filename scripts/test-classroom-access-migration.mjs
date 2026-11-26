import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';

const maintenance = process.env.TEST_DATABASE_URL;
assert.ok(maintenance?.startsWith('postgresql://'), 'TEST_DATABASE_URL must name an explicit disposable-database maintenance endpoint');
assert.ok(!['event_attendance_dev', 'event_attendance_prod'].includes(new URL(maintenance).pathname.slice(1)));
const name = `test_classroom_upgrade_${randomBytes(8).toString('hex')}`;
assert.match(name, /^test_[a-z0-9_]+$/);
const admin = new Pool({ connectionString: maintenance });
let connection;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(maintenance); url.pathname = `/${name}`;
  connection = new Pool({ connectionString: url.toString() });
  assert.equal((await connection.query('SELECT current_database() AS db')).rows[0].db, name);
  const apply = migration => {
    const run = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', join('prisma/migrations', migration, 'migration.sql')], { env: { ...process.env, PGDATABASE: name, PGHOST: url.searchParams.get('host') || url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: url.searchParams.get('sslmode') || 'prefer' }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
  };
  const migrations = readdirSync('prisma/migrations').filter(v => /^\d/.test(v)).sort();
  for (const migration of migrations.filter(v => v < '20261102120000_classroom_access')) apply(migration);
  await connection.query(`INSERT INTO "User" (id,name,email,password,role,status,"updatedAt") VALUES ('legacy-organizer','Organizer','legacy@example.test','test','ORGANIZER','ACTIVE',now())`);
  await connection.query(`INSERT INTO "Student" (id,usn,"firstName","lastName","updatedAt") VALUES ('00000123456','00000123456','Legacy','Student',now())`);
  await connection.query(`INSERT INTO "Event" (id,title,category,status,start,"end","createdById","updatedAt") VALUES ('legacy-event','Existing Event','ALL','APPROVED',now(),now()+interval '1 hour','legacy-organizer',now())`);
  await connection.query(`INSERT INTO "Record" (id,"eventId","studentId",method,timein,"updatedAt") VALUES ('legacy-record','legacy-event','00000123456','SCANNED',now(),now())`);
  const snapshot = async table => (await connection.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY id) AS rows FROM "${table}" t`)).rows[0].rows;
  const before = { student: await snapshot('Student'), event: await snapshot('Event'), record: await snapshot('Record') };
  apply('20261102120000_classroom_access');
  assert.deepEqual(await snapshot('Student'), before.student);
  assert.deepEqual(await snapshot('Event'), before.event);
  assert.deepEqual(await snapshot('Record'), before.record);
  const user = (await connection.query(`SELECT role,status,"accountState" FROM "User" WHERE id='legacy-organizer'`)).rows[0];
  assert.deepEqual(user, { role: 'ORGANIZER', status: 'ACTIVE', accountState: 'ENABLED' });
  assert.equal((await connection.query('SELECT count(*)::int AS n FROM "ClassroomMembership"')).rows[0].n, 0);
  console.log('PASS M1 upgrades baseline with unchanged Events/Student/Record data and no implicit teacher approvals.');
} finally {
  await connection?.end();
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name]);
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.end();
}
