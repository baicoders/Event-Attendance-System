import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before,after,test } from 'node:test';
import { createDisposableDb,createTestClient } from '@/globals/libs/testDb';
import { createAcademicTerm,createSubject } from './catalog';
import { createClassOffering,updateClassOffering } from './classes';
import { saveClassRoster } from './rosters';
import { getClassroomStartPreview,startClassroomSession,getClassroomSession,getSessionRoster,finalizeClassroomSession,cancelClassroomSession,amendSessionPolicy } from './sessions';
let fixture:Awaited<ReturnType<typeof createDisposableDb>>;let client:ReturnType<typeof createTestClient>;
const actor={userId:'session-teacher',credentialVersion:0};const other={userId:'other-teacher',credentialVersion:0};let classId:string;
const scheduledStartAt='2026-08-03T08:00:00+08:00';
before(async()=>{
 fixture=await createDisposableDb();client=createTestClient(fixture.url);
 for(const user of [actor,other]){await client.db.user.create({data:{id:user.userId,name:user.userId,email:user.userId+'@example.test',password:'test',role:'MEMBER',status:'PENDING'}});await client.db.classroomMembership.create({data:{userId:user.userId,status:'APPROVED',departmentOrDesignation:'Teacher'}});}
 for(const id of ['3a','3b','other'])await client.db.group.create({data:{id,slug:id,name:'BSIT '+id,category:'SECTION'}});
 for(const [id,section] of [['a','3a'],['b','3b'],['excluded','3a'],['irregular','other']])await client.db.student.create({data:{id,firstName:'Student',lastName:id,groups:{connect:{id:section}}}});
 const termId=(await createAcademicTerm(client.db,actor,{commandId:randomUUID(),name:'Term One',startDate:'2026-08-01',endDate:'2026-12-31'})).data.id;
 const subjectId=(await createSubject(client.db,actor,{commandId:randomUUID(),title:'Programming 2'})).data.id;
 classId=(await createClassOffering(client.db,actor,{commandId:randomUUID(),termId,subjectId,displayName:'Programming A',sectionIds:['3a','3b'],exceptions:[{studentId:'irregular',kind:'INCLUDE',reason:'Irregular enrollment'},{studentId:'excluded',kind:'EXCLUDE',reason:'Not enrolled'}]})).data.id;
});
after(async()=>{await client?.disconnect();await fixture?.cleanup();});
async function startInput(){const preview=await getClassroomStartPreview(client.db,actor,classId);return {commandId:randomUUID(),scheduledStartAt,expectedConfigRevision:preview.configRevision,expectedRosterRevision:preview.rosterRevision,expectedRosterFingerprint:preview.rosterFingerprint};}
async function start(){return (await startClassroomSession(client.db,actor,classId,await startInput())).data;}
let firstSessionId:string;
test('preview creates no attendance; start atomically freezes three eligible unmarked members and replays',async()=>{
 const input=await startInput();assert.equal(await client.db.classroomSession.count(),0);assert.equal(await client.db.classroomAttendance.count(),0);
 const created=await startClassroomSession(client.db,actor,classId,input);firstSessionId=created.data.id;
 const roster=await getSessionRoster(client.db,actor,firstSessionId);assert.equal(roster.total,3);assert.equal(roster.pageSize,100);assert.deepEqual(roster.items.map(row=>row.studentId).sort(),['a','b','irregular']);assert.ok(roster.items.every(row=>row.attendance.status==='UNMARKED'));
 const replay=await startClassroomSession(client.db,actor,classId,input);assert.deepEqual(replay.data,created.data);assert.equal(replay.replayed,true);
 await assert.rejects(startClassroomSession(client.db,actor,classId,{...input,commandId:randomUUID()}),{code:'ACTIVE_SESSION_EXISTS'});
 await assert.rejects(getClassroomSession(client.db,other,firstSessionId),{code:'CLASS_NOT_FOUND'});
 await assert.rejects(updateClassOffering(client.db,actor,classId,{commandId:randomUUID(),expectedConfigRevision:0,archived:true}),{code:'ACTIVE_SESSION_EXISTS'});
});
test('finalization makes only remaining unmarked members absent, with one immutable change each',async()=>{
 const finalized=await finalizeClassroomSession(client.db,actor,firstSessionId,{commandId:randomUUID(),expectedLifecycleRevision:0,expectedSnapshotRevision:0});
 assert.equal(finalized.data.state,'FINALIZED');assert.equal(finalized.data.defaultedAbsent,3);
 assert.equal(await client.db.classroomAttendanceChange.count({where:{sessionId:firstSessionId,action:'FINALIZE_ABSENT'}}),3);
 assert.equal((await getSessionRoster(client.db,actor,firstSessionId)).counts.ABSENT,3);
 await assert.rejects(client.db.classroomAttendanceChange.updateMany({where:{sessionId:firstSessionId},data:{reason:'Rewrite audit'}}));
 await assert.rejects(client.db.sessionRosterMember.update({where:{sessionId_studentId:{sessionId:firstSessionId,studentId:'a'}},data:{studentSnapshot:{v:1,id:'someone-else'}}}));
});
test('multiple same-day meetings are legitimate; cancellation produces no new absences and can cancel a mistaken finalized meeting',async()=>{
 const session=await start();assert.notEqual(session.id,firstSessionId);
 const input={commandId:randomUUID(),expectedLifecycleRevision:0,reason:'Meeting was started by mistake'};
 const canceled=await cancelClassroomSession(client.db,actor,session.id,input);assert.equal(canceled.data.state,'CANCELED');assert.equal((await getSessionRoster(client.db,actor,session.id)).counts.UNMARKED,3);
 assert.deepEqual((await cancelClassroomSession(client.db,actor,session.id,input)).data,canceled.data);
 assert.equal(await client.db.classroomAttendanceChange.count({where:{sessionId:session.id}}),0);
 const invalidated=await cancelClassroomSession(client.db,actor,firstSessionId,{commandId:randomUUID(),expectedLifecycleRevision:1,reason:'Duplicate historical meeting'});assert.equal(invalidated.data.state,'CANCELED');assert.ok(invalidated.data.finalizedAt);
});
test('central changes invalidate a start preview without changing class revisions and never rewrite prior snapshots',async()=>{
 const before=(await getSessionRoster(client.db,actor,firstSessionId)).items;
 const input=await startInput();
 await client.db.student.update({where:{id:'a'},data:{groups:{set:[{id:'other'}]},firstName:'Corrected'}});
 await assert.rejects(startClassroomSession(client.db,actor,classId,input),{code:'ROSTER_CHANGED'});
 assert.equal(await client.db.classroomCommandReceipt.count({where:{commandId:input.commandId}}),0);
 const fresh=await start();const roster=await getSessionRoster(client.db,actor,fresh.id);assert.deepEqual(roster.items.map(row=>row.studentId).sort(),['b','irregular']);
 assert.deepEqual((await getSessionRoster(client.db,actor,firstSessionId)).items,before);
 await finalizeClassroomSession(client.db,actor,fresh.id,{commandId:randomUUID(),expectedLifecycleRevision:0,expectedSnapshotRevision:0});
});
test('future class policy changes and active amendments preserve original policy and already marked outcomes',async()=>{
 const session=await start();
 await client.db.classroomAttendance.update({where:{sessionId_studentId:{sessionId:session.id,studentId:'b'}},data:{status:'PRESENT',method:'MANUAL',markedAt:new Date(),recordedById:actor.userId,recordedByName:actor.userId,lastModifiedById:actor.userId,lastModifiedByName:actor.userId,revision:1}});
 await updateClassOffering(client.db,actor,classId,{commandId:randomUUID(),expectedConfigRevision:0,graceMinutes:30});
 const original=await getClassroomSession(client.db,actor,session.id);assert.equal(original.graceMinutes,15);
 const amended=await amendSessionPolicy(client.db,actor,session.id,{commandId:randomUUID(),expectedLifecycleRevision:0,startAt:scheduledStartAt,graceMinutes:5,reason:'Correct grace period for this meeting'});assert.equal(amended.data.graceMinutes,5);assert.equal(amended.data.originalPolicySnapshot.graceMinutes,15);
 assert.equal((await client.db.classroomAttendance.findUniqueOrThrow({where:{sessionId_studentId:{sessionId:session.id,studentId:'b'}}})).status,'PRESENT');
 const finalized=await finalizeClassroomSession(client.db,actor,session.id,{commandId:randomUUID(),expectedLifecycleRevision:1,expectedSnapshotRevision:0});assert.equal(finalized.data.defaultedAbsent,1);
});
test('persistent exceptions are materialized for forty meetings; a midway enrollee has no prior membership',async()=>{
 const history:string[]=[];
 for(let meeting=0;meeting<40;meeting++){
  if(meeting===20)await client.db.student.create({data:{id:'midterm',firstName:'New',lastName:'Student',groups:{connect:{id:'3b'}}}});
  const session=await start();history.push(session.id);
  assert.equal(await client.db.sessionRosterMember.count({where:{sessionId:session.id,studentId:'irregular'}}),1);
  assert.equal(await client.db.sessionRosterMember.count({where:{sessionId:session.id,studentId:'midterm'}}),meeting<20?0:1);
  await finalizeClassroomSession(client.db,actor,session.id,{commandId:randomUUID(),expectedLifecycleRevision:0,expectedSnapshotRevision:0});
 }
 assert.equal(await client.db.sessionRosterMember.count({where:{sessionId:{in:history},studentId:'midterm'}}),20);
 assert.equal((await client.db.student.findUniqueOrThrow({where:{id:'irregular'},include:{groups:true}})).groups[0].id,'other');
});
test('stale permanent roster revision is rejected before snapshot creation',async()=>{
 const input=await startInput();await saveClassRoster(client.db,actor,{classId,commandId:randomUUID(),expectedRosterRevision:0,sectionIds:['3b'],exceptions:[{studentId:'irregular',kind:'INCLUDE',reason:'Irregular enrollment'}]});
 await assert.rejects(startClassroomSession(client.db,actor,classId,input),{code:'ROSTER_CHANGED'});
});

