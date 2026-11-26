import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after,before,test } from 'node:test';
import { createDisposableDb,createTestClient } from '@/globals/libs/testDb';
import { createAcademicTerm,createSubject,updateAcademicTerm,updateSubject } from './catalog';
import { createClassOffering,getClassOffering,listClassOfferings,updateClassOffering,transferClassOwner } from './classes';
import { getClassRoster,saveClassRoster } from './rosters';
let fixture:Awaited<ReturnType<typeof createDisposableDb>>;let client:ReturnType<typeof createTestClient>;
const teacher={userId:'teacher-a',credentialVersion:0};const other={userId:'teacher-b',credentialVersion:0};const admin={userId:'class-admin',credentialVersion:0};let termId:string;let subjectId:string;let classId:string;let firstCreateInput:ReturnType<typeof createInput>;
before(async()=>{
 fixture=await createDisposableDb();client=createTestClient(fixture.url);
 for(const actor of [teacher,other,admin]){await client.db.user.create({data:{id:actor.userId,name:actor.userId,email:actor.userId+'@example.test',password:'test',role:actor===admin?'ADMIN':'MEMBER',status:actor===admin?'ACTIVE':'PENDING'}});if(actor!==admin)await client.db.classroomMembership.create({data:{userId:actor.userId,status:'APPROVED',departmentOrDesignation:'Faculty'}});}
 for(const [id,category] of [['3a','SECTION'],['3b','SECTION'],['other','SECTION'],['house','HOUSE'],['employees','HOUSE']] as const)await client.db.group.create({data:{id,slug:id,name:id,category}});
 for(const [index,[id,section]] of [['a','3a'],['b','3b'],['excluded','3a'],['irregular-1','other'],['irregular-2','other']].entries())await client.db.student.create({data:{id,usn:String(index+1000).padStart(11,'0'),firstName:'Student',lastName:id,groups:{connect:{id:section}}}});
 termId=(await createAcademicTerm(client.db,teacher,{commandId:randomUUID(),name:'Term One',startDate:'2026-08-01',endDate:'2027-05-31'})).data.id;
 subjectId=(await createSubject(client.db,teacher,{commandId:randomUUID(),code:'CS202',title:'Programming 2'})).data.id;
});
after(async()=>{await client?.disconnect();await fixture?.cleanup();});
const createInput=()=>({commandId:randomUUID(),termId,subjectId,displayName:'Programming 2 — Class A',graceMinutes:15,sectionIds:['3a','3b'],exceptions:[{studentId:'irregular-1',kind:'INCLUDE',reason:'Irregular enrollment'},{studentId:'irregular-2',kind:'INCLUDE',reason:'Irregular enrollment'},{studentId:'excluded',kind:'EXCLUDE',reason:'Does not take this subject'}]});
test('teachers create combined-section classes independently; exceptions persist across forty roster reads',async()=>{
 const input=createInput();firstCreateInput=input;const created=await createClassOffering(client.db,teacher,input);classId=created.data.id;
 const first=await getClassRoster(client.db,teacher,classId,new URLSearchParams());
 assert.deepEqual(first.items.map(row=>row.studentId).sort(),['a','b','irregular-1','irregular-2']);assert.equal(first.total,4);assert.match(first.rosterFingerprint,/^[a-f0-9]{64}$/);
 for(let meeting=0;meeting<40;meeting++)assert.equal((await getClassRoster(client.db,teacher,classId,new URLSearchParams())).rosterFingerprint,first.rosterFingerprint);
 assert.equal((await client.db.student.findUniqueOrThrow({where:{id:'irregular-1'},include:{groups:true}})).groups[0].id,'other');
 const replay=await createClassOffering(client.db,teacher,input);assert.equal(replay.replayed,true);assert.equal(replay.data.id,classId);
 assert.equal((await client.db.classroomCommandReceipt.findUniqueOrThrow({where:{actorId_commandId:{actorId:teacher.userId,commandId:input.commandId}}})).httpStatus,201);
 const another=await createClassOffering(client.db,other,{...createInput(),commandId:randomUUID(),exceptions:[],sectionIds:['3a']});
 assert.deepEqual((await getClassRoster(client.db,other,another.data.id,new URLSearchParams())).items.map(row=>row.studentId).sort(),['a','excluded']);
});
test('non-owners cannot read, modify or replay classes; a teacher cannot forge ownership',async()=>{
 await assert.rejects(getClassOffering(client.db,other,classId),{code:'CLASS_NOT_FOUND'});
 await assert.rejects(updateClassOffering(client.db,other,classId,{commandId:randomUUID(),expectedConfigRevision:0,displayName:'Unauthorized'}),{code:'CLASS_NOT_FOUND'});
 await assert.rejects(createClassOffering(client.db,teacher,{...createInput(),primaryTeacherId:other.userId}),{status:403});
 const list=await listClassOfferings(client.db,other,new URLSearchParams());assert.ok(list.items.every(item=>item.primaryTeacherId===other.userId));assert.ok(list.items.every(item=>!Object.hasOwn(item,'exceptions')&&Object.hasOwn(item,'activeSession')&&Object.hasOwn(item,'latestSession')),'class lists return bounded summaries with meeting actions');
});
test('invalid or employee section categories are rejected and cannot bypass SQL guards',async()=>{
 for(const sectionId of ['house','employees','missing'])await assert.rejects(createClassOffering(client.db,teacher,{...createInput(),sectionIds:[sectionId]}));
 await assert.rejects(client.db.classSection.create({data:{classId,sectionId:'house'}}));
 await assert.rejects(client.db.group.update({where:{id:'3a'},data:{category:'HOUSE'}}));
});
test('concurrent roster edits are versioned independently of settings and never mutate official student sections',async()=>{
 const results=await Promise.allSettled(['3a','3b'].map(sectionId=>saveClassRoster(client.db,teacher,{classId,commandId:randomUUID(),expectedRosterRevision:0,sectionIds:[sectionId],exceptions:[]})));
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected').length,1);
 const fresh=await getClassOffering(client.db,teacher,classId);assert.equal(fresh.configRevision,0);assert.equal(fresh.rosterRevision,1);
 assert.equal((await client.db.student.findUniqueOrThrow({where:{id:'a'},include:{groups:true}})).groups[0].id,'3a');
 const before=(await getClassRoster(client.db,teacher,classId,new URLSearchParams())).rosterFingerprint;
 await client.db.student.update({where:{id:'a'},data:{firstName:'Corrected'}});
 const after=(await getClassRoster(client.db,teacher,classId,new URLSearchParams())).rosterFingerprint;
 if(fresh.sections.some(section=>section.sectionId==='3a'))assert.notEqual(after,before);
});
test('catalog duplicates, admin assistance, ownership transfer and archive preserve independent grants',async()=>{
 await assert.rejects(createAcademicTerm(client.db,other,{commandId:randomUUID(),name:'  term   one ',startDate:'2026-08-01',endDate:'2027-05-31'}),{status:409});
 await assert.rejects(createSubject(client.db,other,{commandId:randomUUID(),code:'cs202',title:'Other spelling'}),{status:409});
 const onBehalf=await createClassOffering(client.db,admin,{...createInput(),primaryTeacherId:teacher.userId,reason:'Help teacher with initial setup'});
 const transfer=await transferClassOwner(client.db,admin,onBehalf.data.id,{commandId:randomUUID(),expectedConfigRevision:0,teacherId:other.userId,reason:'Correct teacher assignment'});
 assert.equal(transfer.data.primaryTeacherId,other.userId);
 await assert.rejects(getClassOffering(client.db,teacher,onBehalf.data.id),{code:'CLASS_NOT_FOUND'});
 const archived=await updateClassOffering(client.db,other,onBehalf.data.id,{commandId:randomUUID(),expectedConfigRevision:transfer.data.configRevision,archived:true});assert.ok(archived.data.archivedAt);
 assert.equal((await client.db.user.findUniqueOrThrow({where:{id:teacher.userId}})).role,'MEMBER');
});

