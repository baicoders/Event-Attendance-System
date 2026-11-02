import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync,mkdirSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import QRCode from 'react-qr-code';
import { withClassroomTestApp } from './classroom-test-app.mjs';
await withClassroomTestApp(async({db,request,base})=>{
 const password='classroom-mobile-only-password';const user=await db.user.create({data:{name:'Mobile teacher',email:'mobile@example.test',password,role:'MEMBER',status:'PENDING'}});await db.classroomMembership.create({data:{userId:user.id,status:'APPROVED',departmentOrDesignation:'Teacher'}});
 const login=await request('/api/auth/login',{method:'POST',body:{email:user.email,password,workspace:'CLASS'}});assert.equal(login.response.status,200,login.text);const cookie=login.cookie;
 const year=new Date().getUTCFullYear();const term=(await request('/api/classroom/terms',{cookie,method:'POST',body:{commandId:randomUUID(),name:'Mobile term',startDate:(year-1)+'-01-01',endDate:(year+1)+'-12-31'}})).json.data.data;const subject=(await request('/api/classroom/subjects',{cookie,method:'POST',body:{commandId:randomUUID(),title:'Mobile subject'}})).json.data.data;
 const classes={};let index=0;
 for(const size of [35,100,101,220]){
  const section=await db.group.create({data:{name:'Section '+size,slug:'mobile-'+size,category:'SECTION'}});const students=Array.from({length:size},(_,i)=>({id:'m'+size+'-'+String(i).padStart(3,'0'),firstName:'Student',lastName:'N'+size+'_'+String(i).padStart(3,'0'),usn:String(++index).padStart(11,'0')}));
  await db.student.createMany({data:students});await db.group.update({where:{id:section.id},data:{students:{connect:students.map(({id})=>({id}))}}});
  const created=await request('/api/classroom/classes',{cookie,method:'POST',body:{commandId:randomUUID(),termId:term.id,subjectId:subject.id,displayName:'Mobile '+size,sectionIds:[section.id],exceptions:[]}});assert.equal(created.response.status,201,created.text);classes[size]={id:created.json.data.data.id,students};
 }
 await db.student.create({data:{id:'mobile-visitor',firstName:'Visiting',lastName:'Student',usn:'99999999999'}});
 const qrComponent=QRCode.default||QRCode;const qr=Object.fromEntries([['usn',classes[35].students[6].usn],['lrn','000000123456'],['legacy',classes[35].students[8].id],['unknown','not-a-real-student'],['visitor','mobile-visitor']].map(([key,code])=>[key,{code,svg:renderToStaticMarkup(React.createElement(qrComponent,{value:code,size:360}))}]));
 await db.student.update({where:{id:classes[35].students[7].id},data:{lrn:'000000123456'}});
 const artifacts='.superpowers/classroom-tests/mobile-'+randomUUID();mkdirSync(artifacts,{recursive:true});const file=artifacts+'/fixture.json';writeFileSync(file,JSON.stringify({base,cookie,classes,qr,artifacts}));
 const run=spawnSync('python3',['scripts/test-classroom-attendance-browser.py'],{env:{...process.env,CLASSROOM_MOBILE_FIXTURE:file},encoding:'utf8',timeout:600000});assert.equal(run.status,0,run.stdout+'\n'+run.stderr);console.log(run.stdout);if(process.env.CLASSROOM_MOBILE_NAV_ONLY==='true'||process.env.CLASSROOM_MOBILE_FILTER_REVIEW_ONLY==='true')return;
 const meeting=await db.classroomSession.findFirstOrThrow({where:{classId:classes[35].id}});assert.equal(meeting.state,'FINALIZED');const row=await db.classroomAttendance.findUniqueOrThrow({where:{sessionId_studentId:{sessionId:meeting.id,studentId:classes[35].students[0].id}}});assert.equal(row.status,'PRESENT');assert.equal(await db.classroomAttendanceChange.count({where:{sessionId:meeting.id,studentId:row.studentId}}),1,'lost manual ack retries create one audit only');
 assert.equal(await db.classroomAttendanceChange.count({where:{sessionId:meeting.id,studentId:classes[35].students[21].id}}),1,'row-local network recovery creates one first-mark audit');
 for(const size of [35,100,101,220])assert.equal(await db.classroomSession.count({where:{classId:classes[size].id}}),1,'lost Start ack never duplicates a meeting');
 assert.equal(await db.classroomAttendanceChange.count({where:{sessionId:meeting.id,studentId:'mobile-visitor'}}),1);assert.equal(await db.classRosterException.count({where:{classId:classes[35].id,studentId:'mobile-visitor'}}),0,'session-only inclusion is not permanent');
 console.log('PASS disposable production-backed mobile attendance and exact lost-response audit counts.');
});
