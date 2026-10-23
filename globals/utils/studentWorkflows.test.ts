import test from 'node:test';
import assert from 'node:assert/strict';
import {createDisposableDb,createTestClient} from '../libs/testDb';
import {updateStudentDetail} from './studentEdit';
import {studentEditVersion} from './studentDetail';
import {recordAttendance} from '../../features/attendance/server/recordAttendance';
test('partial edits preserve unspecified information and external identifiers record one canonical attendance',async()=>{
 const fixture=await createDisposableDb('test_student_workflows');const {db,disconnect}=createTestClient(fixture.url);
 try {
  const house=await db.group.create({data:{name:'Fixture House',slug:'fixture-house',category:'HOUSE'}});
  const student=await db.student.create({data:{firstName:'Synthetic',lastName:'Student',usn:'00000123456',groups:{connect:{id:house.id}}},include:{groups:true}});
  const edited=await updateStudentDetail(db,student.id,{expectedVersion:studentEditVersion(student),student:{lrn:'000000123456'}});
  assert.equal(edited.kind,'ok');
  const current=await db.student.findUniqueOrThrow({where:{id:student.id},include:{groups:true}});
  assert.equal(current.lrn,'000000123456');assert.equal(current.usn,student.usn);assert.equal(current.groups[0].id,house.id);
  const user=await db.user.create({data:{name:'Fixture Admin',email:'workflows@example.test',password:'fixture',status:'ACTIVE',role:'ADMIN'}});
  const event=await db.event.create({data:{title:'Fixture All',category:'ALL',status:'APPROVED',start:new Date(),end:new Date()}});
  const actor={id:user.id,role:user.role,credentialVersion:0};
  for(const code of [current.id,current.usn!,current.lrn!]) {
    const result=await recordAttendance(db,{eventId:event.id,studentId:code,method:'SCANNED'},actor);
    assert.equal(result.record.studentId,student.id);
  }
  assert.equal(await db.record.count(),1);
  const other=await db.student.create({data:{id:'00000987654',firstName:'Other',lastName:'Synthetic',lrn:'000000123457'}});
  const conflict=await updateStudentDetail(db,student.id,{expectedVersion:studentEditVersion(current),student:{lrn:other.lrn}});
  assert.equal(conflict.kind,'identity-conflict');
  const noHouse=await db.student.create({data:{firstName:'Synthetic',lastName:'LRN',lrn:'000000123458'}});
  const scoped=await db.event.create({data:{title:'Fixture House',category:'HOUSE',status:'APPROVED',start:new Date(),end:new Date(),includedGroups:{connect:{id:house.id}}}});
  await assert.rejects(recordAttendance(db,{eventId:scoped.id,studentId:noHouse.lrn!,method:'MANUAL'},actor),{code:'STUDENT_UNAVAILABLE'});
 } finally {await disconnect();await fixture.cleanup();}
});
