import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Client} from 'pg';
import {createServer,connect} from 'node:net';
import {spawnSync} from 'node:child_process';
import {createDisposableDatabase} from './pg-test-db.mjs';
import fixtureModule from './uswag/setup-fixture.test-support.ts';
import setupModule from './uswag/setup-db.ts';
import inputModule from './uswag/setup-input.ts';
import lockModule from '../globals/utils/pgLocks.ts';
const {createFixture}=fixtureModule;
const {executeSetup}=setupModule;
const {loadSetupInput}=inputModule;
const {ROSTER_SHARED_KEY}=lockModule;

// No test may create a database until the explicit maintenance endpoint is local.
const admin=new URL(process.env.TEST_DATABASE_URL||'invalid:');
if(!['127.0.0.1','localhost','[::1]'].includes(admin.hostname)||admin.pathname!=='/postgres')throw new Error('Set explicit local TEST_DATABASE_URL ending /postgres.');
const directory=mkdtempSync(join(tmpdir(),'uswag-integration-'));
const fixture=await createFixture(directory);
let sequence=0;
const options=(db,extra={})=>({inputDir:fixture.inputDir,groupApprovals:fixture.approvalsPath,databaseUrl:db.url,report:join(directory,`report-${++sequence}.json`),...extra});
const apply=(db,review,extra={})=>executeSetup(options(db,{apply:true,approvalReport:review.reportPath,backupConfirmed:true,...extra}));
async function connected(db,fn){const c=new Client({connectionString:db.url});await c.connect();try{return await fn(c);}finally{await c.end();}}
async function snapshot(db){return connected(db,async c=>(await c.query(`SELECT json_build_object('students',(SELECT json_agg(s ORDER BY id) FROM "Student" s),'groups',(SELECT json_agg(g ORDER BY id) FROM "Group" g),'memberships',(SELECT json_agg(m ORDER BY "studentId") FROM "CustomGroupMembership" m),'joins',(SELECT json_agg(j ORDER BY "A","B") FROM "_GroupToStudent" j),'records',(SELECT json_agg(r ORDER BY id) FROM "Record" r)) AS value`)).rows[0].value);}

