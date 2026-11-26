import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { withClassroomTestApp } from './classroom-test-app.mjs';
await withClassroomTestApp(async({db,request,base})=>{
  const password='onboarding-test-password';
  async function teacher(name,membership='APPROVED'){
    const user=await db.user.create({data:{name,email:name.replaceAll(' ','-')+'@example.test',password,role:'MEMBER',status:'PENDING'}});
    await db.classroomMembership.create({data:{userId:user.id,status:membership,departmentOrDesignation:'Teacher'}});
    const login=await request('/api/auth/login',{method:'POST',body:{email:user.email,password,workspace:'CLASS'}});
    assert.equal(login.response.status,200,login.text);return {...user,cookie:login.cookie};
  }
  const actor=await teacher('setup-teacher');const other=await teacher('other-teacher');const pending=await teacher('pending-teacher','PENDING');
  for(const [id,name] of [['3a','BSIT 3A'],['3b','BSIT 3B']])await db.group.create({data:{id,name,slug:id,category:'SECTION'}});
  for(const [id,section] of [['student-a','3a'],['student-b','3b']])await db.student.create({data:{id,firstName:'Student',lastName:id,groups:{connect:{id:section}}}});
  const year=new Date().getUTCFullYear();
  const term=await request('/api/classroom/terms',{cookie:actor.cookie,method:'POST',body:{commandId:randomUUID(),name:'Current school term',startDate:(year-1)+'-08-01',endDate:(year+1)+'-05-31'}});
  const subject=await request('/api/classroom/subjects',{cookie:actor.cookie,method:'POST',body:{commandId:randomUUID(),code:'CS202',title:'Programming 2'}});
  assert.equal(term.response.status,201,term.text);assert.equal(subject.response.status,201,subject.text);
  assert.equal((await request('/api/classroom/onboarding')).response.status,401);
  assert.equal((await request('/api/classroom/onboarding',{cookie:pending.cookie})).response.status,403);
  const path='/api/classroom/onboarding';
  const initial=await request(path,{cookie:actor.cookie});assert.equal(initial.json.data.nextStep,'WELCOME');assert.equal(await db.teacherOnboarding.count(),0);
  const welcome={commandId:randomUUID(),expectedRevision:0,step:'WELCOME'};
  const saved=await request(path,{cookie:actor.cookie,method:'PUT',body:welcome});assert.equal(saved.response.status,200,saved.text);
  assert.equal((await request(path,{cookie:actor.cookie,method:'PUT',body:welcome})).json.data.replayed,true);
  assert.equal((await request(path,{cookie:actor.cookie,method:'PUT',body:{commandId:randomUUID(),expectedRevision:1,step:'DRAFT',draft:{password:'forbidden'}}})).response.status,400);
  assert.equal((await request(path,{cookie:actor.cookie,method:'PUT',body:{commandId:randomUUID(),expectedRevision:1,step:'DRAFT',draft:{classForm:{sectionIds:Array(100).fill('é'.repeat(128))}}}})).response.status,400,'UTF-8 draft size limit');
  const concurrent=await Promise.all(['One','Two'].map(displayName=>request(path,{cookie:actor.cookie,method:'PUT',body:{commandId:randomUUID(),expectedRevision:1,step:'DRAFT',draft:{classForm:{displayName}}}})));
  assert.deepEqual(concurrent.map(result=>result.response.status).sort(),[200,409]);
  const revision=(await request(path,{cookie:actor.cookie})).json.data.revision;
  const creation={commandId:randomUUID(),termId:term.json.data.data.id,subjectId:subject.json.data.data.id,displayName:'First setup class',sectionIds:['3a','3b'],exceptions:[],onboardingExpectedRevision:revision};
  const created=await request('/api/classroom/classes',{cookie:actor.cookie,method:'POST',body:creation});assert.equal(created.response.status,201,created.text);
  const linked=await request(path,{cookie:actor.cookie});assert.equal(linked.json.data.classId,created.json.data.data.id);assert.equal(linked.json.data.nextStep,'ROSTER');
  assert.equal((await request('/api/classroom/classes',{cookie:actor.cookie,method:'POST',body:creation})).json.data.replayed,true);
  assert.equal((await request('/api/classroom/classes',{cookie:actor.cookie,method:'POST',body:{...creation,commandId:randomUUID()}})).response.status,409);
  assert.equal((await request(path,{cookie:other.cookie,method:'PUT',body:{commandId:randomUUID(),expectedRevision:0,step:'CLASS',classId:linked.json.data.classId}})).response.status,404);
  await db.classroomMembership.update({where:{userId:actor.id},data:{status:'SUSPENDED'}});
  assert.equal((await request(path,{cookie:actor.cookie})).response.status,403);
  assert.equal((await request(path,{cookie:actor.cookie,method:'PUT',body:welcome})).response.status,403);
  if(process.env.CLASSROOM_TEST_BROWSER==='true'){
    const browserTeacher=await teacher('mobile-setup-teacher');
    const existingTeacher=await teacher('existing-class-teacher');
    const emptyTeacher=await teacher('empty-class-teacher');
    const unavailableTeacher=await teacher('unavailable-class-teacher');
    const makeClass=async(owner,displayName,sectionIds)=>{const result=await request('/api/classroom/classes',{cookie:owner.cookie,method:'POST',body:{commandId:randomUUID(),termId:term.json.data.data.id,subjectId:subject.json.data.data.id,displayName,sectionIds,exceptions:[]}});assert.equal(result.response.status,201,result.text);return result.json.data.data;};
    await makeClass(existingTeacher,'Existing owned class',['3a']);
    const emptyClass=await makeClass(emptyTeacher,'Empty saved class',[]);
    const unavailableClass=await makeClass(unavailableTeacher,'Archived setup class',['3a']);
    for(const [owner,value] of [[emptyTeacher,emptyClass],[unavailableTeacher,unavailableClass]]){
      await request(path,{cookie:owner.cookie,method:'PUT',body:{commandId:randomUUID(),expectedRevision:0,step:'WELCOME'}});
      const chosen=await request(path,{cookie:owner.cookie,method:'PUT',body:{commandId:randomUUID(),expectedRevision:1,step:'CLASS',classId:value.id}});assert.equal(chosen.response.status,200,chosen.text);
    }
    await request('/api/classroom/classes/'+unavailableClass.id,{cookie:unavailableTeacher.cookie,method:'PATCH',body:{commandId:randomUUID(),expectedConfigRevision:0,archived:true}});
    const run=spawnSync('python3',['scripts/test-classroom-onboarding.py'],{env:{...process.env,CLASSROOM_TEST_BASE:base,CLASSROOM_TEACHER_COOKIE:browserTeacher.cookie,CLASSROOM_EXISTING_COOKIE:existingTeacher.cookie,CLASSROOM_EMPTY_COOKIE:emptyTeacher.cookie,CLASSROOM_UNAVAILABLE_COOKIE:unavailableTeacher.cookie,CLASSROOM_PENDING_COOKIE:pending.cookie},encoding:'utf8'});
    assert.equal(run.status,0,run.stdout+'\n'+run.stderr);console.log(run.stdout);
    assert.equal(await db.classOffering.count({where:{primaryTeacherId:browserTeacher.id}}),1);
    assert.equal(await db.classOffering.count({where:{primaryTeacherId:existingTeacher.id}}),1,'existing-class setup creates no duplicate');
    assert.equal(await db.classroomSession.count({where:{class:{primaryTeacherId:existingTeacher.id}}}),0,'skipping practice starts no meeting');
    assert.equal(await db.classroomSession.count({where:{class:{primaryTeacherId:browserTeacher.id}}}),1,'only the explicitly confirmed meeting exists');
    const progress=await db.teacherOnboarding.findUniqueOrThrow({where:{userId:browserTeacher.id}});assert.ok(progress.completedAt);assert.equal(await db.classroomSession.count({where:{class:{primaryTeacherId:browserTeacher.id},state:'FINALIZED'}}),1,'new teacher completes a real first attendance after onboarding');
    assert.equal(await db.classroomAudit.count({where:{actorId:browserTeacher.id,entityType:'TeacherOnboarding',action:'TEACHER_ONBOARDING_COMPLETED'}}),1);
    assert.equal(await db.classroomAudit.count({where:{actorId:browserTeacher.id,entityType:'TeacherOnboarding',after:{path:['step'],equals:'WELCOME'}}}),1,'malformed ack retry does not duplicate welcome progress');
  }
  console.log('PASS read-only first run, private progress, bounded drafts, parallel version conflicts, atomic first-class linking/replay and suspension.');
});
