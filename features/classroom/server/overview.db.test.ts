import assert from 'node:assert/strict';
import { before,after,test } from 'node:test';
import type { ClassroomAttendanceStatus,ClassroomSessionState } from '@prisma/client';
import { createDisposableDb,createTestClient } from '@/globals/libs/testDb';
import { getClassroomOverview } from './overview';
import { listClassOfferings } from './classes';
import { listClassroomSessions } from './sessions';
let fixture:Awaited<ReturnType<typeof createDisposableDb>>;let client:ReturnType<typeof createTestClient>;
const teacher={userId:'overview-teacher',credentialVersion:0};const other={userId:'overview-other',credentialVersion:0};const admin={userId:'overview-admin',credentialVersion:0};const pending={userId:'overview-pending',credentialVersion:0};
const now=new Date('2026-11-13T04:00:00Z');const query=()=>new URLSearchParams({termId:'term-main'});
async function meeting(id:string,classId:string,start:string,state:ClassroomSessionState='ACTIVE'){
 const scheduledStartAt=new Date(start),lateAfter=new Date(scheduledStartAt.getTime()+900000);
 await client.db.$transaction(async tx=>{
  await tx.classroomSession.create({data:{id,classId,scheduledStartAt,lateAfter,startedAt:scheduledStartAt,graceMinutes:15,startedById:teacher.userId,startedByName:'Original Teacher',originalPolicySnapshot:{v:1,scheduledStartAt:scheduledStartAt.toISOString(),lateAfter:lateAfter.toISOString(),timeZone:'Asia/Manila',graceMinutes:15},classSnapshot:{v:1,id:classId,displayName:'Frozen '+classId,primaryTeacher:{id:teacher.userId,name:'Original Teacher'},term:{id:'term-main',name:'Frozen term'},subject:{id:'subject',title:'Frozen subject',code:'SUB'},sections:[{sectionId:'section',name:'Frozen section',slug:'section'}]},rosterConfigSnapshot:{v:1,count:4}}});
  const statuses:ClassroomAttendanceStatus[]=state==='FINALIZED'?['ABSENT','PRESENT','LATE','PRESENT']:['UNMARKED','PRESENT','LATE','PRESENT'];
  for(let i=0;i<4;i++){
   const studentId='student-'+i,included=i!==3;
   await tx.sessionRosterMember.create({data:{sessionId:id,studentId,included,studentSnapshot:{v:1,id:studentId},originSnapshot:{v:1},...(!included?{removedAt:now,removalReason:'Not eligible'}:{})}});
   const status=statuses[i];await tx.classroomAttendance.create({data:{sessionId:id,studentId,status,...(status!=='UNMARKED'?{revision:1,method:'MANUAL',markedAt:now,recordedById:teacher.userId,recordedByName:'Teacher',lastModifiedById:teacher.userId,lastModifiedByName:'Teacher'}:{})}});
  }
  if(state==='FINALIZED')await tx.classroomSession.update({where:{id},data:{state,lifecycleRevision:1,finalizedAt:now,finalizedById:teacher.userId,finalizedByName:'Teacher'}});
  if(state==='CANCELED')await tx.classroomSession.update({where:{id},data:{state,lifecycleRevision:1,canceledAt:now,canceledById:teacher.userId,canceledByName:'Teacher',cancellationReason:'Mistaken meeting'}});
 });
}
before(async()=>{
 fixture=await createDisposableDb();client=createTestClient(fixture.url);
 for(const actor of [teacher,other,admin,pending]){
  await client.db.user.create({data:{id:actor.userId,name:actor.userId,email:actor.userId+'@example.test',password:'test',role:actor===admin?'ADMIN':'MEMBER',status:actor===admin?'ACTIVE':'PENDING'}});
  if(actor!==admin)await client.db.classroomMembership.create({data:{userId:actor.userId,status:actor===pending?'PENDING':'APPROVED',departmentOrDesignation:'Teacher'}});
 }
 for(const id of ['term-main','term-other'])await client.db.academicTerm.create({data:{id,name:id,normalizedKey:id,createdById:teacher.userId,startDate:new Date('2026-08-01'),endDate:new Date('2027-05-31')}});
 await client.db.subject.create({data:{id:'subject',title:'Current subject',normalizedTitle:'current subject',createdById:teacher.userId}});
 for(let i=0;i<4;i++)await client.db.student.create({data:{id:'student-'+i,firstName:'Student',lastName:String(i)}});
 for(let i=0;i<30;i++)await client.db.classOffering.create({data:{id:'class-'+String(i).padStart(2,'0'),termId:'term-main',subjectId:'subject',primaryTeacherId:teacher.userId,displayName:'Current class '+i,updatedAt:new Date(now.getTime()-i*1000),...(i<2?{archivedAt:now}:{})}});
 await client.db.classOffering.createMany({data:[{id:'other-teacher',termId:'term-main',subjectId:'subject',primaryTeacherId:other.userId,displayName:'Other teacher'},{id:'other-term',termId:'term-other',subjectId:'subject',primaryTeacherId:teacher.userId,displayName:'Other term'}]});
 for(let i=23;i<30;i++)await meeting('active-'+i,'class-'+i,'2026-11-13T08:00:00+08:00');
 await meeting('other-owner-active','other-teacher','2026-11-13T08:00:00+08:00');await meeting('other-term-active','other-term','2026-11-13T08:00:00+08:00');
 await meeting('at-start','class-02','2026-11-13T00:00:00+08:00','FINALIZED');
 await meeting('same-day-second','class-02','2026-11-13T14:00:00+08:00','FINALIZED');
 await meeting('at-end-minus-ms','class-02','2026-11-13T23:59:59.999+08:00','FINALIZED');
 await meeting('before-start','class-02','2026-11-12T23:59:59.999+08:00','FINALIZED');
 await meeting('at-end','class-02','2026-11-14T00:00:00+08:00','FINALIZED');
 await meeting('canceled-today','class-02','2026-11-13T12:00:00+08:00','CANCELED');
 await meeting('archived-history','class-00','2026-11-13T11:00:00+08:00','FINALIZED');
});
after(async()=>{await client?.disconnect();await fixture?.cleanup();});
test('overview totals cover all owned classes and distinct Manila-day meetings, with bounded previews and links',async()=>{
 const result=await getClassroomOverview(client.db,teacher,query(),now);
 assert.deepEqual(result.stats,{classCount:28,activeMeetingCount:7,meetingsTodayCount:11});
 assert.equal(result.activeMeetings.items.length,5);assert.equal(result.activeMeetings.total,7);assert.equal(result.activeMeetings.hasMore,true);
 assert.equal(result.recentClasses.items.length,6);assert.equal(result.recentClasses.total,28);assert.equal(result.recentClasses.hasMore,true);
 assert.equal(result.recentMeetings.items.length,5);assert.equal(result.recentMeetings.total,7);assert.equal(result.recentMeetings.hasMore,true);
 assert.match(result.activeMeetings.href,/view=active/);assert.match(result.recentClasses.href,/termId=term-main/);assert.match(result.recentMeetings.href,/termId=term-main/);assert.match(result.recentMeetings.href,/archived=true/);
 assert.equal(result.serverNow,now.toISOString());assert.equal(result.timeZone,'Asia/Manila');
 for(const meeting of result.activeMeetings.items){assert.deepEqual(meeting.counts,{UNMARKED:1,PRESENT:1,LATE:1,ABSENT:0,EXCUSED:0});assert.equal(meeting.rosterCount,3);assert.equal(meeting.markedCount,2);assert.match(meeting.classSnapshot.displayName,/^Frozen/);assert.equal(meeting.classSnapshot.subject.title,'Frozen subject');}
 assert.ok(result.recentMeetings.items.some(item=>item.state==='CANCELED'));assert.ok(result.recentMeetings.items.every(item=>item.state!=='ACTIVE'));
});
test('attendance state is filtered before pagination, READY always excludes archived and ACTIVE honors ownership and term',async()=>{
 const ready=await listClassOfferings(client.db,teacher,new URLSearchParams({termId:'term-main',attendanceState:'READY',includeArchived:'true',pageSize:'20'}));
 assert.equal(ready.total,21);assert.equal(ready.items.length,20);assert.ok(ready.items.every(item=>!item.archivedAt&&!item.activeSession));
 const second=await listClassOfferings(client.db,teacher,new URLSearchParams({termId:'term-main',attendanceState:'READY',pageSize:'20',page:'2'}));assert.equal(second.items.length,1);assert.equal(second.total,21);
 const active=await listClassOfferings(client.db,teacher,new URLSearchParams({termId:'term-main',attendanceState:'ACTIVE',pageSize:'5'}));assert.equal(active.total,7);assert.equal(active.items.length,5);assert.ok(active.items.every(item=>!!item.activeSession));
 await assert.rejects(listClassOfferings(client.db,teacher,new URLSearchParams({attendanceState:'UNKNOWN'})));
});
test('meeting history has authoritative batched progress for returned IDs including canceled and excluded members',async()=>{
 const history=await listClassroomSessions(client.db,teacher,'class-02',new URLSearchParams({pageSize:'2'}));assert.equal(history.total,6);assert.equal(history.items.length,2);
 for(const row of history.items){assert.equal(row.rosterCount,3);assert.equal(row.markedCount,row.state==='CANCELED'?2:3);assert.equal(row.counts.PRESENT,1);}
 const filtered=await listClassroomSessions(client.db,teacher,'class-02',new URLSearchParams({date:'2026-11-13'}));assert.equal(filtered.total,4);const canceled=filtered.items.find(row=>row.state==='CANCELED');assert.ok(canceled);assert.equal(canceled.rosterCount,3);assert.equal(canceled.markedCount,2);assert.equal(canceled.counts.UNMARKED,1);
});
test('empty term scope returns zero totals and empty previews, and unknown privilege query fields are rejected',async()=>{
 const empty=await getClassroomOverview(client.db,teacher,new URLSearchParams({termId:'not-a-term'}),now);
 assert.deepEqual(empty.stats,{classCount:0,activeMeetingCount:0,meetingsTodayCount:0});
 for(const group of [empty.activeMeetings,empty.recentClasses,empty.recentMeetings]){assert.deepEqual(group.items,[]);assert.equal(group.total,0);assert.equal(group.hasMore,false);}
 await assert.rejects(getClassroomOverview(client.db,teacher,new URLSearchParams({teacherId:other.userId}),now));
});
test('overview rechecks role and current ownership and admin sees all owners with the selected term',async()=>{
 assert.equal((await getClassroomOverview(client.db,admin,query(),now)).stats.classCount,29);
 assert.equal((await getClassroomOverview(client.db,other,query(),now)).stats.activeMeetingCount,1);
 assert.equal((await getClassroomOverview(client.db,teacher,new URLSearchParams(),now)).stats.classCount,29);
 await assert.rejects(getClassroomOverview(client.db,pending,query(),now),{code:'CLASSROOM_ACCESS_REQUIRED'});
 await assert.rejects(getClassroomOverview(client.db,{...teacher,credentialVersion:1},query(),now),{code:'UNAUTHORIZED'});
 await client.db.classOffering.update({where:{id:'class-23'},data:{primaryTeacherId:other.userId}});
 const afterTransfer=await getClassroomOverview(client.db,teacher,query(),now);assert.equal(afterTransfer.stats.activeMeetingCount,6);assert.ok(afterTransfer.activeMeetings.items.every(item=>item.classId!=='class-23'));
 const newOwner=await getClassroomOverview(client.db,other,query(),now);assert.equal(newOwner.stats.activeMeetingCount,2);assert.equal(newOwner.activeMeetings.items.find(item=>item.classId==='class-23')?.classSnapshot.primaryTeacher.id,teacher.userId);
 await client.db.classroomMembership.update({where:{userId:teacher.userId},data:{status:'SUSPENDED'}});await assert.rejects(getClassroomOverview(client.db,teacher,query(),now),{code:'CLASSROOM_SUSPENDED'});
});
