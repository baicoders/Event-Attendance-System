import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before,after,test } from 'node:test';
import { Pool } from 'pg';
import { getPgPoolConfig } from '@/globals/libs/dbConfig';
import { createDisposableDb,createTestClient } from '@/globals/libs/testDb';
import { buildAttendancePolicy } from '../utils/attendancePolicy';
let fixture:Awaited<ReturnType<typeof createDisposableDb>>;let client:ReturnType<typeof createTestClient>;let classId:string;
const policy=buildAttendancePolicy('2026-08-03T08:00:00+08:00',15);
const sessionData=()=>({classId,scheduledStartAt:new Date(policy.scheduledStartAt),graceMinutes:15,lateAfter:new Date(policy.lateAfter),originalPolicySnapshot:policy,classSnapshot:{v:1,id:classId},rosterConfigSnapshot:{v:1,count:1},startedById:'teacher',startedByName:'Teacher'});
before(async()=>{
 fixture=await createDisposableDb();
 const setupPool=new Pool(getPgPoolConfig(fixture.url));
 try{await setupPool.query(`ALTER DATABASE "${fixture.dbName}" SET timezone TO 'Asia/Manila'`);}finally{await setupPool.end();}
 client=createTestClient(fixture.url);
 await client.db.user.create({data:{id:'teacher',name:'Teacher',email:'teacher@example.test',password:'test',role:'MEMBER'}});
 const term=await client.db.academicTerm.create({data:{name:'Term',normalizedKey:'term',startDate:new Date('2026-01-01'),endDate:new Date('2026-12-31'),createdById:'teacher'}});
 const subject=await client.db.subject.create({data:{title:'Programming',normalizedTitle:'programming',createdById:'teacher'}});
 classId=(await client.db.classOffering.create({data:{termId:term.id,subjectId:subject.id,primaryTeacherId:'teacher',displayName:'Class'}})).id;
 for(const id of ['student','other'])await client.db.student.create({data:{id,firstName:'Student',lastName:id}});
});
after(async()=>{await client?.disconnect();await fixture?.cleanup();});
async function createSession(){
 return client.db.$transaction(async tx=>{
  const row=await tx.classroomSession.create({data:sessionData()});
  await tx.sessionRosterMember.create({data:{sessionId:row.id,studentId:'student',studentSnapshot:{v:1,id:'student'},originSnapshot:{v:1}}});
  await tx.classroomAttendance.create({data:{sessionId:row.id,studentId:'student'}});return row;
 });
}
let sessionId:string;
test('M4 rejects incomplete or mismatched session creation, then materializes a valid atomic session',async()=>{
 await assert.rejects(client.db.classroomSession.create({data:sessionData()}));
 await assert.rejects(client.db.classroomSession.create({data:{...sessionData(),originalPolicySnapshot:{...policy,graceMinutes:30}}}));
 const row=await createSession();sessionId=row.id;assert.equal(row.scheduledStartAt.toISOString(),policy.scheduledStartAt);
 assert.deepEqual(await client.db.$queryRaw`SHOW timezone`,[{TimeZone:'UTC'}]);
 await assert.rejects(createSession());assert.equal(await client.db.classroomSession.count(),1);
});
test('original snapshots and declared original member count cannot be rewritten or extended by direct SQL',async()=>{
 await assert.rejects(client.db.sessionRosterMember.update({where:{sessionId_studentId:{sessionId,studentId:'student'}},data:{studentSnapshot:{v:1,id:'other'}}}));
 await assert.rejects(client.db.$transaction(async tx=>{
  await tx.sessionRosterMember.create({data:{sessionId,studentId:'other',studentSnapshot:{v:1,id:'other'},originSnapshot:{v:1}}});
  await tx.classroomAttendance.create({data:{sessionId,studentId:'other'}});
 }));
 await assert.rejects(client.db.classroomSession.update({where:{id:sessionId},data:{classSnapshot:{v:1,id:'different'}}}));
 await assert.rejects(client.db.classroomSession.delete({where:{id:sessionId}}));
});
test('a finalized session cannot commit with eligible unmarked results',async()=>{
 await assert.rejects(client.db.classroomSession.update({where:{id:sessionId},data:{state:'FINALIZED',finalizedAt:new Date(),finalizedById:'teacher',finalizedByName:'Teacher',lifecycleRevision:1}}));
 assert.equal((await client.db.classroomSession.findUniqueOrThrow({where:{id:sessionId}})).state,'ACTIVE');
 await client.db.$transaction(async tx=>{
  await tx.classroomAttendance.update({where:{sessionId_studentId:{sessionId,studentId:'student'}},data:{status:'ABSENT',method:'FINALIZATION',markedAt:new Date(),recordedById:'teacher',recordedByName:'Teacher',lastModifiedById:'teacher',lastModifiedByName:'Teacher',revision:1}});
  await tx.classroomSession.update({where:{id:sessionId},data:{state:'FINALIZED',finalizedAt:new Date(),finalizedById:'teacher',finalizedByName:'Teacher',lifecycleRevision:1}});
 });
 await assert.rejects(client.db.classroomAttendance.update({where:{sessionId_studentId:{sessionId,studentId:'student'}},data:{status:'UNMARKED',revision:2}}));
 await assert.rejects(client.db.classroomAttendance.delete({where:{sessionId_studentId:{sessionId,studentId:'student'}}}));
});
test('attendance change history is immutable',async()=>{
 const change=await client.db.classroomAttendanceChange.create({data:{sessionId,studentId:'student',action:'FINALIZE_ABSENT',before:{status:'UNMARKED'},after:{status:'ABSENT'},actorId:'teacher',actorName:'Teacher',commandId:randomUUID()}});
 await assert.rejects(client.db.classroomAttendanceChange.update({where:{id:change.id},data:{reason:'Tampering'}}));
 await assert.rejects(client.db.classroomAttendanceChange.delete({where:{id:change.id}}));
});
