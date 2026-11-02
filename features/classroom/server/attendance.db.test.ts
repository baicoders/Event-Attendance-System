import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before,after,test } from 'node:test';
import { createDisposableDb,createTestClient } from '@/globals/libs/testDb';
import { createAcademicTerm,createSubject } from './catalog';
import { createClassOffering } from './classes';
import { getClassRoster } from './rosters';
import { getClassroomStartPreview,startClassroomSession,getSessionRoster,finalizeClassroomSession,cancelClassroomSession } from './sessions';
import { recordClassroomScan,setClassroomAttendance,adjustSessionRoster,readAttendanceCommand } from './attendance';
let fixture:Awaited<ReturnType<typeof createDisposableDb>>;let client:ReturnType<typeof createTestClient>;
const actor={userId:'teacher',credentialVersion:0};const other={userId:'other',credentialVersion:0};let termId:string;let subjectId:string;
const legacy='00000111111';
before(async()=>{
 fixture=await createDisposableDb();client=createTestClient(fixture.url);
 for(const person of [actor,other]){await client.db.user.create({data:{id:person.userId,name:person.userId,email:person.userId+'@example.test',password:'test',role:'MEMBER'}});await client.db.classroomMembership.create({data:{userId:person.userId,status:'APPROVED',departmentOrDesignation:'Teacher'}});}
 for(const id of ['section','outside'])await client.db.group.create({data:{id,name:id,slug:id,category:'SECTION'}});
 for(const [index,id] of ['a','b','c',legacy,'excluded','outside-student'].entries())await client.db.student.create({data:{id,firstName:'Student',lastName:id,usn:id===legacy?legacy:String(index+1000).padStart(11,'0'),lrn:id==='b'?'000000123456':null,groups:{connect:{id:id==='outside-student'?'outside':'section'}}}});
 await client.db.studentQrCode.create({data:{code:'old-printed-alias',reservedOwnerId:'a',studentId:'a',state:'RESOLVABLE',originalKind:'USN'}});
 await client.db.studentQrCode.create({data:{code:'ambiguous-card',state:'QUARANTINED',originalKind:'LEGACY'}});
 await client.db.studentQrCode.create({data:{code:'retired-card',reservedOwnerId:'a',studentId:'a',state:'RETIRED',originalKind:'USN',retiredAt:new Date()}});
 const year=new Date().getUTCFullYear();termId=(await createAcademicTerm(client.db,actor,{commandId:randomUUID(),name:'Term',startDate:(year-1)+'-01-01',endDate:(year+1)+'-12-31'})).data.id;
 subjectId=(await createSubject(client.db,actor,{commandId:randomUUID(),title:'Programming'})).data.id;
});
after(async()=>{await client?.disconnect();await fixture?.cleanup();});
async function session(minutesAgo=0){
 const offering=(await createClassOffering(client.db,actor,{commandId:randomUUID(),termId,subjectId,displayName:'Class '+randomUUID(),sectionIds:['section'],exceptions:[{studentId:'excluded',kind:'EXCLUDE',reason:'Not enrolled in this subject'}]})).data;
 const preview=await getClassroomStartPreview(client.db,actor,offering.id);
 const current=(await startClassroomSession(client.db,actor,offering.id,{commandId:randomUUID(),scheduledStartAt:new Date(Date.now()-minutesAgo*60000).toISOString(),expectedConfigRevision:0,expectedRosterRevision:0,expectedRosterFingerprint:preview.rosterFingerprint})).data;
 return {classId:offering.id,id:current.id};
}
const scan=(sessionId:string,code:string,commandId=randomUUID())=>recordClassroomScan(client.db,actor,{sessionId,code,commandId});
const manual=(sessionId:string,studentId:string,status:string,expectedRevision=0,extra:Record<string,unknown>={})=>setClassroomAttendance(client.db,actor,{sessionId,studentId,status,expectedRevision,commandId:randomUUID(),...extra});
test('existing internal/USN/LRN aliases resolve one stable member; repeated scans never toggle or rewrite',async()=>{
 const current=await session();const commandId=randomUUID();const first=await scan(current.id,'old-printed-alias',commandId);
 assert.equal(first.data.outcome,'RECORDED');assert.equal(first.data.attendance.status,'PRESENT');assert.equal(first.data.attendance.revision,1);
 assert.deepEqual((await scan(current.id,'old-printed-alias',commandId)).data,first.data);
 assert.equal((await scan(current.id,'000000123456')).data.studentId,'b');
 const duplicate=await scan(current.id,'00000001000');assert.equal(duplicate.data.outcome,'ALREADY_RECORDED');assert.deepEqual(duplicate.data.attendance,first.data.attendance);
 assert.equal(await client.db.classroomAttendance.count({where:{sessionId:current.id,studentId:'a'}}),1);assert.equal(await client.db.classroomAttendanceChange.count({where:{sessionId:current.id,studentId:'a'}}),1);
 await assert.rejects(scan(current.id,'b',commandId),{code:'COMMAND_REUSED'});
 const change=await client.db.classroomAttendanceChange.findFirstOrThrow({where:{sessionId:current.id,studentId:'a'}});
 assert.equal((change.after as {appliedPolicy:{lifecycleRevision:number}}).appliedPolicy.lifecycleRevision,0);
 const late=await session(60);assert.equal((await scan(late.id,'a')).data.attendance.status,'LATE');
});
test('unknown/retired/ambiguous scans and unrelated teachers create no attendance changes or receipts',async()=>{
 const current=await session();
 for(const [code,error] of [['unknown-card','UNKNOWN_QR'],['retired-card','QR_RETIRED'],['ambiguous-card','QR_AMBIGUOUS']]){
  const commandId=randomUUID();await assert.rejects(scan(current.id,code,commandId),{code:error});assert.equal(await client.db.classroomCommandReceipt.count({where:{commandId}}),0);
 }
 await assert.rejects(recordClassroomScan(client.db,other,{sessionId:current.id,code:'a',commandId:randomUUID()}),{code:'CLASS_NOT_FOUND'});
 assert.equal(await client.db.classroomAttendanceChange.count({where:{sessionId:current.id}}),0);
});
test('manual absence/excuse survive scanning; corrections require reasons, optional notes and current row revisions',async()=>{
 const current=await session();
 const absent=await manual(current.id,'a','ABSENT');assert.equal(absent.data.attendance.revision,1);
 assert.equal((await scan(current.id,'a')).data.outcome,'ALREADY_MARKED');
 const excused=await manual(current.id,'b','EXCUSED',0,{excuseNote:'Excuse letter received'});assert.equal(excused.data.attendance.excuseNote,'Excuse letter received');
 assert.equal((await scan(current.id,'b')).data.attendance.status,'EXCUSED');
 const optional=await manual(current.id,'c','EXCUSED');assert.equal(optional.data.attendance.excuseNote,null);
 await assert.rejects(manual(current.id,'a','PRESENT',1),{code:'REASON_REQUIRED'});
 const corrected=await manual(current.id,'a','LATE',1,{reason:'Student arrived after the roll call'});assert.equal(corrected.data.attendance.revision,2);
 await assert.rejects(manual(current.id,'a','PRESENT',1,{reason:'Stale second device'}),{code:'ATTENDANCE_CHANGED'});
 await finalizeClassroomSession(client.db,actor,current.id,{commandId:randomUUID(),expectedLifecycleRevision:0,expectedSnapshotRevision:0});
 await assert.rejects(manual(current.id,'b','PRESENT',1),{code:'REASON_REQUIRED'});
 const finalized=await manual(current.id,'b','PRESENT',1,{reason:'Correct accepted letter attribution'});assert.equal(finalized.data.attendance.excuseNote,null);
 const changes=await client.db.classroomAttendanceChange.findMany({where:{sessionId:current.id,studentId:'b'},orderBy:{id:'asc'}});assert.equal(changes.length,2);assert.equal(changes[1].reason,'Correct accepted letter attribution');
});
test('outside students require a choice; session-only, permanent and class-only scopes preserve official sections',async()=>{
 const temporary=await session();const refused=randomUUID();
 await assert.rejects(scan(temporary.id,'outside-student',refused),{code:'STUDENT_NOT_IN_SESSION'});
 assert.equal(await client.db.sessionRosterMember.count({where:{sessionId:temporary.id,studentId:'outside-student'}}),0);assert.equal(await client.db.classroomCommandReceipt.count({where:{commandId:refused}}),0);
 const included=await adjustSessionRoster(client.db,actor,{sessionId:temporary.id,studentId:'outside-student',action:'INCLUDE',scope:'SESSION',expectedSnapshotRevision:0,reason:'Visiting this meeting only',recordScan:true,code:'outside-student',commandId:randomUUID()});
 assert.equal(included.data.attendance?.status,'PRESENT');assert.equal(included.data.snapshotRevision,1);
 assert.equal(await client.db.classRosterException.count({where:{classId:temporary.classId,studentId:'outside-student'}}),0);
 const permanent=await session();await adjustSessionRoster(client.db,actor,{sessionId:permanent.id,studentId:'outside-student',action:'INCLUDE',scope:'CLASS_AND_SESSION',expectedSnapshotRevision:0,expectedRosterRevision:0,reason:'Irregular enrollment for this subject',commandId:randomUUID()});
 assert.ok((await getClassRoster(client.db,actor,permanent.classId)).items.some(row=>row.studentId==='outside-student'));
 const futureOnly=await session();await adjustSessionRoster(client.db,actor,{sessionId:futureOnly.id,studentId:'outside-student',action:'INCLUDE',scope:'CLASS_ONLY',expectedSnapshotRevision:0,expectedRosterRevision:0,reason:'Enroll for future meetings',commandId:randomUUID()});
 assert.equal(await client.db.sessionRosterMember.count({where:{sessionId:futureOnly.id,studentId:'outside-student'}}),0);assert.ok((await getClassRoster(client.db,actor,futureOnly.classId)).items.some(row=>row.studentId==='outside-student'));
 assert.equal((await client.db.student.findUniqueOrThrow({where:{id:'outside-student'},include:{groups:true}})).groups[0].id,'outside');
});
test('permanent inclusion explicitly replaces exclusions; session exclusion preserves marked history',async()=>{
 const current=await session();const command={sessionId:current.id,studentId:'excluded',action:'INCLUDE',scope:'CLASS_AND_SESSION',expectedSnapshotRevision:0,expectedRosterRevision:0,reason:'Enrollment corrected by teacher',commandId:randomUUID()};
 await assert.rejects(adjustSessionRoster(client.db,actor,command),{code:'EXCLUSION_CONFIRMATION_REQUIRED'});
 const restored=await adjustSessionRoster(client.db,actor,{...command,confirmReplaceExclusion:true});assert.equal(restored.data.snapshotRevision,1);
 assert.equal((await client.db.classRosterException.findUniqueOrThrow({where:{classId_studentId:{classId:current.classId,studentId:'excluded'}}})).kind,'INCLUDE');
 await scan(current.id,'excluded');
 await adjustSessionRoster(client.db,actor,{sessionId:current.id,studentId:'excluded',action:'EXCLUDE',scope:'SESSION',expectedSnapshotRevision:1,reason:'Attended the wrong subject offering',commandId:randomUUID()});
 const member=await client.db.sessionRosterMember.findUniqueOrThrow({where:{sessionId_studentId:{sessionId:current.id,studentId:'excluded'}},include:{attendance:true}});assert.equal(member.included,false);assert.equal(member.attendance?.status,'PRESENT');
 await assert.rejects(manual(current.id,'excluded','ABSENT',1,{reason:'Must not edit an excluded member'}),{code:'STUDENT_NOT_IN_SESSION'});
});
test('finalized inclusion needs an explicit outcome; it cannot introduce unmarked absences or rewrite original snapshots',async()=>{
 const current=await session();await finalizeClassroomSession(client.db,actor,current.id,{commandId:randomUUID(),expectedLifecycleRevision:0,expectedSnapshotRevision:0});
 const input={sessionId:current.id,studentId:'outside-student',action:'INCLUDE',scope:'SESSION',expectedSnapshotRevision:0,reason:'Correct missed historical enrollment',commandId:randomUUID()};
 await assert.rejects(adjustSessionRoster(client.db,actor,input),{code:'FINAL_STATUS_REQUIRED'});
 const added=await adjustSessionRoster(client.db,actor,{...input,finalStatus:'EXCUSED',excuseNote:'Approved excuse letter'});assert.equal(added.data.attendance?.status,'EXCUSED');assert.equal(added.data.snapshotRevision,1);
 assert.equal((await getSessionRoster(client.db,actor,current.id)).counts.UNMARKED,0);
});
test('successful attendance receipts remain recoverable after finalization; cancellation and fresh revocation block new commands',async()=>{
 const current=await session();const command={sessionId:current.id,code:'a',commandId:randomUUID()};const saved=await recordClassroomScan(client.db,actor,command);
 await finalizeClassroomSession(client.db,actor,current.id,{commandId:randomUUID(),expectedLifecycleRevision:0,expectedSnapshotRevision:0});
 assert.deepEqual((await recordClassroomScan(client.db,actor,command)).data,saved.data);assert.deepEqual((await readAttendanceCommand(client.db,actor,command.commandId)).result,saved.data);
 await assert.rejects(scan(current.id,'b'),{code:'SESSION_FINALIZED'});
 const canceled=await session();await cancelClassroomSession(client.db,actor,canceled.id,{commandId:randomUUID(),expectedLifecycleRevision:0,reason:'Started the wrong class'});
 await assert.rejects(scan(canceled.id,'a'),{code:'SESSION_CANCELED'});await assert.rejects(manual(canceled.id,'a','PRESENT'),{code:'SESSION_CANCELED'});
 await client.db.classroomMembership.update({where:{userId:actor.userId},data:{status:'SUSPENDED'}});
 await assert.rejects(recordClassroomScan(client.db,actor,command),{code:'CLASSROOM_SUSPENDED'});await assert.rejects(readAttendanceCommand(client.db,actor,command.commandId),{code:'CLASSROOM_SUSPENDED'});
 await client.db.classroomMembership.update({where:{userId:actor.userId},data:{status:'APPROVED'}});
 await client.db.user.update({where:{id:actor.userId},data:{credentialVersion:{increment:1}}});
 await assert.rejects(recordClassroomScan(client.db,actor,command),{code:'UNAUTHORIZED'});
 actor.credentialVersion++;
 assert.deepEqual((await recordClassroomScan(client.db,actor,command)).data,saved.data);
});
test('a retired numeric internal QR stays a valid canonical manual member ID',async()=>{
 const current=await session();await client.db.student.update({where:{id:legacy},data:{usn:'00000999999'}});
 await assert.rejects(scan(current.id,legacy),{code:'QR_RETIRED'});
 const marked=await manual(current.id,legacy,'PRESENT');assert.equal(marked.data.studentId,legacy);assert.equal(marked.data.attendance.status,'PRESENT');
});

