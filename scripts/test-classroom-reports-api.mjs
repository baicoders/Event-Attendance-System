import ExcelJS from 'exceljs';
import assert from 'node:assert/strict';import { randomUUID } from 'node:crypto';import { spawnSync } from 'node:child_process';import { mkdirSync,writeFileSync } from 'node:fs';
import { withClassroomTestApp } from './classroom-test-app.mjs';
await withClassroomTestApp(async({db,request,base})=>{
 const password='report-api-password';async function account(name,role='MEMBER',status='PENDING',membership='APPROVED'){const user=await db.user.create({data:{name,email:name+'@example.test',password,role,status}});if(role!=='ADMIN'&&membership)await db.classroomMembership.create({data:{userId:user.id,status:membership,departmentOrDesignation:'Teacher'}});const login=await request('/api/auth/login',{method:'POST',body:{email:user.email,password,workspace:role==='ORGANIZER'?'EVENTS':'CLASS'}});assert.equal(login.response.status,200,login.text);return {...user,cookie:login.cookie};}
 const teacher=await account('report-teacher');const other=await account('other-teacher');const admin=await account('report-admin','ADMIN','ACTIVE');const organizer=await account('organizer','ORGANIZER','ACTIVE',null);const pending=await account('pending','MEMBER','PENDING','PENDING');
 const year=new Date().getUTCFullYear();const term=(await request('/api/classroom/terms',{cookie:teacher.cookie,method:'POST',body:{commandId:randomUUID(),name:'Current report term',startDate:(year-1)+'-01-01',endDate:(year+1)+'-12-31'}})).json.data.data;const subject=(await request('/api/classroom/subjects',{cookie:teacher.cookie,method:'POST',body:{commandId:randomUUID(),title:'Report subject'}})).json.data.data;
 await db.group.create({data:{id:'report-section',name:'Report section',slug:'report-section',category:'SECTION'}});for(let i=0;i<6;i++)await db.student.create({data:{id:'report-student-'+i,usn:String(i+1).padStart(11,'0'),firstName:i===0?'  =FORMULA':'Historical',lastName:i===0?'Ñ Name, original':'Student '+i,groups:{connect:{id:'report-section'}}}});
 async function meeting(owner,sectionIds=['report-section']){const created=await request('/api/classroom/classes',{cookie:owner.cookie,method:'POST',body:{commandId:randomUUID(),termId:term.id,subjectId:subject.id,displayName:owner===teacher?'Report class':'Other private class',sectionIds,exceptions:sectionIds.length?[]:[{studentId:'report-student-0',kind:'INCLUDE',reason:'Irregular enrollment'}]}});assert.equal(created.response.status,201,created.text);const classId=created.json.data.data.id;const preview=(await request('/api/classroom/classes/'+classId+'/start-preview',{cookie:owner.cookie})).json.data;const started=await request('/api/classroom/classes/'+classId+'/sessions',{cookie:owner.cookie,method:'POST',body:{commandId:randomUUID(),scheduledStartAt:new Date(Date.now()-3600000).toISOString(),expectedConfigRevision:0,expectedRosterRevision:0,expectedRosterFingerprint:preview.rosterFingerprint}});assert.equal(started.response.status,201,started.text);return {classId,sessionId:started.json.data.data.id,schoolDate:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(started.json.data.data.scheduledStartAt))};}
 const own=await meeting(teacher),foreign=await meeting(other,[]);for(const [i,status] of ['PRESENT','PRESENT','LATE','ABSENT','EXCUSED','EXCUSED'].entries()){const saved=await request('/api/classroom/sessions/'+own.sessionId+'/attendance/report-student-'+i,{cookie:teacher.cookie,method:'PUT',body:{commandId:randomUUID(),status,expectedRevision:0,...(status==='EXCUSED'?{excuseNote:'PRIVATE EXCUSE LETTER'}:{})}});assert.equal(saved.response.status,200,saved.text);}
 for(const [owner,session] of [[teacher,own],[other,foreign]])assert.equal((await request('/api/classroom/sessions/'+session.sessionId+'/finalize',{cookie:owner.cookie,method:'POST',body:{commandId:randomUUID(),expectedLifecycleRevision:0,expectedSnapshotRevision:0}})).response.status,200);
 const path='/api/classroom/reports?sessionId='+own.sessionId;const prepared=await request(path,{cookie:teacher.cookie});assert.equal(prepared.response.status,200,prepared.text);const report=prepared.json.data;assert.equal(report.totals.rateText,'75.0%');assert.equal(report.totals.numerator,3);assert.equal(report.totals.denominator,4);assert.equal(report.totalRows,6);assert.ok(!prepared.text.includes('PRIVATE EXCUSE'));assert.ok(prepared.response.headers.get('cache-control').includes('no-store'));
 for(const [cookie,status] of [[undefined,401],[pending.cookie,403],[organizer.cookie,403],[other.cookie,404]])assert.equal((await request(path,{cookie})).response.status,status);
 assert.equal((await request('/api/classroom/reports',{cookie:teacher.cookie})).response.status,400);
 const studentPath='/api/classroom/reports?termId='+term.id+'&studentId=report-student-0';assert.equal((await request(studentPath,{cookie:teacher.cookie})).json.data.totals.eligibleMeetings,1);assert.equal((await request(studentPath,{cookie:admin.cookie})).json.data.totals.eligibleMeetings,2);
 const secondPage=await request(path+'&page=2&pageSize=2',{cookie:teacher.cookie});assert.equal(secondPage.json.data.rows.length,2);assert.equal(secondPage.json.data.totals.rateText,'75.0%');assert.equal(secondPage.json.data.reportVersion,report.reportVersion);
 const found=await request(path+'&q=Student%205&pageSize=1',{cookie:teacher.cookie});assert.equal(found.response.status,200,found.text);assert.equal(found.json.data.totalRows,1);assert.equal(found.json.data.totalStudents,6);assert.equal(found.json.data.rows[0].studentId,'report-student-5');assert.deepEqual(found.json.data.totals,report.totals);assert.deepEqual(found.json.data.meetings,report.meetings);assert.equal(found.json.data.reportVersion,report.reportVersion);
 const byUsn=await request(path+'&q=00000000001',{cookie:teacher.cookie});assert.equal(byUsn.json.data.rows[0].studentId,'report-student-0');assert.equal((await request(path+'&q=not-a-student',{cookie:teacher.cookie})).json.data.totalRows,0);assert.equal((await request(path+'&q='+encodeURIComponent('x'.repeat(101)),{cookie:teacher.cookie})).response.status,400);
 const params=new URLSearchParams({sessionId:own.sessionId,expectedReportVersion:report.reportVersion});for(const format of ['SUMMARY','DETAIL']){const exported=await request('/api/classroom/reports/export?'+params+'&format='+format+'&page=2&pageSize=2&q=Student%205',{cookie:teacher.cookie});assert.equal(exported.response.status,200,exported.text);assert.equal(exported.response.headers.get('x-report-version'),report.reportVersion);assert.ok(exported.response.headers.get('content-type').startsWith('text/csv'));assert.ok(exported.text.includes("'00000000001"));assert.ok(exported.text.includes("'  =FORMULA"));assert.ok(!exported.text.includes('PRIVATE EXCUSE'));assert.equal(exported.text.trimEnd().split('\r\n').length,7);}
 const print=await request('/class/reports/print?'+params,{cookie:teacher.cookie});assert.equal(print.response.status,200);assert.ok(print.response.headers.get('cache-control').includes('no-store'));assert.ok(print.text.includes('75.0%'));assert.ok(print.text.includes(report.reportVersion));assert.ok(!print.text.includes('PRIVATE EXCUSE'));
 const deniedPrint=await request('/class/reports/print?'+params,{cookie:other.cookie});assert.ok(deniedPrint.text.includes('Report unavailable'));assert.ok(!deniedPrint.text.includes('Ñ Name, original'));
 assert.equal((await request('/api/classroom/reports/export?'+params,{cookie:organizer.cookie})).response.status,403);assert.equal((await request('/api/classroom/reports/export?sessionId='+own.sessionId,{cookie:teacher.cookie})).json.code,'REPORT_VERSION_REQUIRED');
 const edit=await request('/api/classroom/sessions/'+own.sessionId+'/attendance/report-student-1',{cookie:teacher.cookie,method:'PUT',body:{commandId:randomUUID(),status:'ABSENT',expectedRevision:1,reason:'Corrected after verifying the record'}});assert.equal(edit.response.status,200,edit.text);const stale=await request('/api/classroom/reports/export?'+params,{cookie:teacher.cookie});assert.equal(stale.response.status,409);assert.equal(stale.json.code,'REPORT_CHANGED');const changedPrint=await request('/class/reports/print?'+params,{cookie:teacher.cookie});assert.ok(changedPrint.text.includes('Report changed'));assert.ok(!changedPrint.text.includes('Ñ Name, original'));
 const activity=await request('/api/admin/classroom/activity?actorId='+teacher.id,{cookie:admin.cookie});assert.equal(activity.response.status,200,activity.text);assert.ok(activity.json.data.items.some(row=>row.source==='attendance'&&row.action==='CORRECT'));assert.ok(activity.json.data.items.some(row=>row.action==='CLASSROOM_REPORT_PREPARED'));assert.ok(!activity.text.includes('PRIVATE EXCUSE'));
 for(const cookie of [teacher.cookie,organizer.cookie])assert.equal((await request('/api/admin/classroom/activity',{cookie})).response.status,403);
 const correction=activity.json.data.items.find(row=>row.source==='attendance'&&row.action==='CORRECT');const detailPath='/api/admin/classroom/activity/attendance/'+correction.id;const detail=await request(detailPath,{cookie:admin.cookie});assert.equal(detail.response.status,200,detail.text);assert.equal(detail.json.data.actorId,teacher.id);assert.equal(detail.json.data.after.status,'ABSENT');assert.equal((await request(detailPath,{cookie:teacher.cookie})).response.status,403);
 const teacherDetail=await request('/api/admin/classroom/teachers/'+teacher.id,{cookie:admin.cookie});assert.equal(teacherDetail.response.status,200);assert.equal(teacherDetail.json.data.classCount,1);assert.ok(!Object.hasOwn(teacherDetail.json.data.user,'password'));
 const classQuery=new URLSearchParams({termId:term.id,classId:own.classId,view:'class'});
 const classReport=(await request('/api/classroom/reports?'+classQuery,{cookie:teacher.cookie})).json.data;
 const excelPath='/api/classroom/reports/export?'+classQuery+'&format=XLSX&expectedReportVersion='+classReport.reportVersion+'&q=Student%205&pageSize=1';
 const xlsx=await fetch(base+excelPath,{headers:{cookie:teacher.cookie}});
 assert.equal(xlsx.status,200);
 assert.equal(xlsx.headers.get('x-report-version'),classReport.reportVersion);
 assert.match(xlsx.headers.get('content-type'),/spreadsheetml/);
 const workbook=new ExcelJS.Workbook();
 await workbook.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));
 assert.deepEqual(workbook.worksheets.map(sheet=>sheet.name),['ATTENDANCES_REPORT']);
 const attendance=workbook.worksheets[0];
 assert.equal(attendance.getCell('A3').value,'ATTENDANCE REPORT OF STUDENTS');
 assert.equal(attendance.pageSetup.orientation,'portrait');
 const header=attendance.findRow(14);
 assert.equal(header.getCell(1).value,'NO.');
 assert.equal(header.getCell(2).value,'USN');
 assert.equal(header.getCell(5).value,'TOTAL');
 assert.equal(attendance.getCell('D15').value,own.schoolDate.slice(0,4));
 assert.equal(attendance.getCell('D16').numFmt,'mm-dd');
 assert.equal(attendance.getCell('D16').value.toISOString().slice(0,10),own.schoolDate);
 assert.equal(attendance.getCell('B17').value,'00000000001');
 assert.equal(attendance.getCell('D17').value,'P');
 assert.equal(attendance.getCell('E17').value,1);
 assert.equal(attendance.getCell('A22').value,6);
 assert.equal(attendance.getCell('A23').value,'*** NOTHING FOLLOWS ***');
 assert.ok(!JSON.stringify(attendance.getSheetValues()).includes('PRIVATE EXCUSE'));
 assert.equal((await request(excelPath,{cookie:other.cookie})).response.status,404);
 assert.equal((await request(excelPath.replace(classReport.reportVersion,'0'.repeat(64)),{cookie:teacher.cookie})).response.status,409);
 const classCsv=await request('/api/classroom/reports/export?termId='+term.id+'&classId='+own.classId+'&expectedReportVersion='+classReport.reportVersion,{cookie:teacher.cookie});
 assert.equal(classCsv.response.status,200);
 if(process.env.CLASSROOM_TEST_BROWSER==='true'){
  const endpoint='/api/classroom/classes/'+own.classId;
  const preview=(await request(endpoint+'/start-preview',{cookie:teacher.cookie})).json.data;
  for(let day=2;day<=13;day++){
   const started=await request(endpoint+'/sessions',{cookie:teacher.cookie,method:'POST',body:{commandId:randomUUID(),
    scheduledStartAt:new Date(Date.now()-day*86400000).toISOString(),expectedConfigRevision:preview.configRevision,
    expectedRosterRevision:preview.rosterRevision,expectedRosterFingerprint:preview.rosterFingerprint}});
   assert.equal(started.response.status,201,started.text);
   const session=started.json.data.data;
   const finalized=await request('/api/classroom/sessions/'+session.id+'/finalize',{cookie:teacher.cookie,method:'POST',
    body:{commandId:randomUUID(),expectedLifecycleRevision:session.lifecycleRevision,expectedSnapshotRevision:session.snapshotRevision}});
   assert.equal(finalized.response.status,200,finalized.text);
  }
  const artifacts='.superpowers/classroom-tests/reports-'+randomUUID();mkdirSync(artifacts,{recursive:true});const file=artifacts+'/fixture.json';writeFileSync(file,JSON.stringify({base,teacher,admin,other,own,foreign,term,reportVersion:(await request(path+'&classId='+own.classId+'&termId='+term.id,{cookie:teacher.cookie})).json.data.reportVersion,artifacts}));const run=spawnSync('python3',['scripts/test-classroom-report-browser.py'],{env:{...process.env,CLASSROOM_REPORT_FIXTURE:file},encoding:'utf8',timeout:300000});assert.equal(run.status,0,run.stdout+'\n'+run.stderr);console.log(run.stdout);}
 await db.classroomMembership.update({where:{userId:teacher.id},data:{status:'SUSPENDED'}});assert.equal((await request(path,{cookie:teacher.cookie})).response.status,403);assert.equal((await request('/api/classroom/reports/export?'+params,{cookie:teacher.cookie})).response.status,403);const revokedPrint=await request('/class/reports/print?'+params,{cookie:teacher.cookie});assert.ok(!revokedPrint.text.includes('Ñ Name, original'));
 console.log('PASS canonical historical JSON/page/CSV/print,75% formula, leading-zero/formula protection, exact reportVersion, changed exports, private student-term boundaries, monitoring/detail/admin attribution and suspension.');
});
