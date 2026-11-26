import { setStudentWriteContext } from '@/globals/utils/studentProfileAudit';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createDisposableDb, createTestClient } from '@/globals/libs/testDb';
import { resolveStudentQrCode, findStudentByCanonicalId } from '@/globals/utils/studentIdentity';
import { changeQrDisposition } from './qrReservations';
let fixture: Awaited<ReturnType<typeof createDisposableDb>>;
let client: ReturnType<typeof createTestClient>;
before(async () => { fixture = await createDisposableDb(); client=createTestClient(fixture.url); });
after(async () => { await client?.disconnect(); await fixture?.cleanup(); });
test('legacy IDs, zeroes, same-owner overlaps, alias and retired values never change owners', async () => {
  const db=client.db;
  const student=await db.student.create({data:{id:'00000123456',usn:'00000123456',lrn:'000000123456',firstName:'Original',lastName:'Student'}});
  assert.equal(await resolveStudentQrCode(db,student.usn!),student.id);
  assert.equal(await resolveStudentQrCode(db,student.lrn!),student.id);
  await db.$transaction(async tx=>{
    await tx.student.update({where:{id:student.id},data:{usn:'00000123457'}});
    await changeQrDisposition(tx,student.id,['00000123456'],'REPRINT_REQUIRED');
  });
  await assert.rejects(resolveStudentQrCode(db,'00000123456'),{code:'QR_RETIRED'});
  assert.equal((await findStudentByCanonicalId(db,student.id))?.id,student.id);
  await assert.rejects(db.student.create({data:{usn:'00000123456',firstName:'Other',lastName:'Person'}}));
  await assert.rejects(db.$executeRaw`UPDATE "StudentQrCode" SET "reservedOwnerId"='other' WHERE code='00000123456'`);
  await assert.rejects(db.$executeRaw`DELETE FROM "StudentQrCode" WHERE code='00000123456'`);
  assert.equal(await resolveStudentQrCode(db,'not-a-student'),null);
});
test('database writers reserve generated IDs and retain safe alias history',async()=>{
 const db=client.db;
 const student=await db.student.create({data:{usn:'00000123458',firstName:'Alias',lastName:'Student'}});
 await db.$transaction(async tx=>{await setStudentWriteContext(tx,{actorName:'Confirmed maintenance operator',source:'MAINTENANCE',identifierDisposition:'KEEP_ALIAS_CONFIRMED'});await tx.student.update({where:{id:student.id},data:{usn:'00000123459'}});});
 const change=await db.studentProfileChange.findFirstOrThrow({where:{studentId:student.id},orderBy:{id:'desc'}});
 assert.equal((change.after as {_qrDisposition?:string})._qrDisposition,'KEEP_ALIAS_CONFIRMED');
 assert.equal(await resolveStudentQrCode(db,'00000123458'),student.id);
 assert.equal(await resolveStudentQrCode(db,student.id),student.id);
 await assert.rejects(db.student.create({data:{lrn:'00000123458',firstName:'Wrong',lastName:'Owner'}}));
 await assert.rejects(db.$executeRaw`UPDATE "StudentQrCode" SET state='RETIRED' WHERE code='00000123459'`);
});

test('tombstones survive deletion and direct SQL cannot claim or resurrect them',async()=>{
 const db=client.db;
 await db.$transaction(async tx=>{await tx.student.create({data:{id:'transient-student',usn:'00000123999',firstName:'Transient',lastName:'Record'}});await tx.student.delete({where:{id:'transient-student'}});});
 const code=await db.studentQrCode.findUniqueOrThrow({where:{code:'00000123999'}});
 assert.equal(code.state,'RETIRED');assert.equal(code.reservedOwnerId,'transient-student');assert.equal(code.studentId,null);
 await assert.rejects(db.student.create({data:{usn:'00000123999',firstName:'Different',lastName:'Student'}}));
 await assert.rejects(db.studentQrCode.update({where:{code:code.code},data:{state:'RESOLVABLE'}}));
});
test('retired numeric legacy raw code fails Events scanning but canonical manual attendance works',async()=>{
 const {recordAttendance}=await import('@/features/attendance/server/recordAttendance');const db=client.db;
 const actor=await db.user.create({data:{name:'Events Teacher',email:'qr-events@example.test',password:'test',role:'ORGANIZER',status:'ACTIVE'}});
 const event=await db.event.create({data:{title:'Canonical manual',category:'ALL',status:'APPROVED',createdById:actor.id,start:new Date(Date.now()-3600000),end:new Date(Date.now()+3600000)}});
 const input={eventId:event.id,studentId:'00000123456',method:'SCANNED' as const};
 await assert.rejects(recordAttendance(db,input,actor),{code:'QR_RETIRED'});
 const result=await recordAttendance(db,{...input,method:'MANUAL'},actor);
 assert.equal(result.record.studentId,'00000123456');assert.equal(result.created,true);
});

test('raw identifier replacement without explicit same-student card confirmation retires old cards',async()=>{
 const db=client.db;const student=await db.student.create({data:{usn:'00000123888',firstName:'Raw',lastName:'Correction'}});
 await db.student.update({where:{id:student.id},data:{usn:'00000123889'}});
 await assert.rejects(resolveStudentQrCode(db,'00000123888'),{code:'QR_RETIRED'});
});

test('read-only QR inventory scripts validate coverage without mutations',async()=>{
 const {qrReservationInventory}=await import('./qrInventory');const {spawnSync}=await import('node:child_process');const db=client.db;
 const before={codes:await db.studentQrCode.count(),history:await db.studentProfileChange.count()};
 const inventory=await qrReservationInventory(db);assert.equal(inventory.schemaReady,true);assert.equal(inventory.issues.length,0);
 for(const script of ['scripts/audit-qr-reservations.ts','scripts/backfill-qr-reservations.ts']){
  const run=spawnSync('pnpm',['exec','tsx',script],{env:{...process.env,DATABASE_URL:fixture.url,DIRECT_URL:fixture.url},encoding:'utf8',timeout:20000});
  assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout.trim()).mode,'read-only');
 }
 assert.deepEqual({codes:await db.studentQrCode.count(),history:await db.studentProfileChange.count()},before);
});
