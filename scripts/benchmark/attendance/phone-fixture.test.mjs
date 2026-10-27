import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { createDisposableDatabase } from '../../pg-test-db.mjs';
import { assertLocalMaintenanceUrl } from '../../attendance-e2e/safety.mjs';
import { seedPhoneAttendance } from './phone-fixture.mjs';

test('near-full phone fixtures reserve live cards and create complete immutable audit evidence',async()=>{
  assertLocalMaintenanceUrl(process.env.TEST_DATABASE_URL);
  const disposable=await createDisposableDatabase('test_phone_rehearsal');
  const pool=new Pool({connectionString:disposable.url,max:2});
  const db=new PrismaClient({adapter:new PrismaPg(pool)});
  try {
    const actor=await db.user.create({data:{name:'Fixture Operator',email:'phone@example.test',password:'synthetic',status:'ACTIVE'}});
    const event=await db.event.create({data:{title:'Near-full fixture',category:'ALL',status:'APPROVED',createdById:actor.id,start:new Date(),end:new Date()}});
    const students=Array.from({length:606},(_,index)=>({id:`c${String(index+1).padStart(24,'0')}`,firstName:'Test',middleName:null,lastName:`Student${index}`}));
    await db.student.createMany({data:students});
    assert.equal(await seedPhoneAttendance(db,event,actor,students),506);
    const records=await db.record.findMany({where:{eventId:event.id}});
    const changes=await db.attendanceChange.findMany({where:{eventId:event.id}});
    assert.equal(records.length,506);assert.equal(changes.length,506);
    assert.ok(records.every(record=>!students.slice(0,100).some(student=>student.id===record.studentId)));
    for(const record of records) {
      const audit=changes.find(change=>change.recordId===record.id);
      assert.equal(record.revision,1);assert.equal(record.timeout,null);
      assert.equal(audit.action,'CREATE');assert.equal(audit.before,null);
      assert.equal(audit.after.timein,record.timein.toISOString());
      assert.equal(audit.after.id,record.id);assert.equal(audit.actorName,'Fixture Operator');
      assert.equal(audit.eventTitle,'Near-full fixture');
      assert.equal(audit.studentLabel,`Test Student${Number(record.studentId.slice(1))-1}`);
    }
    const recordingModule=await import('../../../features/attendance/server/recordAttendance.ts');
    const {recordAttendance}=recordingModule.default ?? recordingModule;
    const user={id:actor.id,role:'ORGANIZER',credentialVersion:0};
    const fresh=await recordAttendance(db,{eventId:event.id,studentId:students[0].id,method:'SCANNED',expectedMode:'TIME_IN'},user);
    assert.equal(fresh.changed,true);
    const duplicate=await recordAttendance(db,{eventId:event.id,studentId:students[100].id,method:'SCANNED',expectedMode:'TIME_IN'},user);
    assert.equal(duplicate.changed,false);
    assert.equal(await db.record.count({where:{eventId:event.id}}),507);
    assert.equal(await db.attendanceChange.count({where:{eventId:event.id}}),507);
  } finally {await db.$disconnect();await pool.end();await disposable.cleanup();}
});
