import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { createDisposableDb, createTestClient, type DisposableDb } from '@/globals/libs/testDb';
import { buildEventStudentFilter } from '@/globals/utils/buildEventStudentFilter';
let fixture: DisposableDb, db: PrismaClient, disconnect: () => Promise<void>;
before(async () => {fixture=await createDisposableDb('test_custom_groups');({db,disconnect}=createTestClient(fixture.url));});
after(async () => {await disconnect?.();await fixture?.cleanup();});
test('custom membership lifecycle enforces one group and preserves academic links and recorded attendance', async () => {
 const {createCustomGroup,addCustomMember,updateCustomPosition,removeCustomMember}=await import('./membership');
 const admin=await db.user.create({data:{name:'Admin',email:'custom-admin@example.test',password:'test',role:'ADMIN',status:'ACTIVE'}});
 const actor={id:admin.id,credentialVersion:0};
 const house=await db.group.create({data:{name:'Azul',slug:'azul',category:'HOUSE'}});
 const student=await db.student.create({data:{firstName:'Member',lastName:'Student',groups:{connect:{id:house.id}}}});
 const a=await createCustomGroup(db,'SSC Officers',actor), b=await createCustomGroup(db,'SSLG Officers',actor);
 const membership=await addCustomMember(db,a.id,student.id,'President',actor);
 assert.equal(membership.position,'President');
 assert.equal((await addCustomMember(db,a.id,student.id,undefined,actor)).position,'President');
 await assert.rejects(addCustomMember(db,b.id,student.id,'Secretary',actor), /already assigned to SSC Officers/);
 assert.equal(await db.customGroupMembership.count({where:{studentId:student.id}}),1);
 await assert.rejects(db.customGroupMembership.create({data:{studentId:student.id,groupId:b.id}}), (error:unknown)=>(error as {code:string}).code==='P2002');
 await updateCustomPosition(db,a.id,student.id,'House Lord, Azul',actor);
 const event=await db.event.create({data:{title:'USWAG',category:'CUSTOM',status:'APPROVED',start:new Date(),end:new Date(Date.now()+3600000),includedGroups:{connect:[{id:a.id},{id:b.id}]}}});
 const includedGroups=[a,b];
 assert.equal(await db.student.count({where:buildEventStudentFilter({...event,includedGroups})}),1);
 const {recordAttendance}=await import('@/features/attendance/server/recordAttendance');
 for(const method of ['SCANNED','MANUAL'] as const){
  const recorded=await recordAttendance(db,{eventId:event.id,studentId:student.id,method},{...actor,role:'ADMIN'});
  assert.ok(recorded.record.timein);
 }
 const beforeRecord=await db.record.findFirstOrThrow({where:{eventId:event.id}});
 await removeCustomMember(db,a.id,student.id,actor);
 assert.equal(await db.student.count({where:buildEventStudentFilter({...event,includedGroups})}),0);
 for(const method of ['SCANNED','MANUAL'] as const) await assert.rejects(recordAttendance(db,{eventId:event.id,studentId:student.id,method},{...actor,role:'ADMIN'}),/not a member of the custom groups/);
 assert.deepEqual(await db.record.findUnique({where:{id:beforeRecord.id}}),beforeRecord);
 assert.equal(await db.attendanceChange.count({where:{recordId:beforeRecord.id}}),1);
 const fresh=await db.student.findUniqueOrThrow({where:{id:student.id},include:{groups:true}});
 assert.deepEqual(fresh.groups.map(g=>g.id),[house.id]);
 await addCustomMember(db,b.id,student.id,null,actor);
 assert.equal(await db.student.count({where:buildEventStudentFilter({...event,includedGroups})}),1);
});
test('membership mutations reject organizers, stale credentials, and system groups', async () => {
 const {createCustomGroup,addCustomMember}=await import('./membership');
 const org=await db.user.create({data:{name:'Org',email:'custom-org@example.test',password:'test',role:'ORGANIZER',status:'ACTIVE'}});
 await assert.rejects(createCustomGroup(db,'Denied',{id:org.id,credentialVersion:0}), /Forbidden/);
 const admin=await db.user.findFirstOrThrow({where:{role:'ADMIN'}});
 await assert.rejects(createCustomGroup(db,'Denied',{id:admin.id,credentialVersion:99}),/Unauthorized/);
 const house=await db.group.findFirstOrThrow({where:{category:'HOUSE'}}),student=await db.student.findFirstOrThrow();
 await assert.rejects(addCustomMember(db,house.id,student.id,null,{id:admin.id,credentialVersion:0}),/Custom group not found/);
});
test('concurrent custom assignments have only one winner and no academic changes', async () => {
 const {createCustomGroup,addCustomMember}=await import('./membership');
 const admin=await db.user.findFirstOrThrow({where:{role:'ADMIN'}}),actor={id:admin.id,credentialVersion:0};
 const a=await createCustomGroup(db,'Concurrent A',actor),b=await createCustomGroup(db,'Concurrent B',actor);
 const s=await db.student.create({data:{firstName:'Concurrent',lastName:'Member'}});
 const results=await Promise.allSettled([addCustomMember(db,a.id,s.id,null,actor),addCustomMember(db,b.id,s.id,null,actor)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(await db.customGroupMembership.count({where:{studentId:s.id}}),1);
});
