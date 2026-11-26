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
const name = `test_identity_upgrade_${randomBytes(8).toString('hex')}`;
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
  for (const migration of migrations.filter(v => v < '20261102140000_student_identity_history')) apply(migration);
  await connection.query(`INSERT INTO "User" (id,name,email,password,role,status,"updatedAt") VALUES ('organizer','Organizer','identity@example.test','test','ORGANIZER','ACTIVE',now())`);
  await connection.query(`INSERT INTO "Student" (id,usn,"firstName","lastName","updatedAt") VALUES ('00000111111','00000222222','Legacy','Student',now()),('collision-person','00000111111','Other','Student',now())`);
  await connection.query(`INSERT INTO "Event" (id,title,category,status,start,"end","createdById","updatedAt") VALUES ('event','Existing Event','ALL','APPROVED',now(),now()+interval '1 hour','organizer',now())`);
  await connection.query(`INSERT INTO "Record" (id,"eventId","studentId",method,timein,"updatedAt") VALUES ('record','event','00000111111','SCANNED',now(),now())`);
  const historicalReceipt={v:2,rows:[{csvRow:2,studentId:'deleted-owner',status:'CREATE',student:{id:'deleted-owner',usn:'00000222222',lrn:'000000999999',firstName:'Historical',lastName:'Owner',middleName:'',schoolLevel:'',yearLevel:'',section:'',house:'',program:'',department:'',strand:''}}]};
  await connection.query(`INSERT INTO "StudentImportBatch" (id,"commandId","actorId","actorNameSnapshot","fileName","sourceFileHash","normalizedInputHash","requestHash","totalRows","createdCount","updatedCount","unchangedCount",result,"contractVersion","committedAt") VALUES ('historical-receipt','00000000-0000-4000-8000-000000000001','organizer','Organizer','history.csv',$1,$1,$1,1,1,0,0,$2::jsonb,2,now())`,['a'.repeat(64),JSON.stringify(historicalReceipt)]);
  const snapshot=async table=>(await connection.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY id) AS rows FROM "${table}" t`)).rows[0].rows;
  const students=await snapshot('Student'),events=await snapshot('Event'),records=await snapshot('Record');
  const preAudit=spawnSync('pnpm',['exec','tsx','scripts/audit-qr-reservations.ts'],{env:{...process.env,DATABASE_URL:url.toString(),DIRECT_URL:url.toString()},encoding:'utf8'});
  assert.equal(preAudit.status,1,preAudit.stderr);const preAuditResult=JSON.parse(preAudit.stdout.trim());assert.equal(preAuditResult.schemaReady,false);assert.ok(preAuditResult.historicalClaims>0);
  apply('20261102140000_student_identity_history');
  const after=(await snapshot('Student')).map(({profileRevision,archivedAt,...student})=>{assert.equal(profileRevision,0);assert.equal(archivedAt,null);return student;});
  assert.deepEqual(after,students);assert.deepEqual(await snapshot('Event'),events);assert.deepEqual(await snapshot('Record'),records);
  const collision=(await connection.query(`SELECT * FROM "StudentQrCode" WHERE code='00000111111'`)).rows[0];
  const oldCode=(await connection.query(`SELECT * FROM "StudentQrCode" WHERE code='000000999999'`)).rows[0];assert.equal(oldCode.state,'QUARANTINED');assert.equal(oldCode.studentId,null);
  assert.equal((await connection.query(`SELECT state FROM "StudentQrCode" WHERE code='00000222222'`)).rows[0].state,'QUARANTINED','historical owner disagreement must block a current claimant too');
  assert.equal(collision.state,'QUARANTINED');assert.equal(collision.studentId,null);assert.deepEqual(collision.candidateEvidence.sort(),['00000111111','collision-person']);
  assert.equal((await connection.query(`SELECT count(*)::int AS n FROM "StudentProfileChange" WHERE source='BASELINE'`)).rows[0].n,2);
  assert.equal((await connection.query('SELECT count(*)::int AS n FROM "StudentVerification"')).rows[0].n,0);
  await connection.query(`UPDATE "Student" SET "firstName"='Verified spelling' WHERE id='00000111111'`);
  await assert.rejects(connection.query(`INSERT INTO "Student" (id,usn,"firstName","lastName","updatedAt") VALUES ('new-person','00000111111','Wrong','Owner',now())`));
  await connection.query(`UPDATE "Student" SET usn='00000333333' WHERE id='collision-person'`);
  assert.equal((await connection.query(`SELECT state FROM "StudentQrCode" WHERE code='00000111111'`)).rows[0].state,'QUARANTINED');
  await assert.rejects(connection.query(`UPDATE "Student" SET usn='00000111111' WHERE id='00000111111'`),'a quarantined internal-only code cannot become a new external claim');
  assert.equal((await connection.query('SELECT count(*)::int AS n FROM "StudentProfilePending"')).rows[0].n,0);
  console.log('PASS M2 unchanged Events/stable IDs, labeled baseline, conflict quarantine, no inferred verification, and raw SQL consistency guards.');
} finally {
  await connection?.end();
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name]);
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.end();
}