test('class creation replay rechecks current ownership after administrative transfer',async()=>{
 await transferClassOwner(client.db,admin,classId,{commandId:randomUUID(),expectedConfigRevision:0,teacherId:other.userId,reason:'Transfer teaching assignment'});
 await assert.rejects(createClassOffering(client.db,teacher,firstCreateInput),{code:'CLASS_NOT_FOUND'});
});
test('durable roster replay precedes mutable student eligibility checks',async()=>{
 const created=await createClassOffering(client.db,teacher,{...createInput(),commandId:randomUUID()});
 const command={classId:created.data.id,commandId:randomUUID(),expectedRosterRevision:0,sectionIds:['3a'],exceptions:[{studentId:'irregular-1',kind:'INCLUDE',reason:'Irregular enrollment'}]};
 const saved=await saveClassRoster(client.db,teacher,command);
 await client.db.student.update({where:{id:'irregular-1'},data:{archivedAt:new Date()}});
 const replay=await saveClassRoster(client.db,teacher,command);assert.equal(replay.replayed,true);assert.deepEqual(replay.data,saved.data);
});

test('unchanged JSONB schedule settings keep their configuration revision',async()=>{
 const schedule={v:1,days:[1,3],startTime:'08:00',endTime:'09:00',room:'Room 101'};
 const created=await createClassOffering(client.db,teacher,{...createInput(),exceptions:[],schedule});
 const saved=await updateClassOffering(client.db,teacher,created.data.id,{commandId:randomUUID(),expectedConfigRevision:0,schedule});
 assert.equal(saved.data.changed,false);assert.equal(saved.data.configRevision,0);
});

test('global catalog corrections and archive are audited administrator actions with concurrency checks',async()=>{
 await assert.rejects(updateSubject(client.db,teacher,subjectId,{commandId:randomUUID(),expectedRevision:0,title:'Unapproved global change',reason:'Attempt'}),{status:403});
 const subject=await updateSubject(client.db,admin,subjectId,{commandId:randomUUID(),expectedRevision:0,title:'Programming II',reason:'Correct official subject title'});assert.equal(subject.data.revision,1);
 await assert.rejects(updateSubject(client.db,admin,subjectId,{commandId:randomUUID(),expectedRevision:0,archived:true,reason:'Stale catalog edit'}),{status:409});
 const term=await updateAcademicTerm(client.db,admin,termId,{commandId:randomUUID(),expectedRevision:0,archived:true,reason:'Archive completed academic term'});assert.ok(term.data.archivedAt);
 await assert.rejects(createClassOffering(client.db,teacher,{...createInput(),exceptions:[]}),{code:'TERM_UNAVAILABLE'});
});
