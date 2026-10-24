import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createDisposableDb,createTestClient} from '../../../globals/libs/testDb';
import {previewStudentImport,commitStudentImport,prepareImport} from './server';
import {signImportToken,IMPORT_TOKEN_PURPOSE} from './token';
import {hashImportCommand} from './commandHash';
const source=(csv:string)=>({v:2 as const,fileName:'synthetic.csv',csv,sourceHash:createHash('sha256').update(csv).digest('hex')});
test('server rejects unsupported display file formats before preparing a new import', () => {
 assert.throws(()=>prepareImport({...source('usn,firstName,lastName\n00000123456,Synthetic,Student'),fileName:'unsafe.exe'}),{code:'UNSUPPORTED_FILE_TYPE'});
});
test('reviewed partial upserts preserve groups/history, replay safely, block conflicts and roll back receipt failures',async()=>{
 const fixture=await createDisposableDb('test_partial_import');const {db,disconnect}=createTestClient(fixture.url);
 try {
  const actor=await db.user.create({data:{name:'Synthetic Admin',email:'partial-import@example.test',password:'fixture',role:'ADMIN',status:'ACTIVE'}});
  const house=await db.group.create({data:{name:'Blue',slug:'blue',category:'HOUSE'}});
  const student=await db.student.create({data:{id:'00000123456',usn:'00000123456',firstName:'Synthetic',lastName:'Student',groups:{connect:{id:house.id}}}});
  const event=await db.event.create({data:{title:'Fixture',category:'ALL',start:new Date(),end:new Date()}});
  const record=await db.record.create({data:{eventId:event.id,studentId:student.id,method:'SCANNED'}});
  const input=source('usn,lrn,firstName,lastName\n00000123456,000000123456,Synthetic,Student\n,000000123457,Synthetic,Learner');
  const review=await previewStudentImport(db,input,actor);assert.equal(review.counts.update,1);assert.equal(review.counts.create,1);assert.ok(review.previewToken);
  const command={...input,previewToken:review.previewToken!,commandId:randomUUID()};
  const first=await commitStudentImport(db,command,actor);assert.equal(first.receipt.v,2);
  const retained=await db.student.findUniqueOrThrow({where:{id:student.id},include:{groups:true}});
  assert.equal(retained.lrn,'000000123456');assert.equal(retained.groups[0].id,house.id);assert.equal(retained.schoolLevel,null);
  assert.equal((await db.record.findUniqueOrThrow({where:{id:record.id}})).studentId,student.id);
  const created=await db.student.findUniqueOrThrow({where:{lrn:'000000123457'}});assert.notEqual(created.id,created.lrn);assert.equal(created.usn,null);
  const repeated=await previewStudentImport(db,input,actor);assert.equal(repeated.counts.unchanged,2);
  const replay=await commitStudentImport(db,command,actor);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,first.receipt);assert.equal(await db.student.count(),2);
  const split=await previewStudentImport(db,source('usn,lrn,firstName,lastName\n00000123456,000000123457,Synthetic,Conflict'),actor);assert.equal(split.counts.blocked,1);assert.equal(split.previewToken,null);
  const staleInput=source('usn,lrn,firstName,lastName\n00000123458,,Synthetic,New');
  const stale=await previewStudentImport(db,staleInput,actor);
  await db.student.update({where:{id:created.id},data:{usn:'00000123458'}});
  await assert.rejects(commitStudentImport(db,{...staleInput,previewToken:stale.previewToken!,commandId:randomUUID()},actor),{code:'STALE_PREVIEW'});
  const failureInput=source('lrn,firstName,lastName\n000000123459,Synthetic,Rollback');
  const failure=await previewStudentImport(db,failureInput,actor);
  await db.$executeRawUnsafe(`CREATE FUNCTION reject_import_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END; $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER reject_import_receipt BEFORE INSERT ON "StudentImportBatch" FOR EACH ROW EXECUTE FUNCTION reject_import_receipt()');
  await assert.rejects(commitStudentImport(db,{...failureInput,previewToken:failure.previewToken!,commandId:randomUUID()},actor),{code:'IMPORT_REJECTED'});
  assert.equal(await db.student.count({where:{lrn:'000000123459'}}),0);assert.equal(await db.studentImportBatch.count(),1);
  await db.$executeRawUnsafe('DROP TRIGGER reject_import_receipt ON "StudentImportBatch"');
  const concurrentCommand={...failureInput,previewToken:failure.previewToken!,commandId:randomUUID()};
  const concurrent=await Promise.all([commitStudentImport(db,concurrentCommand,actor),commitStudentImport(db,concurrentCommand,actor)]);
  assert.equal(concurrent.filter(result=>result.replayed).length,1);assert.equal(await db.student.count({where:{lrn:'000000123459'}}),1);
  const overlapInput=source('lrn,firstName,lastName\n000000123460,Synthetic,Overlap');
  const overlapReview=await previewStudentImport(db,overlapInput,actor);
  const overlap=await Promise.allSettled([randomUUID(),randomUUID()].map(commandId=>commitStudentImport(db,{...overlapInput,previewToken:overlapReview.previewToken!,commandId},actor)));
  assert.equal(overlap.filter(result=>result.status==='fulfilled').length,1);
  const overlapFailure=overlap.find(result=>result.status==='rejected');
  assert.ok(overlapFailure?.status==='rejected');assert.equal(overlapFailure.reason.code,'STALE_PREVIEW');
  assert.equal(await db.student.count({where:{lrn:'000000123460'}}),1);
 } finally {await disconnect();await fixture.cleanup();}
});

test('historical v1 exact replay survives upgrade and expiry without roster work',async()=>{
 const fixture=await createDisposableDb('test_legacy_import');const {db,disconnect}=createTestClient(fixture.url);
 try {
  const actor=await db.user.create({data:{name:'Synthetic Admin',email:'legacy-import@example.test',password:'fixture',role:'ADMIN',status:'ACTIVE'}});
  const csv='id,lastName,firstName,middleName,schoolLevel,yearLevel,section,house,program,department,strand\n00000123456,Student,Synthetic,,COLLEGE,YEAR_1,section,house,program,department,';
  const input={...source(csv),v:1 as const};const prepared=prepareImport(input);
  // Old source normalization and key order must remain byte-for-byte identical.
  const legacyRow={id:'00000123456',lastName:'Student',firstName:'Synthetic',middleName:'',schoolLevel:'COLLEGE',yearLevel:'YEAR_1',section:'section',house:'house',program:'program',department:'department',strand:''};
  assert.equal(prepared.normalizedInputHash,createHash('sha256').update(JSON.stringify({v:1,rows:[{csvRow:2,student:legacyRow}]})).digest('hex'));
  const now=Date.now();const token=signImportToken({v:1,purpose:IMPORT_TOKEN_PURPOSE,actorId:actor.id,fileName:input.fileName,sourceHash:input.sourceHash,normalizedInputHash:prepared.normalizedInputHash,reviewHash:'a'.repeat(64),preparedAt:now-700000,expiresAt:now-100000});
  const command={...input,previewToken:token,commandId:randomUUID()};
  const result={v:1,rows:[{csvRow:2,studentId:'00000123456',status:'UNCHANGED'}]};
  await db.studentImportBatch.create({data:{commandId:command.commandId,actorId:actor.id,actorNameSnapshot:actor.name,fileName:input.fileName,sourceFileHash:input.sourceHash,normalizedInputHash:prepared.normalizedInputHash,requestHash:hashImportCommand(command,actor.id,prepared),totalRows:1,createdCount:0,updatedCount:0,unchangedCount:1,result,contractVersion:1,createdAt:new Date(Date.now()-1000),committedAt:new Date()}});
  const prior=await db.studentImportBatch.findUniqueOrThrow({where:{actorId_commandId:{actorId:actor.id,commandId:command.commandId}}});
  await db.$executeRawUnsafe(readFileSync('prisma/migrations/20261023000200_student_import_v2/migration.sql','utf8'));
  assert.deepEqual(await db.studentImportBatch.findUniqueOrThrow({where:{id:prior.id}}),prior);
  await assert.rejects(db.studentImportBatch.update({where:{id:prior.id},data:{contractVersion:3,result:{v:3,rows:result.rows}}}));
  // If replay touched either roster model, PostgreSQL would reject the query.
  await db.$executeRawUnsafe('ALTER TABLE "Student" RENAME TO "Student_replay_forbidden"');
  const replay=await commitStudentImport(db,command,actor);assert.equal(replay.replayed,true);assert.equal(replay.receipt.v,1);assert.deepEqual(replay.receipt.result,result);
  await assert.rejects(previewStudentImport(db,input,actor),{code:'IMPORT_CONTRACT_UPGRADED'});
 } finally {await disconnect();await fixture.cleanup();}
});

test('exact historical v2 receipt replay bypasses tighter new-import row limits', async () => {
 const fixture=await createDisposableDb('test_historical_large_import');const {db,disconnect}=createTestClient(fixture.url);
 try {
  const actor=await db.user.create({data:{name:'Synthetic Admin',email:'historical-large@example.test',password:'fixture',role:'ADMIN',status:'ACTIVE'}});
  const csv='usn,firstName,lastName\n'+Array.from({length:10001},(_,i)=>`${String(i).padStart(11,'0')},Synthetic,Student`).join('\n');
  const input=source(csv);
  assert.throws(()=>prepareImport(input),{code:'INVALID_CSV'});
  const prepared={sourceHash:input.sourceHash,normalizedInputHash:'a'.repeat(64)};
  const now=Date.now();const token=signImportToken({v:1,purpose:IMPORT_TOKEN_PURPOSE,actorId:actor.id,fileName:input.fileName,sourceHash:input.sourceHash,normalizedInputHash:prepared.normalizedInputHash,reviewHash:'b'.repeat(64),preparedAt:now-700000,expiresAt:now-100000});
  const command={...input,previewToken:token,commandId:randomUUID()};
  const result={v:2,rows:Array.from({length:10001},(_,i)=>({csvRow:i+2,studentId:`synthetic-${i}`,status:'UNCHANGED'}))};
  await db.studentImportBatch.create({data:{commandId:command.commandId,actorId:actor.id,actorNameSnapshot:actor.name,fileName:input.fileName,sourceFileHash:input.sourceHash,normalizedInputHash:prepared.normalizedInputHash,requestHash:hashImportCommand(command,actor.id,prepared),totalRows:10001,createdCount:0,updatedCount:0,unchangedCount:10001,result,contractVersion:2,createdAt:new Date(now-1000),committedAt:new Date(now)}});
  await db.$executeRawUnsafe('ALTER TABLE "Student" RENAME TO "Student_replay_forbidden"');
  const replay=await commitStudentImport(db,command,actor);
  assert.equal(replay.replayed,true);assert.equal(replay.receipt.counts.total,10001);
  await assert.rejects(commitStudentImport(db,{...command,csv:csv+'\n'},actor),{code:'STALE_PREVIEW'});
 } finally {await disconnect();await fixture.cleanup();}
});
