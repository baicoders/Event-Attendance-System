import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { withClassroomTestApp } from './classroom-test-app.mjs';
await withClassroomTestApp(async({db,request,base})=>{
 const password='student-test-password';
 const teacher=await db.user.create({data:{name:'Profile Teacher',email:'profile-teacher@example.test',password,role:'MEMBER'}});
 await db.classroomMembership.create({data:{userId:teacher.id,departmentOrDesignation:'Faculty',status:'APPROVED'}});
 const login=await request('/api/auth/login',{method:'POST',body:{email:teacher.email,password,workspace:'CLASS'}});assert.equal(login.response.status,200);
 const cookie=login.cookie;const student=await db.student.create({data:{id:'profile-student',usn:'00000123456',firstName:'Original',lastName:'Student'}});const path='/api/classroom/students/'+student.id;
 assert.equal((await request(path)).response.status,401);
 const organizer=await db.user.create({data:{name:'Organizer',email:'profile-organizer@example.test',password,role:'ORGANIZER',status:'ACTIVE'}});
 const events=await request('/api/auth/login',{method:'POST',body:{email:organizer.email,password}});
 assert.equal((await request(path,{cookie:events.cookie})).response.status,403);
 const list=await request('/api/classroom/students',{cookie});assert.equal(list.json.data.pageSize,100);assert.equal(list.json.data.items.length,1);assert.ok(!('records' in list.json.data.items[0]));
 assert.equal((await request('/api/classroom/students?pageSize=101',{cookie})).response.status,400);
 const initial=(await request(path,{cookie})).json.data;
 const command={commandId:randomUUID(),expectedVersion:initial.editVersion,student:{firstName:'Corrected'},reason:'Confirmed spelling with student'};
 const save=await request(path,{cookie,method:'PATCH',body:command});assert.equal(save.response.status,200,save.text);assert.equal(save.json.data.data.firstName,'Corrected');assert.equal(save.json.data.data.profileRevision,1);
 const replay=await request(path,{cookie,method:'PATCH',body:command});assert.equal(replay.json.data.replayed,true);assert.deepEqual(replay.json.data.data,save.json.data.data);
 const stale=await request(path,{cookie,method:'PATCH',body:{...command,commandId:randomUUID(),student:{firstName:'Stale'}}});assert.equal(stale.response.status,409);assert.equal(stale.json.code,'STUDENT_EDIT_CONFLICT');
 for(const studentPatch of [{house:'private-house'},{id:'wrong'},{role:'ADMIN'}])assert.equal((await request(path,{cookie,method:'PATCH',body:{...command,commandId:randomUUID(),expectedVersion:save.json.data.data.editVersion,student:studentPatch}})).response.status,400);
 const latest=save.json.data.data;const verification=await request(path+'/verifications',{cookie,method:'POST',body:{commandId:randomUUID(),expectedVersion:latest.editVersion,state:'VERIFIED',note:'Checked school record'}});assert.equal(verification.response.status,200);assert.equal(verification.json.data.data.verification.state,'VERIFIED');
 const identifier=await request(path,{cookie,method:'PATCH',body:{commandId:randomUUID(),expectedVersion:latest.editVersion,student:{usn:'00000123457'},reason:'Corrected printed number'}});assert.equal(identifier.response.status,400);assert.equal(identifier.json.code,'QR_DISPOSITION_REQUIRED');
 const corrected=await request(path,{cookie,method:'PATCH',body:{commandId:randomUUID(),expectedVersion:latest.editVersion,student:{usn:'00000123457'},reason:'Corrected printed number',identifierDisposition:'REPRINT_REQUIRED'}});assert.equal(corrected.response.status,200,corrected.text);assert.equal(corrected.json.data.data.verification.state,'UNVERIFIED');
 assert.equal((await db.studentQrCode.findUniqueOrThrow({where:{code:'00000123456'}})).state,'RETIRED');
 const history=await request(path+'/changes',{cookie});assert.equal(history.response.status,200);assert.equal(history.json.data.items.length,3);assert.equal(history.json.data.items[0].actorName,teacher.name);assert.equal(history.json.data.items[0].before.usn,'00000123456');
 for(const route of ['/api/students','/api/students/imports/preview','/api/students/bulk/preview'])assert.equal((await request(route,{cookie,method:route==='/api/students'?'GET':'POST',body:route==='/api/students'?undefined:{}})).response.status,403);
 if(process.env.CLASSROOM_TEST_BROWSER==='true'){
  const run=spawnSync('python3',['scripts/test-classroom-students.py'],{env:{...process.env,CLASSROOM_TEST_BASE:base,CLASSROOM_TEACHER_COOKIE:cookie,CLASSROOM_STUDENT_ID:student.id},encoding:'utf8'});assert.equal(run.status,0,run.stdout+'\n'+run.stderr);console.log(run.stdout);assert.equal(await db.studentProfileChange.count({where:{studentId:student.id,reason:'Network acknowledgment test'}}),1,'lost acknowledgment replay writes exactly one history row');
 }
 await db.classroomMembership.update({where:{userId:teacher.id},data:{status:'SUSPENDED'}});
 assert.equal((await request(path,{cookie})).response.status,403);
 assert.equal((await request(path,{cookie,method:'PATCH',body:command})).response.status,403,'revoked grants cannot replay a successful command');
 console.log('PASS shared directory, individual correction/replay/conflict, verification invalidation, identifier retirement, privacy, bulk denial and fresh suspension checks.');
});