test('single command plans and atomically applies all prerequisites, then preserves IDs, positions and timestamps',async t=>{
 const db=await createDisposableDatabase('test_uswag_new');
 try{
  const version=await connected(db,c=>c.query('SHOW server_version'));t.diagnostic(JSON.stringify({database:db.dbName,serverVersion:version.rows[0].server_version,endpoint:'explicit-local-loopback',migrated:true}));
  const before=await snapshot(db);const review=await executeSetup(options(db));assert.deepEqual(await snapshot(db),before);
  assert.equal(review.counts.sourceRows,95);assert.equal(review.counts.approved,94);assert.equal(review.counts.held,1);
  assert.equal(review.counts.studentsCreated,94);assert.equal(review.groups.length,74);assert.equal(statSync(review.reportPath).mode&0o777,0o600);
  const result=await apply(db,review);assert.equal(result.outcome,'committed');
  const after=await snapshot(db);assert.equal(after.students.length,94);assert.equal(after.groups.length,74);assert.equal(after.memberships.length,94);
  assert.ok(result.students.every(s=>after.students.some(actual=>actual.id===s.id)));
  assert.ok(result.groups.every(g=>after.groups.some(actual=>actual.id===g.id)));
  assert.ok(result.memberships.every(m=>after.memberships.some(actual=>actual.studentId===m.studentId)));
  assert.deepEqual(result.groupCounts.map(x=>x.approved),[13,26,14,11,13,12,5]);
  const next=await executeSetup(options(db));assert.equal(next.counts.studentsUnchanged,94);assert.equal(next.counts.membershipsUnchanged,94);
  await apply(db,next);assert.deepEqual(await snapshot(db),after);
  await assert.rejects(()=>apply(db,review),/STALE_REVIEW/);assert.deepEqual(await snapshot(db),after);
 }finally{await db.cleanup();}
});
test('operator CLI performs dry-run and reviewed apply through the dedicated package command',async()=>{
 const db=await createDisposableDatabase('test_uswag_cli');try{
  const reviewPath=join(directory,'cli-review.json'),completionPath=join(directory,'cli-completion.json');
  const common=['uswag:setup','--input-dir',fixture.inputDir,'--group-approvals',fixture.approvalsPath,'--database-env','USWAG_SETUP_TEST_TARGET'];
  const invoke=args=>spawnSync('pnpm',[...common,...args],{encoding:'utf8',env:{...process.env,USWAG_SETUP_TEST_TARGET:db.url}});
  const review=invoke(['--dry-run','--report',reviewPath]);assert.equal(review.status,0,review.stderr);assert.match(review.stdout,/"studentsCreated": 94/);assert.equal((await snapshot(db)).students,null);
  const applied=invoke(['--apply','--approval-report',reviewPath,'--backup-confirmed','--report',completionPath]);assert.equal(applied.status,0,applied.stderr);assert.match(applied.stdout,/"outcome": "committed"/);assert.equal((await snapshot(db)).students.length,94);
  assert.doesNotMatch(applied.stdout,/Student1|26000000001/);
 }finally{await db.cleanup();}
});
test('pending academic approvals block every write including groups',async()=>{
 const db=await createDisposableDatabase('test_uswag_pending');try{
  const review=await executeSetup(options(db,{groupApprovals:undefined}));assert.ok(review.blockers.length);const before=await snapshot(db);
  await assert.rejects(()=>apply(db,review,{groupApprovals:undefined}),/BLOCKED_PLAN/);assert.deepEqual(await snapshot(db),before);
 }finally{await db.cleanup();}
});
test('concurrent change invalidates review, and a database failure rolls back the whole transaction',async()=>{
 const db=await createDisposableDatabase('test_uswag_rollback');try{
  const review=await executeSetup(options(db));
  await connected(db,c=>c.query(`CREATE FUNCTION reject_officers() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$; CREATE TRIGGER reject_officers BEFORE INSERT ON "CustomGroupMembership" FOR EACH ROW EXECUTE FUNCTION reject_officers()`));
  const before=await snapshot(db);await assert.rejects(()=>apply(db,review),/APPLY_ROLLED_BACK/);assert.deepEqual(await snapshot(db),before);
  await connected(db,c=>c.query('DROP TRIGGER reject_officers ON "CustomGroupMembership"'));
  const fresh=await executeSetup(options(db));await connected(db,c=>c.query(`INSERT INTO "Group" (id,name,slug,category,"updatedAt") VALUES ('changed','Concurrent','concurrent','SECTION',now())`));
  await assert.rejects(()=>apply(db,fresh),/STALE_REVIEW/);
 }finally{await db.cleanup();}
});
test('mixed existing/new students preserve QR IDs, blank optional fields, unrelated joins and attendance',async()=>{
 const db=await createDisposableDatabase('test_uswag_mixed');try{
  const input=loadSetupInput(fixture.inputDir,fixture.approvalsPath);
  await connected(db,async c=>{
   await c.query(`INSERT INTO "Group" (id,name,slug,category,"updatedAt") VALUES ('year','Unrelated year','unrelated-year','YEAR',now()),('house','Azul','azul','HOUSE',now()),('other','Other organization','custom-other','CUSTOM',now())`);
   for(const [index,row] of input.rows.slice(0,47).entries()){
    const s=row.student;await c.query('INSERT INTO "Student" (id,usn,lrn,"firstName","lastName","middleName","schoolLevel","yearLevel","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[`existing-${index}`,s.usn,index===0?'123456789012':null,s.firstName,s.lastName,index===0?'Preserved':null,s.schoolLevel,s.yearLevel,'2020-01-01T00:00:00Z']);
    await c.query('INSERT INTO "_GroupToStudent" ("A","B") VALUES ($1,$2)',['year',`existing-${index}`]);
   }
   await c.query(`INSERT INTO "_GroupToStudent" ("A","B") VALUES ('house','existing-0'); INSERT INTO "Student" (id,usn,"firstName","lastName","updatedAt") VALUES ('unrelated','99000000000','Other','Synthetic',now()); INSERT INTO "CustomGroupMembership" ("studentId","groupId",position,"updatedAt") VALUES ('unrelated','other','Unchanged position',now()); INSERT INTO "Event" (id,title,category,start,"end",status,"updatedAt") VALUES ('history','History','ALL',now(),now(),'APPROVED',now()); INSERT INTO "Record" (id,"eventId","studentId",method,timein,"updatedAt") VALUES ('attendance','history','existing-0','SCANNED',now(),now())`);
  });
  const before=await snapshot(db);const review=await executeSetup(options(db));assert.equal(review.counts.studentsCreated,47);assert.equal(review.counts.studentsUpdated,47);
  await apply(db,review);const after=await snapshot(db);
  assert.equal(after.students.length,95);assert.deepEqual(after.records,before.records);
  for(let i=0;i<47;i++)assert.ok(after.students.some(s=>s.id===`existing-${i}`&&s.usn===input.rows[i].student.usn));
  const first=after.students.find(s=>s.id==='existing-0');assert.equal(first.middleName,'Preserved');assert.equal(first.lrn,'123456789012');assert.ok(after.joins.some(j=>j.A==='house'&&j.B==='existing-0'));
  assert.equal(after.joins.filter(j=>j.A==='year').length,47);assert.deepEqual(after.memberships.find(m=>m.studentId==='unrelated'),before.memberships[0]);
  const next=await executeSetup(options(db));assert.equal(next.counts.studentsUnchanged,94);await apply(db,next);assert.deepEqual(await snapshot(db),after);
 }finally{await db.cleanup();}
});
test('creates an authorized draft, reuses it, checks actual eligibility and exposes workbook positions',async()=>{
 const db=await createDisposableDatabase('test_uswag_event');try{
  await connected(db,c=>c.query(`INSERT INTO "User" (id,name,email,password,role,status,"updatedAt") VALUES ('owner','Synthetic owner','synthetic@example.test','unused','ORGANIZER','ACTIVE',now())`));
  const eventOptions={create:{title:'Officer gathering',ownerId:'owner',location:'Synthetic hall',start:'2026-11-01T09:00:00+08:00',end:'2026-11-01T10:00:00+08:00'}};
  const review=await executeSetup(options(db,{eventOptions}));assert.equal(review.event.action,'create');const completion=await apply(db,review,{eventOptions});
  const events=await connected(db,c=>c.query('SELECT * FROM "Event"'));assert.equal(events.rows.length,1);assert.equal(events.rows[0].status,'DRAFT');assert.equal(events.rows[0].createdById,'owner');
  assert.equal(completion.event.id,events.rows[0].id);
  const next=await executeSetup(options(db,{eventOptions}));assert.equal(next.event.action,'reuse');await apply(db,next,{eventOptions});assert.equal((await connected(db,c=>c.query('SELECT * FROM "Event"'))).rows.length,1);
  await connected(db,c=>c.query('UPDATE "Event" SET status=\'APPROVED\' WHERE id=$1',[events.rows[0].id]));
  const ready=await executeSetup(options(db,{eventOptions:{id:events.rows[0].id}}));assert.equal(ready.event.readiness,'ready');
  const printed=await connected(db,c=>c.query(`SELECT s.usn,m.position,g.name FROM "Student" s JOIN "CustomGroupMembership" m ON m."studentId"=s.id JOIN "Group" g ON g.id=m."groupId" JOIN "_EventGroups" e ON e."B"=g.id WHERE e."A"=$1`,[events.rows[0].id]));
  const input=loadSetupInput(fixture.inputDir,fixture.approvalsPath);assert.equal(printed.rows.length,94);
  for(const r of input.rows)assert.ok(printed.rows.some(p=>p.usn===r.student.usn&&p.position===r.position&&p.name===r.group));
 }finally{await db.cleanup();}
});
test('interrupted transaction preserves all preexisting rows and reports rollback uncertainty honestly',async()=>{
 const db=await createDisposableDatabase('test_uswag_interrupt');try{
  const review=await executeSetup(options(db));
  await connected(db,c=>c.query(`CREATE FUNCTION interrupt_setup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_terminate_backend(pg_backend_pid()); RETURN NEW; END $$; CREATE TRIGGER interrupt_setup BEFORE INSERT ON "CustomGroupMembership" FOR EACH ROW EXECUTE FUNCTION interrupt_setup()`));
  const before=await snapshot(db);const config=options(db,{apply:true,approvalReport:review.reportPath,backupConfirmed:true});
  await assert.rejects(()=>executeSetup(config),/APPLY_ROLLBACK_UNCONFIRMED/);assert.deepEqual(await snapshot(db),before);
  assert.equal(JSON.parse(readFileSync(config.report,'utf8')).outcome,'rollback-unconfirmed');
 }finally{await db.cleanup();}
});
test('lost COMMIT response reports unknown outcome even when the database committed successfully',async()=>{
 const db=await createDisposableDatabase('test_uswag_commit');let server;const sockets=new Set();
 try{
  let armed=false;
  server=createServer(socket=>{
   sockets.add(socket);const upstream=connect({host:'127.0.0.1',port:Number(new URL(db.url).port)||5432});sockets.add(upstream);let commitSent=false;
   socket.on('data',data=>{if(armed&&data.includes(Buffer.from('COMMIT\0')))commitSent=true;upstream.write(data);});
   upstream.on('data',data=>{if(commitSent){socket.destroy();upstream.destroy();}else socket.write(data);});
   socket.on('error',()=>undefined);upstream.on('error',()=>socket.destroy());socket.on('close',()=>{sockets.delete(socket);upstream.destroy();});upstream.on('close',()=>{sockets.delete(upstream);socket.destroy();});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const proxyUrl=new URL(db.url);proxyUrl.port=String(server.address().port);const proxied={url:proxyUrl.toString()};
  const review=await executeSetup(options(proxied));armed=true;
  const config=options(proxied,{apply:true,approvalReport:review.reportPath,backupConfirmed:true});
  await assert.rejects(()=>executeSetup(config),/COMMIT_OUTCOME_UNKNOWN/);
  const recoveryReport=JSON.parse(readFileSync(config.report,'utf8'));assert.equal(recoveryReport.outcome,'unknown-commit');assert.equal(recoveryReport.errorCode,'COMMIT_OUTCOME_UNKNOWN');assert.equal((await snapshot(db)).students.length,94);
  armed=false;const recovery=await executeSetup(options(proxied));assert.equal(recovery.counts.studentsUnchanged,94);
 }finally{for(const socket of sockets)socket.destroy();if(server)await new Promise(resolve=>server.close(resolve));await db.cleanup();}
});
test('rebuilds review after waiting for the shared application roster lock',async()=>{
 const db=await createDisposableDatabase('test_uswag_lock');try{
  const review=await executeSetup(options(db));
  await connected(db,async c=>{
   await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock_shared($1)',[ROSTER_SHARED_KEY]);
   const pending=apply(db,review).then(value=>({value}),error=>({error}));
   let waiting=false;const deadline=Date.now()+10000;
   while(Date.now()<deadline){
    await c.query('SELECT pg_stat_clear_snapshot()');
    const rows=(await c.query(`SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND wait_event='advisory'`,[db.dbName])).rows;
    if(rows.length){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,20));
   }
   await c.query(`INSERT INTO "Group" (id,name,slug,category,"updatedAt") VALUES ('concurrent','Concurrent group','concurrent-group','SECTION',now())`);await c.query('COMMIT');
   const result=await pending;assert.ok(waiting,'apply must wait on existing shared roster lock');assert.match(result.error?.message??'',/STALE_REVIEW/);
  });
  assert.equal((await snapshot(db)).students,null);
 }finally{await db.cleanup();}
});
