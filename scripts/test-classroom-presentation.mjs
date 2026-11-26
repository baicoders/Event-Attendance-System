import './test-browser-origin.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { withClassroomTestApp } from './classroom-test-app.mjs';
await withClassroomTestApp(async ({ db, base, request }) => {
 const password='presentation-test-password'; const fixtures={};
 for(const [key,extra] of [['teacher',{}],['forced',{mustChangePassword:true}],['disabled',{}],['events',{role:'ORGANIZER',status:'ACTIVE'}],['admin',{role:'ADMIN',status:'ACTIVE'}]]) {
  const user=await db.user.create({data:{name:key==='teacher'?'Presentation teacher with an extended school designation and compound family name':'Presentation '+key,email:key+'@presentation.test',password,role:'MEMBER',...extra}});
  await db.classroomMembership.create({data:{userId:user.id,status:'APPROVED',departmentOrDesignation:'Faculty'}});
  await db.teacherOnboarding.create({data:{userId:user.id,completedAt:new Date()}});
  const login=await request('/api/auth/login',{method:'POST',body:{email:user.email,password,workspace:'CLASS'}}); assert.equal(login.response.status,200,login.text);
  fixtures[key]={id:user.id,cookie:login.cookie};
  if(key==='disabled')await db.user.update({where:{id:user.id},data:{accountState:'DISABLED'}});
 }
 const student=await db.student.create({data:{id:'presentation-student',firstName:'Alex',lastName:'Rivera',usn:'00000999123',lrn:'123456789012'}});
 const current=(await request('/api/classroom/students/'+student.id,{cookie:fixtures.teacher.cookie})).json.data;
 const verification=await request('/api/classroom/students/'+student.id+'/verifications',{cookie:fixtures.teacher.cookie,method:'POST',body:{commandId:crypto.randomUUID(),expectedVersion:current.editVersion,state:'VERIFIED',note:'Checked against the school register.'}});assert.equal(verification.response.status,200,verification.text);
 const run=spawnSync('python3',['scripts/test-classroom-presentation.py'],{env:{...process.env,CLASSROOM_TEST_BASE:base,CLASSROOM_PRESENTATION_FIXTURES:JSON.stringify(fixtures),CLASSROOM_PRESENTATION_STUDENT:student.id},encoding:'utf8',timeout:300000,maxBuffer:4*1024*1024});
 console.log(run.stdout);if(run.stderr)console.error(run.stderr);assert.equal(run.status,0,'Presentation browser checks failed');
 console.log('PASS account modal lifecycle, responsive settings, restricted accounts, lazy history and preselected student states.');
});
