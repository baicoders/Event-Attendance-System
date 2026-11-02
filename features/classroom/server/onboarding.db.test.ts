import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before,after,test } from 'node:test';
import { createDisposableDb,createTestClient } from '@/globals/libs/testDb';
import { getTeacherOnboarding,saveTeacherOnboarding } from './onboarding';
import { createAcademicTerm,createSubject } from './catalog';
import { createClassOffering,transferClassOwner,updateClassOffering } from './classes';
let fixture:Awaited<ReturnType<typeof createDisposableDb>>;
let client:ReturnType<typeof createTestClient>;
const actor={userId:'onboarding-teacher',credentialVersion:0};
const other={userId:'other-teacher',credentialVersion:0};
const admin={userId:'admin',credentialVersion:0};
let termId:string;let subjectId:string;let classId:string;let completedInput:Record<string,unknown>;
before(async()=>{
 fixture=await createDisposableDb();client=createTestClient(fixture.url);
 for(const user of [actor,other,admin]){
  await client.db.user.create({data:{id:user.userId,name:user.userId,email:user.userId+'@example.test',password:'test',role:user===admin?'ADMIN':'MEMBER',status:user===admin?'ACTIVE':'PENDING'}});
  if(user!==admin)await client.db.classroomMembership.create({data:{userId:user.userId,status:'APPROVED',departmentOrDesignation:'Teacher'}});
 }
 await client.db.group.create({data:{id:'section',name:'BSIT 3A',slug:'3a',category:'SECTION'}});
 await client.db.student.create({data:{id:'student',firstName:'First',lastName:'Student',groups:{connect:{id:'section'}}}});
 termId=(await createAcademicTerm(client.db,actor,{commandId:randomUUID(),name:'First term',startDate:'2026-01-01',endDate:'2027-12-31'})).data.id;
 subjectId=(await createSubject(client.db,actor,{commandId:randomUUID(),title:'Programming'})).data.id;
});
after(async()=>{await client?.disconnect();await fixture?.cleanup();});
const save=async(step:string,extra:Record<string,unknown>={})=>{
 const state=await getTeacherOnboarding(client.db,actor);
 return (await saveTeacherOnboarding(client.db,actor,{commandId:randomUUID(),expectedRevision:state.revision,step,...extra})).data;
};
test('first run is read-only; small drafts and each confirmed step survive reloading',async()=>{
 const initial=await getTeacherOnboarding(client.db,actor);assert.equal(initial.nextStep,'WELCOME');assert.equal(await client.db.teacherOnboarding.count(),0);
 const welcome=await save('WELCOME');assert.equal(welcome.nextStep,'CLASS');
 const draft=await save('DRAFT',{draft:{classForm:{displayName:'My first class',sectionIds:['section'],graceMinutes:15}}});assert.equal(draft.draft.classForm?.displayName,'My first class');
 assert.deepEqual(await getTeacherOnboarding(client.db,actor),draft);
 const concurrent=await Promise.allSettled(['Device one','Device two'].map(displayName=>saveTeacherOnboarding(client.db,actor,{commandId:randomUUID(),expectedRevision:draft.revision,step:'DRAFT',draft:{classForm:{displayName}}})));
 assert.equal(concurrent.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(concurrent.filter(result=>result.status==='rejected').length,1);
 await assert.rejects(save('DRAFT',{draft:{password:'never persist secrets'}}));
});
test('creating the first class atomically links setup; response loss or a second device cannot duplicate it',async()=>{
 const before=await getTeacherOnboarding(client.db,actor);
 const input={commandId:randomUUID(),termId,subjectId,displayName:'My first class',sectionIds:['section'],exceptions:[],onboardingExpectedRevision:before.revision};
 const created=await createClassOffering(client.db,actor,input);classId=created.data.id;
 const reloaded=await getTeacherOnboarding(client.db,actor);assert.equal(reloaded.classId,classId);assert.equal(reloaded.nextStep,'ROSTER');
 const replay=await createClassOffering(client.db,actor,input);assert.equal(replay.data.id,classId);assert.equal(replay.replayed,true);
 await assert.rejects(createClassOffering(client.db,actor,{...input,commandId:randomUUID()}),{code:'ONBOARDING_CHANGED'});
 assert.equal(await client.db.classOffering.count({where:{primaryTeacherId:actor.userId}}),1);
});
test('roster/settings acknowledgments bind to actual versions and two-device progress conflicts preserve saved state',async()=>{
 const state=await getTeacherOnboarding(client.db,actor);assert.ok(state.readiness);
 await assert.rejects(save('READY',{complete:true}),{code:'ONBOARDING_NOT_READY'});
 const command={commandId:randomUUID(),expectedRevision:state.revision,step:'ROSTER',expectedRosterRevision:state.readiness!.rosterRevision,rosterFingerprint:state.readiness!.rosterFingerprint};
 const saved=await saveTeacherOnboarding(client.db,actor,command);assert.equal(saved.data.nextStep,'SETTINGS');
 await assert.rejects(saveTeacherOnboarding(client.db,actor,{commandId:randomUUID(),expectedRevision:state.revision,step:'DRAFT',draft:{classForm:{displayName:'Stale device'}}}),{code:'ONBOARDING_CHANGED'});
 assert.deepEqual((await saveTeacherOnboarding(client.db,actor,command)).data,saved.data);
 const settings=await save('SETTINGS',{expectedConfigRevision:0});assert.equal(settings.nextStep,'TUTORIAL');
 const tutorial=await save('TUTORIAL',{draft:{tutorial:'SKIPPED'}});assert.equal(tutorial.nextStep,'READY');
 await client.db.student.update({where:{id:'student'},data:{firstName:'Corrected'}});
 assert.equal((await getTeacherOnboarding(client.db,actor)).nextStep,'ROSTER');
 await assert.rejects(save('READY',{complete:true}),{code:'ONBOARDING_NOT_READY'});
});
test('completion is confirmed, idempotent and never creates attendance; help does not reset completion',async()=>{
 const state=await getTeacherOnboarding(client.db,actor);
 await save('ROSTER',{expectedRosterRevision:state.readiness!.rosterRevision,rosterFingerprint:state.readiness!.rosterFingerprint});
 const ready=await getTeacherOnboarding(client.db,actor);assert.equal(ready.nextStep,'READY');
 const command={commandId:randomUUID(),expectedRevision:ready.revision,step:'READY',complete:true};
 completedInput=command;
 const completed=await saveTeacherOnboarding(client.db,actor,command);assert.equal(completed.data.nextStep,'COMPLETED');assert.ok(completed.data.completedAt);
 assert.deepEqual((await saveTeacherOnboarding(client.db,actor,command)).data,completed.data);
 assert.equal((await getTeacherOnboarding(client.db,actor)).nextStep,'COMPLETED');
 await updateClassOffering(client.db,actor,classId,{commandId:randomUUID(),expectedConfigRevision:0,archived:true});
 const archived=await getTeacherOnboarding(client.db,actor);assert.equal(archived.nextStep,'COMPLETED');assert.equal(archived.classId,null);
});
test('unrelated/obsolete classes are concealed and recover to class selection without an approval queue',async()=>{
 const before=await getTeacherOnboarding(client.db,other);
 await assert.rejects(saveTeacherOnboarding(client.db,other,{commandId:randomUUID(),expectedRevision:before.revision,step:'CLASS',classId}),{code:'ONBOARDING_CLASS_UNAVAILABLE'});
 await updateClassOffering(client.db,actor,classId,{commandId:randomUUID(),expectedConfigRevision:1,archived:false});
 const fresh=await createClassOffering(client.db,other,{commandId:randomUUID(),termId,subjectId,displayName:'Other class',sectionIds:['section'],exceptions:[]});
 await saveTeacherOnboarding(client.db,other,{commandId:randomUUID(),expectedRevision:0,step:'WELCOME'});
 await saveTeacherOnboarding(client.db,other,{commandId:randomUUID(),expectedRevision:1,step:'CLASS',classId:fresh.data.id});
 await transferClassOwner(client.db,admin,fresh.data.id,{commandId:randomUUID(),expectedConfigRevision:0,teacherId:actor.userId,reason:'Correct teaching assignment'});
 const recovered=await getTeacherOnboarding(client.db,other);assert.equal(recovered.nextStep,'CLASS');assert.equal(recovered.classId,null);assert.equal(recovered.class,null);
 await transferClassOwner(client.db,admin,classId,{commandId:randomUUID(),expectedConfigRevision:2,teacherId:other.userId,reason:'Transfer completed setup class'});
 await assert.rejects(saveTeacherOnboarding(client.db,actor,completedInput),{code:'CLASS_NOT_FOUND'});
 assert.equal((await getTeacherOnboarding(client.db,actor)).nextStep,'COMPLETED');
});

test('an empty class can be saved but cannot pass roster readiness',async()=>{
 const empty=await createClassOffering(client.db,other,{commandId:randomUUID(),termId,subjectId,displayName:'Preparing enrollment',sectionIds:[],exceptions:[]});
 const state=await getTeacherOnboarding(client.db,other);
 const selected=(await saveTeacherOnboarding(client.db,other,{commandId:randomUUID(),expectedRevision:state.revision,step:'CLASS',classId:empty.data.id})).data;
 assert.equal(selected.readiness!.rosterCount,0);assert.equal(selected.nextStep,'ROSTER');
 await assert.rejects(saveTeacherOnboarding(client.db,other,{commandId:randomUUID(),expectedRevision:selected.revision,step:'ROSTER',expectedRosterRevision:0,rosterFingerprint:selected.readiness!.rosterFingerprint}),{code:'EMPTY_ROSTER'});
});
