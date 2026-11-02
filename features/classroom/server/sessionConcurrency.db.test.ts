import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { before,after,test } from 'node:test';
import { Pool } from 'pg';
import { getPgPoolConfig } from '@/globals/libs/dbConfig';
import { createDisposableDb,createTestClient } from '@/globals/libs/testDb';
import { ROSTER_SHARED_KEY } from '@/globals/utils/pgLocks';
import { createAcademicTerm,createSubject } from './catalog';
import { createClassOffering } from './classes';
import { saveClassRoster } from './rosters';
import { getClassroomStartPreview,startClassroomSession,getSessionRoster,finalizeClassroomSession,cancelClassroomSession } from './sessions';
let fixture:Awaited<ReturnType<typeof createDisposableDb>>;let client:ReturnType<typeof createTestClient>;
const actor={userId:'teacher',credentialVersion:0};let termId:string;let subjectId:string;
before(async()=>{
 fixture=await createDisposableDb();client=createTestClient(fixture.url);
 await client.db.user.create({data:{id:actor.userId,name:'Teacher',email:'teacher@example.test',password:'test',role:'MEMBER'}});
 await client.db.classroomMembership.create({data:{userId:actor.userId,status:'APPROVED',departmentOrDesignation:'Teacher'}});
 termId=(await createAcademicTerm(client.db,actor,{commandId:randomUUID(),name:'Term',startDate:'2026-08-01',endDate:'2026-12-31'})).data.id;
 subjectId=(await createSubject(client.db,actor,{commandId:randomUUID(),title:'Programming'})).data.id;
});
after(async()=>{await client?.disconnect();await fixture?.cleanup();});
async function newCase(){
 const id=randomUUID();const section=id+'-section';const other=id+'-other';
 for(const key of [section,other])await client.db.group.create({data:{id:key,name:key,slug:key,category:'SECTION'}});
 const students=[id+'-a',id+'-b',id+'-c'];for(const studentId of students)await client.db.student.create({data:{id:studentId,firstName:'Student',lastName:studentId,groups:{connect:{id:section}}}});
 const offering=(await createClassOffering(client.db,actor,{commandId:randomUUID(),termId,subjectId,displayName:id,sectionIds:[section],exceptions:[]})).data;
 const preview=await getClassroomStartPreview(client.db,actor,offering.id);
 return {id:offering.id,section,other,students,input:{commandId:randomUUID(),scheduledStartAt:'2026-08-03T08:00:00+08:00',expectedConfigRevision:preview.configRevision,expectedRosterRevision:preview.rosterRevision,expectedRosterFingerprint:preview.rosterFingerprint}};
}
async function waitForBlocked(name:string){
 const deadline=Date.now()+1200;
 for(;;){
  const rows=await client.db.$queryRaw<Array<{waiting:boolean}>>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${name} AND wait_event_type='Lock') AS waiting`;
  if(rows[0].waiting)return;
  if(Date.now()>deadline)throw new Error('Expected PostgreSQL lock barrier was not observed: '+name);
  await delay(10);
 }
}
async function endSession(id:string){return finalizeClassroomSession(client.db,actor,id,{commandId:randomUUID(),expectedLifecycleRevision:0,expectedSnapshotRevision:0});}
test('two start devices create one active session; exact concurrent retries share one receipt',async()=>{
 const a=await newCase();const results=await Promise.allSettled([a.input,{...a.input,commandId:randomUUID()}].map(input=>startClassroomSession(client.db,actor,a.id,input)));
 assert.equal(results.filter(row=>row.status==='fulfilled').length,1);const rejected=results.find(row=>row.status==='rejected');assert.equal(rejected?.status==='rejected'&&rejected.reason.code,'ACTIVE_SESSION_EXISTS');
 assert.equal(await client.db.classroomSession.count({where:{classId:a.id,state:'ACTIVE'}}),1);
 const b=await newCase();const replay=await Promise.all([startClassroomSession(client.db,actor,b.id,b.input),startClassroomSession(client.db,actor,b.id,b.input)]);
 assert.equal(replay[0].data.id,replay[1].data.id);assert.equal(replay.filter(row=>row.replayed).length,1);assert.equal(await client.db.classroomCommandReceipt.count({where:{commandId:b.input.commandId}}),1);
});
test('a central batch committing after preview wakes start into ROSTER_CHANGED with no partial session or receipt',async()=>{
 const a=await newCase();const tag='classroom-start-'+randomUUID();const url=new URL(fixture.url);url.searchParams.set('application_name',tag);const starter=createTestClient(url.toString());
 const pool=new Pool(getPgPoolConfig(fixture.url));const writer=await pool.connect();
 try{
  await writer.query('BEGIN');await writer.query('SELECT pg_advisory_xact_lock($1)',[ROSTER_SHARED_KEY.toString()]);
  for(const studentId of a.students.slice(0,2)){await writer.query('DELETE FROM "_GroupToStudent" WHERE "A"=$1 AND "B"=$2',[a.section,studentId]);await writer.query('INSERT INTO "_GroupToStudent"("A","B") VALUES($1,$2)',[a.other,studentId]);}
  const pending=startClassroomSession(starter.db,actor,a.id,a.input);const observed=pending.then(value=>({value}),error=>({error}));
  await waitForBlocked(tag);await writer.query('COMMIT');const result=await observed;assert.ok('error'in result);if('error'in result)assert.equal(result.error.code,'ROSTER_CHANGED');
  assert.equal(await client.db.classroomSession.count({where:{classId:a.id}}),0);assert.equal(await client.db.classroomCommandReceipt.count({where:{commandId:a.input.commandId}}),0);
  const fresh=await getClassroomStartPreview(client.db,actor,a.id);const started=await startClassroomSession(starter.db,actor,a.id,{...a.input,commandId:randomUUID(),expectedRosterFingerprint:fresh.rosterFingerprint});
  assert.deepEqual((await getSessionRoster(client.db,actor,started.data.id)).items.map(row=>row.studentId),[a.students[2]]);
 }finally{await writer.query('ROLLBACK');writer.release();await pool.end();await starter.disconnect();}
});
test('a pending batch transfer cannot mix identities into a snapshot held under roster SHARE',async()=>{
 const a=await newCase();const barrierPool=new Pool(getPgPoolConfig(fixture.url));const freeze=await barrierPool.connect();
 const writerName='classroom-transfer-'+randomUUID();const writerPool=new Pool({...getPgPoolConfig(fixture.url),application_name:writerName});const writer=await writerPool.connect();
 const starterName='classroom-snapshot-'+randomUUID();const starterUrl=new URL(fixture.url);starterUrl.searchParams.set('application_name',starterName);const starter=createTestClient(starterUrl.toString());
 let starting:Promise<{value:Awaited<ReturnType<typeof startClassroomSession>>}|{error:unknown}>|undefined;
 let moving:Promise<{ok:true}|{error:unknown}>|undefined;
 try{
  // Stall Start after it owns roster SHARE, without adding a competing
  // advisory-lock waiter ahead of it (PostgreSQL gives queued writers priority).
  await freeze.query('BEGIN');await freeze.query('SELECT id FROM "AcademicTerm" WHERE id=$1 FOR UPDATE',[termId]);
  starting=startClassroomSession(starter.db,actor,a.id,a.input).then(value=>({value}),error=>({error}));
  await waitForBlocked(starterName);
  await writer.query('BEGIN');
  moving=(async()=>{
   await writer.query('SELECT pg_advisory_xact_lock($1)',[ROSTER_SHARED_KEY.toString()]);
   for(const studentId of a.students.slice(0,2)){await writer.query('DELETE FROM "_GroupToStudent" WHERE "A"=$1 AND "B"=$2',[a.section,studentId]);await writer.query('INSERT INTO "_GroupToStudent"("A","B") VALUES($1,$2)',[a.other,studentId]);}
   await writer.query('COMMIT');return {ok:true as const};
  })().catch(error=>({error}));
  await waitForBlocked(writerName);await freeze.query('COMMIT');
  const started=await starting;if('error'in started)throw started.error;
  const before=await getSessionRoster(client.db,actor,started.value.data.id);assert.deepEqual(before.items.map(row=>row.studentId).sort(),[...a.students].sort());
  const moved=await moving;if('error'in moved)throw moved.error;
  assert.deepEqual((await getSessionRoster(client.db,actor,started.value.data.id)).items,before.items);
  await endSession(started.value.data.id);const preview=await getClassroomStartPreview(client.db,actor,a.id);assert.equal(preview.rosterCount,1);
 }finally{
  await freeze.query('ROLLBACK');await starting;await moving;await writer.query('ROLLBACK');
  freeze.release();writer.release();await barrierPool.end();await writerPool.end();await starter.disconnect();
 }
});
test('finalize/cancel and duplicate finalize serialize with atomic results and receipt replay',async()=>{
 const a=await newCase();const started=(await startClassroomSession(client.db,actor,a.id,a.input)).data;
 const raced=await Promise.allSettled([endSession(started.id),cancelClassroomSession(client.db,actor,started.id,{commandId:randomUUID(),expectedLifecycleRevision:0,reason:'Started the wrong meeting'})]);
 assert.equal(raced.filter(row=>row.status==='fulfilled').length,1);
 const current=await client.db.classroomSession.findUniqueOrThrow({where:{id:started.id}});const roster=await getSessionRoster(client.db,actor,current.id);
 assert.equal(roster.counts.ABSENT,current.state==='FINALIZED'?3:0);assert.equal(roster.counts.UNMARKED,current.state==='CANCELED'?3:0);
 const b=await newCase();const second=(await startClassroomSession(client.db,actor,b.id,b.input)).data;const command={commandId:randomUUID(),expectedLifecycleRevision:0,expectedSnapshotRevision:0};
 const duplicates=await Promise.all([finalizeClassroomSession(client.db,actor,second.id,command),finalizeClassroomSession(client.db,actor,second.id,command)]);
 assert.deepEqual(duplicates[0].data,duplicates[1].data);assert.equal(await client.db.classroomAttendanceChange.count({where:{sessionId:second.id}}),3);
});

test('a concurrent permanent roster save affects the next session or rejects the stale start, never a mixed snapshot',async()=>{
 const a=await newCase();
 const results=await Promise.allSettled([
  startClassroomSession(client.db,actor,a.id,a.input),
  saveClassRoster(client.db,actor,{classId:a.id,commandId:randomUUID(),expectedRosterRevision:0,sectionIds:[],exceptions:[{studentId:a.students[2],kind:'INCLUDE',reason:'Only enrolled student'}]}),
 ]);
 assert.equal(results[1].status,'fulfilled');
 if(results[0].status==='fulfilled'){
  const frozen=await getSessionRoster(client.db,actor,results[0].value.data.id);assert.equal(frozen.total,3);
  await endSession(results[0].value.data.id);
 }else assert.equal(results[0].reason.code,'ROSTER_CHANGED');
 const fresh=await getClassroomStartPreview(client.db,actor,a.id);
 const future=await startClassroomSession(client.db,actor,a.id,{...a.input,commandId:randomUUID(),expectedRosterRevision:fresh.rosterRevision,expectedRosterFingerprint:fresh.rosterFingerprint});
 assert.deepEqual((await getSessionRoster(client.db,actor,future.data.id)).items.map(row=>row.studentId),[a.students[2]]);
});
