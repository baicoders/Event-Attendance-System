import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createDisposableDb, createTestClient } from '@/globals/libs/testDb';
import { studentEditVersion } from '@/globals/utils/studentDetail';
import { correctStudentProfile, getStudentProfile } from './profileChanges';
import { verifyStudentProfile } from './verification';
let fixture: Awaited<ReturnType<typeof createDisposableDb>>;
let client: ReturnType<typeof createTestClient>;
const actors=[{userId:'teacher-a',credentialVersion:0},{userId:'teacher-b',credentialVersion:0}];
before(async()=>{
 fixture=await createDisposableDb();client=createTestClient(fixture.url);
 for(const actor of actors){await client.db.user.create({data:{id:actor.userId,name:actor.userId,email:actor.userId+'@example.test',password:'test',role:'MEMBER'}});await client.db.classroomMembership.create({data:{userId:actor.userId,status:'APPROVED',departmentOrDesignation:'Faculty'}});}
});
after(async()=>{await client?.disconnect();await fixture?.cleanup();});
const create=()=>client.db.student.create({data:{firstName:'Original',lastName:'Student',usn:String(Date.now()).slice(-11)},include:{groups:true}});
test('two teachers sharing one expected version cannot overwrite each other',async()=>{
 const student=await create();const expectedVersion=studentEditVersion(student);
 const results=await Promise.allSettled(actors.map((actor,i)=>correctStudentProfile(client.db,actor,student.id,{commandId:randomUUID(),expectedVersion,student:{firstName:'Teacher'+i},reason:'Verified spelling'})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const changes=await client.db.studentProfileChange.findMany({where:{studentId:student.id},orderBy:{id:'asc'}});
 assert.equal(changes.length,2);assert.equal(changes[1].fromRevision,0);assert.equal(changes[1].toRevision,1);
 assert.equal((changes[1].before as {firstName:string}).firstName,'Original');
 assert.ok(actors.some(a=>a.userId===changes[1].actorId));
 await assert.rejects(client.db.studentProfileChange.update({where:{id:changes[1].id},data:{reason:'tamper'}}));
});
test('verification is version bound; no-op keeps it; individual corrections invalidate it',async()=>{
 const student=await create();const actor=actors[0];
 await verifyStudentProfile(client.db,actor,student.id,{commandId:randomUUID(),expectedVersion:studentEditVersion(student),state:'VERIFIED'});
 assert.equal((await getStudentProfile(client.db,actor,student.id)).verification.state,'VERIFIED');
 const noop=await correctStudentProfile(client.db,actor,student.id,{commandId:randomUUID(),expectedVersion:studentEditVersion(student),student:{firstName:student.firstName},reason:'Confirm original spelling'});
 assert.equal(noop.data.profileRevision,0);
 assert.equal((await getStudentProfile(client.db,actor,student.id)).verification.state,'VERIFIED');
 await correctStudentProfile(client.db,actor,student.id,{commandId:randomUUID(),expectedVersion:noop.data.editVersion,student:{firstName:'Corrected'},reason:'Checked student record'});
 assert.equal((await getStudentProfile(client.db,actor,student.id)).verification.state,'UNVERIFIED');
});
test('teacher cannot patch house, stable ID or privileges and preserves unrelated memberships',async()=>{
 const student=await create();
 for(const patch of [{house:'house-a'},{id:'different'},{role:'ADMIN'}])await assert.rejects(async()=>correctStudentProfile(client.db,actors[0],student.id,{commandId:randomUUID(),expectedVersion:studentEditVersion(student),student:patch,reason:'Rejected'}));
 const house=await client.db.group.create({data:{name:'House',slug:'house-a',category:'HOUSE'}});
 await client.db.student.update({where:{id:student.id},data:{groups:{connect:{id:house.id}}}});
 const fresh=await client.db.student.findUniqueOrThrow({where:{id:student.id},include:{groups:true}});
 await correctStudentProfile(client.db,actors[0],student.id,{commandId:randomUUID(),expectedVersion:studentEditVersion(fresh),student:{firstName:'Allowed'},reason:'Spelling'});
 assert.equal(await client.db.group.count({where:{id:house.id,students:{some:{id:student.id}}}}),1);
});
test('implicit section reassignment creates one history revision per transaction and invalidates verification',async()=>{
 const student=await create();const a=await client.db.group.create({data:{name:'Section A',slug:'section-a',category:'SECTION'}});const b=await client.db.group.create({data:{name:'Section B',slug:'section-b',category:'SECTION'}});
 await client.db.student.update({where:{id:student.id},data:{groups:{connect:{id:a.id}}}});
 let fresh=await client.db.student.findUniqueOrThrow({where:{id:student.id},include:{groups:true}});
 await verifyStudentProfile(client.db,actors[0],student.id,{commandId:randomUUID(),expectedVersion:studentEditVersion(fresh),state:'VERIFIED'});
 const revision=fresh.profileRevision;
 await client.db.$transaction(async tx=>{await tx.student.update({where:{id:student.id},data:{groups:{disconnect:{id:a.id}}}});await tx.student.update({where:{id:student.id},data:{groups:{connect:{id:b.id}}}});});
 fresh=await client.db.student.findUniqueOrThrow({where:{id:student.id},include:{groups:true}});
 assert.equal(fresh.profileRevision,revision+1);assert.equal((await getStudentProfile(client.db,actors[0],student.id)).verification.state,'UNVERIFIED');
});

test('history failure rolls back profile, reservation changes and command receipt',async()=>{
 const db=client.db;const student=await create();const commandId=randomUUID();
 await db.$executeRawUnsafe(`CREATE FUNCTION fail_profile_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."studentId"='${student.id}' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$`);
 await db.$executeRawUnsafe('CREATE TRIGGER fail_profile_audit BEFORE INSERT ON "StudentProfileChange" FOR EACH ROW EXECUTE FUNCTION fail_profile_audit()');
 try{await assert.rejects(correctStudentProfile(db,actors[0],student.id,{commandId,expectedVersion:studentEditVersion(student),student:{firstName:'Failed'},reason:'Failure injection'}));}
 finally{await db.$executeRawUnsafe('DROP TRIGGER fail_profile_audit ON "StudentProfileChange"');await db.$executeRawUnsafe('DROP FUNCTION fail_profile_audit()');}
 assert.equal((await db.student.findUniqueOrThrow({where:{id:student.id}})).firstName,'Original');
 assert.equal(await db.classroomCommandReceipt.count({where:{commandId}}),0);
 assert.equal(await db.studentProfilePending.count(),0);
});
test('raw import invalidates verification, increments once and replays without extra audit',async()=>{
 const {createHash}=await import('node:crypto');const {previewStudentImport,commitStudentImport}=await import('../import/server');
 const db=client.db;const student=await create();
 await verifyStudentProfile(db,actors[0],student.id,{commandId:randomUUID(),expectedVersion:studentEditVersion(student),state:'VERIFIED'});
 const admin=await db.user.create({data:{name:'Import Admin',email:'import-admin@example.test',password:'test',role:'ADMIN',status:'ACTIVE'}});
 const csv=`usn,firstName,lastName,yearLevel\n${student.usn},Original,Student,YEAR_2\n`;
 const input={v:2 as const,fileName:'verify.csv',sourceHash:createHash('sha256').update(csv).digest('hex'),csv};
 const preview=await previewStudentImport(db,input,admin);assert.equal(preview.counts.update,1);
 const command={...input,previewToken:preview.previewToken!,commandId:randomUUID()};
 await commitStudentImport(db,command,admin);
 assert.equal((await getStudentProfile(db,actors[0],student.id)).verification.state,'UNVERIFIED');
 assert.equal((await db.student.findUniqueOrThrow({where:{id:student.id}})).profileRevision,1);
 const before=await db.studentProfileChange.count({where:{studentId:student.id}});
 const replay=await commitStudentImport(db,command,admin);assert.equal(replay.replayed,true);
 assert.equal(await db.studentProfileChange.count({where:{studentId:student.id}}),before);
 assert.equal((await db.studentProfileChange.findFirstOrThrow({where:{studentId:student.id},orderBy:{id:'desc'}})).actorId,admin.id);
});

test('SQL rejects fabricated baseline revisions and direct revision rewrites',async()=>{
 const student=await create();
 await assert.rejects(client.db.studentProfileChange.create({data:{studentId:student.id,fromRevision:null,toRevision:7,after:{},actorName:'Invalid baseline',source:'SYSTEM'}}));
 await assert.rejects(client.db.student.update({where:{id:student.id},data:{profileRevision:99}}));
});

test('profile history cursor remains stable when new corrections are appended',async()=>{
 const {studentChangeHistory}=await import('./profileChanges');const student=await create();
 const saved=await correctStudentProfile(client.db,actors[0],student.id,{commandId:randomUUID(),expectedVersion:studentEditVersion(student),student:{firstName:'First edit'},reason:'First correction'});
 const first=await studentChangeHistory(client.db,actors[0],student.id,new URLSearchParams('limit=1'));
 assert.equal(first.items.length,1);assert.equal(first.items[0].toRevision,1);assert.ok(first.nextCursor);
 await correctStudentProfile(client.db,actors[0],student.id,{commandId:randomUUID(),expectedVersion:saved.data.editVersion,student:{firstName:'Later edit'},reason:'Later correction'});
 const second=await studentChangeHistory(client.db,actors[0],student.id,new URLSearchParams({limit:'1',cursor:first.nextCursor!}));
 assert.equal(second.items.length,1);assert.equal(second.items[0].toRevision,0);assert.equal(second.nextCursor,null);
});

test('teacher explicitly repairs ambiguous official sections without an admin and preserves unrelated groups',async()=>{
 const student=await create();const db=client.db;
 const a=await db.group.create({data:{slug:'repair-a',name:'Repair A',category:'SECTION'}});const b=await db.group.create({data:{slug:'repair-b',name:'Repair B',category:'SECTION'}});const house=await db.group.create({data:{slug:'repair-house',name:'Repair House',category:'HOUSE'}});
 await db.student.update({where:{id:student.id},data:{groups:{connect:[{id:a.id},{id:b.id},{id:house.id}]}}});
 const fresh=await db.student.findUniqueOrThrow({where:{id:student.id},include:{groups:true}});const expectedVersion=studentEditVersion(fresh);
 await assert.rejects(correctStudentProfile(db,actors[0],student.id,{commandId:randomUUID(),expectedVersion,student:{firstName:'Should not normalize'},reason:'Spelling only'}),{code:'STUDENT_GROUP_REVIEW_REQUIRED'});
 await assert.rejects(verifyStudentProfile(db,actors[0],student.id,{commandId:randomUUID(),expectedVersion,state:'VERIFIED'}),{code:'STUDENT_GROUP_REVIEW_REQUIRED'});
 await verifyStudentProfile(db,actors[0],student.id,{commandId:randomUUID(),expectedVersion,state:'NEEDS_CORRECTION',note:'Two official sections need repair'});
 await correctStudentProfile(db,actors[0],student.id,{commandId:randomUUID(),expectedVersion,student:{section:a.slug},reason:'Confirmed official section A with school record'});
 const repaired=await db.student.findUniqueOrThrow({where:{id:student.id},include:{groups:true}});
 assert.deepEqual(repaired.groups.map(group=>group.id).sort(),[a.id,house.id].sort());assert.equal(repaired.profileRevision,fresh.profileRevision+1);
});

test('verification cannot certify a record with missing required identity data',async()=>{
 const student=await client.db.student.create({data:{firstName:'',lastName:'Incomplete'},include:{groups:true}});
 await assert.rejects(verifyStudentProfile(client.db,actors[0],student.id,{commandId:randomUUID(),expectedVersion:studentEditVersion(student),state:'VERIFIED'}),{code:'STUDENT_PROFILE_INVALID'});
 await verifyStudentProfile(client.db,actors[0],student.id,{commandId:randomUUID(),expectedVersion:studentEditVersion(student),state:'NEEDS_CORRECTION',note:'Name and official number are missing'});
});
