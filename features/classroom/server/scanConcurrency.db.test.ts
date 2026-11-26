import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { before,after,test } from 'node:test';
import { Pool } from 'pg';
import { getPgPoolConfig } from '@/globals/libs/dbConfig';
import { createDisposableDb,createTestClient } from '@/globals/libs/testDb';
import { classroomAttendancePairKey } from '@/globals/utils/pgLocks';
import { createAcademicTerm,createSubject } from './catalog';
import { createClassOffering,transferClassOwner } from './classes';
import { reviewTeacherApplication } from './applications';
import { getClassroomStartPreview,startClassroomSession,finalizeClassroomSession,cancelClassroomSession,amendSessionPolicy,getSessionRoster } from './sessions';
import { recordClassroomScan,setClassroomAttendance,adjustSessionRoster,readAttendanceCommand } from './attendance';
let fixture:Awaited<ReturnType<typeof createDisposableDb>>;let client:ReturnType<typeof createTestClient>;let termId:string;let subjectId:string;
const actor={userId:'teacher',credentialVersion:0};const other={userId:'other-teacher',credentialVersion:0};const admin={userId:'admin',credentialVersion:0};
type Outcome<T>={value:T}|{error:unknown};
const observe=<T,>(promise:Promise<T>):Promise<Outcome<T>>=>promise.then(value=>({value}),(error:unknown)=>({error}));
async function valueOf<T>(promise:Promise<Outcome<T>>){const result=await promise;if('error'in result)throw result.error;return result.value;}
before(async()=>{
 fixture=await createDisposableDb();client=createTestClient(fixture.url);
 for(const user of [actor,other,admin]){await client.db.user.create({data:{id:user.userId,name:user.userId,email:user.userId+'@example.test',password:'test',role:user===admin?'ADMIN':'MEMBER',status:user===admin?'ACTIVE':'PENDING'}});if(user!==admin)await client.db.classroomMembership.create({data:{userId:user.userId,status:'APPROVED',departmentOrDesignation:'Teacher'}});}
 for(const id of ['section','outside'])await client.db.group.create({data:{id,name:id,slug:id,category:'SECTION'}});
 for(const id of ['a','b','c','visitor'])await client.db.student.create({data:{id,firstName:'Student',lastName:id,groups:{connect:{id:id==='visitor'?'outside':'section'}}}});
 const year=new Date().getUTCFullYear();termId=(await createAcademicTerm(client.db,actor,{commandId:randomUUID(),name:'Term',startDate:(year-1)+'-01-01',endDate:(year+1)+'-12-31'})).data.id;
 subjectId=(await createSubject(client.db,actor,{commandId:randomUUID(),title:'Programming'})).data.id;
});
after(async()=>{await client?.disconnect();await fixture?.cleanup();});
async function newSession(minutesAgo=0){
 const offering=(await createClassOffering(client.db,actor,{commandId:randomUUID(),termId,subjectId,displayName:randomUUID(),sectionIds:['section'],exceptions:[]})).data;
 const preview=await getClassroomStartPreview(client.db,actor,offering.id);const scheduledStartAt=new Date(Date.now()-minutesAgo*60000).toISOString();
 const session=(await startClassroomSession(client.db,actor,offering.id,{commandId:randomUUID(),scheduledStartAt,expectedConfigRevision:0,expectedRosterRevision:0,expectedRosterFingerprint:preview.rosterFingerprint})).data;
 return {classId:offering.id,id:session.id,scheduledStartAt};
}
function tagged(label:string){const name=label+'-'+randomUUID();const url=new URL(fixture.url);url.searchParams.set('application_name',name);return {name,...createTestClient(url.toString())};}
async function waitForBlocked(name:string){
 const deadline=Date.now()+1200;
 for(;;){const rows=await client.db.$queryRaw<Array<{waiting:boolean}>>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${name} AND wait_event_type='Lock') AS waiting`;if(rows[0].waiting)return;if(Date.now()>deadline)throw new Error('Expected PostgreSQL lock barrier: '+name);await delay(10);}
}
async function pairBarrier(sessionId:string,studentId:string){
 const pool=new Pool(getPgPoolConfig(fixture.url));const connection=await pool.connect();await connection.query('BEGIN');await connection.query('SELECT pg_advisory_xact_lock($1)',[classroomAttendancePairKey(sessionId,studentId).toString()]);
 let released=false;return {release:async()=>{if(!released){released=true;await connection.query('ROLLBACK');}},close:async()=>{if(!released)await connection.query('ROLLBACK');connection.release();await pool.end();}};
}
const scanInput=(sessionId:string,code:string)=>({sessionId,code,commandId:randomUUID()});
const finalInput=()=>({commandId:randomUUID(),expectedLifecycleRevision:0,expectedSnapshotRevision:0});

test('same-student simultaneous scans have one transition and never update a common session counter',async()=>{
 const session=await newSession();const before=await client.db.classroomSession.findUniqueOrThrow({where:{id:session.id}});
 const results=await Promise.all([recordClassroomScan(client.db,actor,scanInput(session.id,'a')),recordClassroomScan(client.db,actor,scanInput(session.id,'a'))]);
 assert.deepEqual(results.map(row=>row.data.outcome).sort(),['ALREADY_RECORDED','RECORDED']);assert.equal(await client.db.classroomAttendanceChange.count({where:{sessionId:session.id,studentId:'a'}}),1);
 const after=await client.db.classroomSession.findUniqueOrThrow({where:{id:session.id}});assert.equal(after.lifecycleRevision,0);assert.equal(after.snapshotRevision,0);assert.equal(after.updatedAt.toISOString(),before.updatedAt.toISOString());
});
test('different-student scans overlap while one pair waits; a session UPDATE would fail this barrier',async()=>{
 const session=await newSession();const blocked=tagged('blocked-scan');const gate=await pairBarrier(session.id,'a');const pending=observe(recordClassroomScan(blocked.db,actor,scanInput(session.id,'a')));let firstFinished=false;void pending.then(()=>{firstFinished=true;});
 try{await waitForBlocked(blocked.name);const second=await recordClassroomScan(client.db,actor,scanInput(session.id,'b'));assert.equal(second.data.outcome,'RECORDED');assert.equal(firstFinished,false);assert.equal((await client.db.classroomAttendance.findUniqueOrThrow({where:{sessionId_studentId:{sessionId:session.id,studentId:'a'}}})).status,'UNMARKED');await gate.release();assert.equal((await valueOf(pending)).data.outcome,'RECORDED');}
 finally{await gate.release();await pending;await gate.close();await blocked.disconnect();}
});
test('manual-versus-scan and concurrent corrections never silently overwrite a newer result',async()=>{
 const session=await newSession();
 const raced=await Promise.allSettled([recordClassroomScan(client.db,actor,scanInput(session.id,'a')),setClassroomAttendance(client.db,actor,{sessionId:session.id,studentId:'a',commandId:randomUUID(),expectedRevision:0,status:'ABSENT'})]);
 const row=await client.db.classroomAttendance.findUniqueOrThrow({where:{sessionId_studentId:{sessionId:session.id,studentId:'a'}}});assert.ok(['PRESENT','ABSENT'].includes(row.status));assert.equal(row.revision,1);assert.equal(await client.db.classroomAttendanceChange.count({where:{sessionId:session.id,studentId:'a'}}),1);
 if(row.status==='PRESENT')assert.equal(raced[1].status,'rejected');
 const corrections=await Promise.allSettled(['LATE','EXCUSED'].map(status=>setClassroomAttendance(client.db,actor,{sessionId:session.id,studentId:'a',commandId:randomUUID(),expectedRevision:1,status,reason:'Correct roll-call result'})));
 assert.equal(corrections.filter(result=>result.status==='fulfilled').length,1);assert.equal((await client.db.classroomAttendance.findUniqueOrThrow({where:{sessionId_studentId:{sessionId:session.id,studentId:'a'}}})).revision,2);
});
test('an earlier scan finishes before finalization and its receipt survives closure',async()=>{
 const session=await newSession();const scanner=tagged('scan-before-finalize');const finalizer=tagged('finalize-after-scan');const gate=await pairBarrier(session.id,'a');const command=scanInput(session.id,'a');const pendingScan=observe(recordClassroomScan(scanner.db,actor,command));let pendingFinal:Promise<Outcome<Awaited<ReturnType<typeof finalizeClassroomSession>>>>|undefined;
 try{await waitForBlocked(scanner.name);pendingFinal=observe(finalizeClassroomSession(finalizer.db,actor,session.id,finalInput()));await waitForBlocked(finalizer.name);await gate.release();const saved=await valueOf(pendingScan);const finalized=await valueOf(pendingFinal);assert.equal(finalized.data.counts.PRESENT,1);assert.equal(finalized.data.counts.ABSENT,2);assert.deepEqual((await recordClassroomScan(client.db,actor,command)).data,saved.data);}
 finally{await gate.release();await pendingScan;await pendingFinal;await gate.close();await scanner.disconnect();await finalizer.disconnect();}
});
test('a scan waiting behind finalization cannot create a late post-finalization result',async()=>{
 const session=await newSession();const pool=new Pool(getPgPoolConfig(fixture.url));const blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT "studentId" FROM "ClassroomAttendance" WHERE "sessionId"=$1 AND "studentId"=$2 FOR UPDATE',[session.id,'b']);
 const finalizer=tagged('finalize-first');const scanner=tagged('scan-after-finalize');const pendingFinal=observe(finalizeClassroomSession(finalizer.db,actor,session.id,finalInput()));let pendingScan:Promise<Outcome<Awaited<ReturnType<typeof recordClassroomScan>>>>|undefined;
 try{await waitForBlocked(finalizer.name);pendingScan=observe(recordClassroomScan(scanner.db,actor,scanInput(session.id,'a')));await waitForBlocked(scanner.name);await blocker.query('ROLLBACK');const finalized=await valueOf(pendingFinal);assert.equal(finalized.data.counts.ABSENT,3);const scan=await pendingScan;assert.ok('error'in scan);if('error'in scan)assert.equal((scan.error as {code:string}).code,'SESSION_FINALIZED');}
 finally{await blocker.query('ROLLBACK');await pendingFinal;await pendingScan;blocker.release();await pool.end();await finalizer.disconnect();await scanner.disconnect();}
});
test('cancel waits for earlier marks, retains them and creates no absences',async()=>{
 const session=await newSession();const scanner=tagged('scan-before-cancel');const canceler=tagged('cancel-after-scan');const gate=await pairBarrier(session.id,'a');const pendingScan=observe(recordClassroomScan(scanner.db,actor,scanInput(session.id,'a')));let pendingCancel:Promise<Outcome<Awaited<ReturnType<typeof cancelClassroomSession>>>>|undefined;
 try{await waitForBlocked(scanner.name);pendingCancel=observe(cancelClassroomSession(canceler.db,actor,session.id,{commandId:randomUUID(),expectedLifecycleRevision:0,reason:'Wrong meeting was started'}));await waitForBlocked(canceler.name);await gate.release();await valueOf(pendingScan);const canceled=await valueOf(pendingCancel);assert.equal(canceled.data.state,'CANCELED');assert.equal(canceled.data.counts.PRESENT,1);assert.equal(canceled.data.counts.UNMARKED,2);assert.equal(canceled.data.counts.ABSENT,0);}
 finally{await gate.release();await pendingScan;await pendingCancel;await gate.close();await scanner.disconnect();await canceler.disconnect();}
});
test('inclusion-versus-finalize and duplicate inclusion leave one coherent eligible roster',async()=>{
 const session=await newSession();
 const adjustment={sessionId:session.id,studentId:'visitor',scope:'CLASS_AND_SESSION',action:'INCLUDE',expectedSnapshotRevision:0,expectedRosterRevision:0,reason:'Irregular student enrollment',recordScan:true,code:'visitor',commandId:randomUUID()};
 const results=await Promise.allSettled([adjustSessionRoster(client.db,actor,adjustment),finalizeClassroomSession(client.db,actor,session.id,finalInput())]);
 const current=await client.db.classroomSession.findUniqueOrThrow({where:{id:session.id}});
 if(results[0].status==='fulfilled'){
  assert.equal(current.snapshotRevision,1);assert.equal(results[1].status,'rejected');await finalizeClassroomSession(client.db,actor,session.id,{...finalInput(),expectedSnapshotRevision:1});
 }else{assert.equal(current.state,'FINALIZED');assert.equal(await client.db.classRosterException.count({where:{classId:session.classId,studentId:'visitor'}}),0);}
 assert.equal((await getSessionRoster(client.db,actor,session.id)).counts.UNMARKED,0);
 const second=await newSession();const input={...adjustment,sessionId:second.id,commandId:randomUUID()};const replay=await Promise.all([adjustSessionRoster(client.db,actor,input),adjustSessionRoster(client.db,actor,input)]);assert.deepEqual(replay[0].data,replay[1].data);assert.equal(replay.filter(row=>row.replayed).length,1);assert.equal(await client.db.sessionRosterMember.count({where:{sessionId:second.id,studentId:'visitor'}}),1);
});
test('a policy amendment waits for prior scans and does not reclassify their outcomes',async()=>{
 const session=await newSession(30);const scanner=tagged('scan-old-policy');const amendment=tagged('amend-after-scan');const gate=await pairBarrier(session.id,'a');const pendingScan=observe(recordClassroomScan(scanner.db,actor,scanInput(session.id,'a')));let pendingAmendment:Promise<Outcome<Awaited<ReturnType<typeof amendSessionPolicy>>>>|undefined;
 try{await waitForBlocked(scanner.name);pendingAmendment=observe(amendSessionPolicy(amendment.db,actor,session.id,{commandId:randomUUID(),expectedLifecycleRevision:0,startAt:session.scheduledStartAt,graceMinutes:180,reason:'Correct the meeting grace period'}));await waitForBlocked(amendment.name);await gate.release();assert.equal((await valueOf(pendingScan)).data.attendance.status,'LATE');await valueOf(pendingAmendment);assert.equal((await recordClassroomScan(client.db,actor,scanInput(session.id,'b'))).data.attendance.status,'PRESENT');
  const changes=await client.db.classroomAttendanceChange.findMany({where:{sessionId:session.id},orderBy:{id:'asc'}});assert.deepEqual(changes.map(row=>(row.after as {appliedPolicy:{lifecycleRevision:number}}).appliedPolicy.lifecycleRevision),[0,1]);
 }finally{await gate.release();await pendingScan;await pendingAmendment;await gate.close();await scanner.disconnect();await amendment.disconnect();}
});

async function auditBarrier(){
 const pool=new Pool(getPgPoolConfig(fixture.url));const connection=await pool.connect();await connection.query('BEGIN');await connection.query('LOCK TABLE "ClassroomAudit" IN SHARE MODE');
 let released=false;return {release:async()=>{if(!released){released=true;await connection.query('ROLLBACK');}},close:async()=>{if(!released)await connection.query('ROLLBACK');connection.release();await pool.end();}};
}
test('committing suspension blocks queued scans and receipt reads without removing independent permissions',async()=>{
 const session=await newSession();const original=scanInput(session.id,'a');await recordClassroomScan(client.db,actor,original);
 const reviewer=tagged('suspend-before-scan');const scanner=tagged('scan-after-suspend');const gate=await auditBarrier();
 const membership=await client.db.classroomMembership.findUniqueOrThrow({where:{userId:actor.userId}});
 const review=observe(reviewTeacherApplication(reviewer.db,admin,actor.userId,{commandId:randomUUID(),expectedRevision:membership.revision,action:'SUSPEND',reason:'Investigate attendance activity'}));
 let pendingScan:Promise<Outcome<Awaited<ReturnType<typeof recordClassroomScan>>>>|undefined;
 try{
  await waitForBlocked(reviewer.name);pendingScan=observe(recordClassroomScan(scanner.db,actor,scanInput(session.id,'b')));await waitForBlocked(scanner.name);await gate.release();await valueOf(review);
  const scan=await pendingScan;assert.ok('error'in scan);if('error'in scan)assert.equal((scan.error as {code:string}).code,'CLASSROOM_SUSPENDED');
  assert.equal(await client.db.classroomAttendanceChange.count({where:{sessionId:session.id}}),1);
  await assert.rejects(readAttendanceCommand(client.db,actor,original.commandId),{code:'CLASSROOM_SUSPENDED'});
  const user=await client.db.user.findUniqueOrThrow({where:{id:actor.userId}});assert.equal(user.role,'MEMBER');assert.equal(user.status,'PENDING');assert.equal(user.accountState,'ENABLED');
 }finally{
  await gate.release();await review;await pendingScan;await gate.close();await reviewer.disconnect();await scanner.disconnect();
  const current=await client.db.classroomMembership.findUniqueOrThrow({where:{userId:actor.userId}});if(current.status==='SUSPENDED')await reviewTeacherApplication(client.db,admin,actor.userId,{commandId:randomUUID(),expectedRevision:current.revision,action:'RESTORE',reason:'Investigation completed'});
 }
});
test('ownership transfer commits before a queued old-owner scan and revokes original receipt access',async()=>{
 const session=await newSession();const original=scanInput(session.id,'a');await recordClassroomScan(client.db,actor,original);
 const transfer=tagged('transfer-before-scan');const scanner=tagged('scan-after-transfer');const gate=await auditBarrier();
 const pendingTransfer=observe(transferClassOwner(transfer.db,admin,session.classId,{commandId:randomUUID(),expectedConfigRevision:0,teacherId:other.userId,reason:'Correct the primary teacher assignment'}));
 let pendingScan:Promise<Outcome<Awaited<ReturnType<typeof recordClassroomScan>>>>|undefined;
 try{
  await waitForBlocked(transfer.name);pendingScan=observe(recordClassroomScan(scanner.db,actor,scanInput(session.id,'b')));await waitForBlocked(scanner.name);await gate.release();await valueOf(pendingTransfer);
  const scan=await pendingScan;assert.ok('error'in scan);if('error'in scan)assert.equal((scan.error as {code:string}).code,'CLASS_NOT_FOUND');
  await assert.rejects(recordClassroomScan(client.db,actor,original),{code:'CLASS_NOT_FOUND'});await assert.rejects(readAttendanceCommand(client.db,actor,original.commandId),{code:'CLASS_NOT_FOUND'});
  assert.equal((await recordClassroomScan(client.db,other,scanInput(session.id,'b'))).data.outcome,'RECORDED');
 }finally{await gate.release();await pendingTransfer;await pendingScan;await gate.close();await transfer.disconnect();await scanner.disconnect();}
});
test('password reset waits for an in-flight teaching command and invalidates all stale credential writes',async()=>{
 const {lockUserRowsForUpdate,applyAdminPasswordReset}=await import('@/globals/utils/credentials');const {guardCommandActor}=await import('./access');
 const session=await newSession();const scanner=tagged('scan-before-reset');const resetter=tagged('password-reset');const gate=await pairBarrier(session.id,'a');const pendingScan=observe(recordClassroomScan(scanner.db,actor,scanInput(session.id,'a')));
 let pendingReset:Promise<Outcome<Record<string,unknown>|null>>|undefined;
 try{
  await waitForBlocked(scanner.name);
  pendingReset=observe(resetter.db.$transaction(async tx=>{await lockUserRowsForUpdate(tx,[admin.userId,actor.userId]);await guardCommandActor(tx,admin,'ADMIN');return applyAdminPasswordReset(tx,{targetId:actor.userId,expectedCredentialVersion:0,tempPasswordHash:'fixture-temporary-password-hash'});}));
  await waitForBlocked(resetter.name);await gate.release();await valueOf(pendingScan);assert.ok(await valueOf(pendingReset));
  await assert.rejects(recordClassroomScan(client.db,actor,scanInput(session.id,'b')),{code:'UNAUTHORIZED'});
  await assert.rejects(recordClassroomScan(client.db,{...actor,credentialVersion:1},scanInput(session.id,'b')),{code:'PASSWORD_CHANGE_REQUIRED'});
  assert.equal(await client.db.classroomAttendanceChange.count({where:{sessionId:session.id}}),1);
 }finally{await gate.release();await pendingScan;await pendingReset;await gate.close();await scanner.disconnect();await resetter.disconnect();}
});