test('an audit failure rolls back every finalized absence, lifecycle update and receipt',async()=>{
 const session=await start();const input={commandId:randomUUID(),expectedLifecycleRevision:0,expectedSnapshotRevision:0};
 await client.db.$executeRawUnsafe(`CREATE FUNCTION fixture_reject_finalization_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='CLASSROOM_SESSION_FINALIZED' THEN RAISE EXCEPTION 'Fixture audit failure'; END IF; RETURN NEW; END $$`);
 await client.db.$executeRawUnsafe(`CREATE TRIGGER fixture_finalization_audit BEFORE INSERT ON "ClassroomAudit" FOR EACH ROW EXECUTE FUNCTION fixture_reject_finalization_audit()`);
 try{
  await assert.rejects(finalizeClassroomSession(client.db,actor,session.id,input));
  assert.equal((await client.db.classroomSession.findUniqueOrThrow({where:{id:session.id}})).state,'ACTIVE');
  assert.equal(await client.db.classroomAttendance.count({where:{sessionId:session.id,status:{not:'UNMARKED'}}}),0);
  assert.equal(await client.db.classroomAttendanceChange.count({where:{sessionId:session.id}}),0);
  assert.equal(await client.db.classroomCommandReceipt.count({where:{commandId:input.commandId}}),0);
 }finally{
  await client.db.$executeRawUnsafe('DROP TRIGGER fixture_finalization_audit ON "ClassroomAudit"');
  await client.db.$executeRawUnsafe('DROP FUNCTION fixture_reject_finalization_audit()');
 }
 await finalizeClassroomSession(client.db,actor,session.id,input);
});
test('capacity limits reject 1,001 before writes; the full 1,000-member boundary starts and finalizes without truncation',async()=>{
 const section=await client.db.group.create({data:{name:'Stress section',slug:'stress-section',category:'SECTION'}});
 const ids=Array.from({length:1001},(_,index)=>'capacity-'+String(index).padStart(4,'0'));
 await client.db.$transaction(async tx=>{
  await tx.student.createMany({data:ids.map(id=>({id,firstName:'Capacity',lastName:id}))});
  await tx.group.update({where:{id:section.id},data:{students:{connect:ids.map(id=>({id}))}}});
 },{timeout:60000});
 const offering=(await createClassOffering(client.db,actor,{commandId:randomUUID(),termId:(await client.db.classOffering.findUniqueOrThrow({where:{id:classId}})).termId,subjectId:(await client.db.classOffering.findUniqueOrThrow({where:{id:classId}})).subjectId,displayName:'Capacity fixture',sectionIds:[section.id],exceptions:[]})).data;
 const preview=await getClassroomStartPreview(client.db,actor,offering.id);assert.equal(preview.rosterCount,1001);
 const input={commandId:randomUUID(),scheduledStartAt,expectedConfigRevision:0,expectedRosterRevision:0,expectedRosterFingerprint:preview.rosterFingerprint};
 await assert.rejects(startClassroomSession(client.db,actor,offering.id,input),{code:'CAPACITY_LIMIT'});
 assert.equal(await client.db.classroomSession.count({where:{classId:offering.id}}),0);assert.equal(await client.db.classroomCommandReceipt.count({where:{commandId:input.commandId}}),0);
 await saveClassRoster(client.db,actor,{classId:offering.id,commandId:randomUUID(),expectedRosterRevision:0,sectionIds:[section.id],exceptions:[{studentId:ids[0],kind:'EXCLUDE',reason:'Not enrolled in this meeting fixture'}]});
 const bounded=await getClassroomStartPreview(client.db,actor,offering.id);const startAt=performance.now();
 const session=(await startClassroomSession(client.db,actor,offering.id,{...input,commandId:randomUUID(),expectedRosterRevision:1,expectedRosterFingerprint:bounded.rosterFingerprint})).data;
 assert.equal(session.counts.UNMARKED,1000);const firstPage=await getSessionRoster(client.db,actor,session.id);assert.equal(firstPage.total,1000);assert.equal(firstPage.items.length,100);assert.equal(firstPage.pageCount,10);
 const finalAt=performance.now();const finalized=await finalizeClassroomSession(client.db,actor,session.id,{commandId:randomUUID(),expectedLifecycleRevision:0,expectedSnapshotRevision:0});
 assert.equal(finalized.data.defaultedAbsent,1000);assert.equal(finalized.data.counts.ABSENT,1000);assert.equal(await client.db.classroomAttendanceChange.count({where:{sessionId:session.id}}),1000);
 console.log('1,000-member fixture start+page ms:',Math.round(finalAt-startAt),'finalize ms:',Math.round(performance.now()-finalAt));
});