test('a frozen student can still be explicitly excluded after a directory eligibility change',async()=>{
 const current=await session();
 const employees=await client.db.group.create({data:{id:'employees',name:'Employees',slug:'employees',category:'HOUSE'}});
 await client.db.student.update({where:{id:'c'},data:{groups:{connect:{id:employees.id}}}});
 const excluded=await adjustSessionRoster(client.db,actor,{sessionId:current.id,studentId:'c',action:'EXCLUDE',scope:'SESSION',expectedSnapshotRevision:0,reason:'Correct this meeting enrollment independently of current directory classification',commandId:randomUUID()});
 assert.equal(excluded.data.member?.included,false);assert.equal(excluded.data.member?.studentSnapshot.id,'c');assert.equal(excluded.data.attendance?.status,'UNMARKED');
});

test('finalized re-inclusion checks the existing result revision and keeps its original identity snapshot',async()=>{
 const current=await session();await scan(current.id,'a');
 const original=(await getSessionRoster(client.db,actor,current.id)).items.find(row=>row.studentId==='a')!.studentSnapshot;
 await adjustSessionRoster(client.db,actor,{sessionId:current.id,studentId:'a',action:'EXCLUDE',scope:'SESSION',expectedSnapshotRevision:0,reason:'Mistaken session enrollment',commandId:randomUUID()});
 await finalizeClassroomSession(client.db,actor,current.id,{commandId:randomUUID(),expectedLifecycleRevision:0,expectedSnapshotRevision:1});
 const input={sessionId:current.id,studentId:'a',action:'INCLUDE',scope:'SESSION',expectedSnapshotRevision:1,finalStatus:'PRESENT',reason:'Correct mistaken exclusion from the finalized meeting',commandId:randomUUID()};
 await assert.rejects(adjustSessionRoster(client.db,actor,input),{code:'ATTENDANCE_CHANGED'});
 const corrected=await adjustSessionRoster(client.db,actor,{...input,expectedAttendanceRevision:1});assert.equal(corrected.data.snapshotRevision,2);assert.equal(corrected.data.attendance?.revision,2);assert.deepEqual(corrected.data.member?.studentSnapshot,original);
});
test('a row-audit failure rolls back status, revision and command receipt, then the same key safely retries',async()=>{
 const current=await session();const input={sessionId:current.id,code:'a',commandId:randomUUID()};
 await client.db.$executeRawUnsafe(`CREATE FUNCTION fixture_reject_row_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fixture attendance audit failure'; END $$`);
 await client.db.$executeRawUnsafe('CREATE TRIGGER fixture_row_audit BEFORE INSERT ON "ClassroomAttendanceChange" FOR EACH ROW EXECUTE FUNCTION fixture_reject_row_audit()');
 try{
  await assert.rejects(recordClassroomScan(client.db,actor,input));
  const row=await client.db.classroomAttendance.findUniqueOrThrow({where:{sessionId_studentId:{sessionId:current.id,studentId:'a'}}});assert.equal(row.status,'UNMARKED');assert.equal(row.revision,0);
  assert.equal(await client.db.classroomCommandReceipt.count({where:{commandId:input.commandId}}),0);
 }finally{await client.db.$executeRawUnsafe('DROP TRIGGER fixture_row_audit ON "ClassroomAttendanceChange"');await client.db.$executeRawUnsafe('DROP FUNCTION fixture_reject_row_audit()');}
 assert.equal((await recordClassroomScan(client.db,actor,input)).data.outcome,'RECORDED');assert.equal(await client.db.classroomAttendanceChange.count({where:{sessionId:current.id,studentId:'a'}}),1);
});
