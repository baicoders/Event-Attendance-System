import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { withClassroomTestApp } from './classroom-test-app.mjs';
await withClassroomTestApp(async({db,request})=>{
 const password='attendance-api-password';
 async function user(name,role='MEMBER',status='PENDING',membership='APPROVED'){
  const account=await db.user.create({data:{name,email:name+'@example.test',password,role,status}});
  if(role!=='ADMIN')await db.classroomMembership.create({data:{userId:account.id,status:membership,departmentOrDesignation:'Teacher'}});
  const login=await request('/api/auth/login',{method:'POST',body:{email:account.email,password,workspace:'CLASS'}});assert.equal(login.response.status,200,login.text);return {...account,cookie:login.cookie};
 }
 const teacher=await user('teacher');const other=await user('other');const pending=await user('pending','MEMBER','PENDING','PENDING');const admin=await user('admin','ADMIN','ACTIVE');const dual=await user('dual','ORGANIZER','ACTIVE');
 for(const id of ['section','outside'])await db.group.create({data:{id,name:id,slug:id,category:'SECTION'}});
 for(const [index,id] of ['a','b','c','d','visitor','future'].entries())await db.student.create({data:{id,firstName:'Student',lastName:id,usn:String(index+1000).padStart(11,'0'),lrn:id==='b'?'000000123456':null,groups:{connect:{id:['visitor','future'].includes(id)?'outside':'section'}}}});
 await db.studentQrCode.create({data:{code:'retired-card',studentId:'a',reservedOwnerId:'a',state:'RETIRED',originalKind:'USN',retiredAt:new Date()}});
 await db.studentQrCode.create({data:{code:'ambiguous-card',state:'QUARANTINED',originalKind:'LEGACY'}});
 const year=new Date().getUTCFullYear();
 const term=await request('/api/classroom/terms',{cookie:teacher.cookie,method:'POST',body:{commandId:randomUUID(),name:'Current term',startDate:(year-1)+'-01-01',endDate:(year+1)+'-12-31'}});
 const subject=await request('/api/classroom/subjects',{cookie:teacher.cookie,method:'POST',body:{commandId:randomUUID(),title:'Programming'}});
 async function start(owner){
  const offering=await request('/api/classroom/classes',{cookie:owner.cookie,method:'POST',body:{commandId:randomUUID(),termId:term.json.data.data.id,subjectId:subject.json.data.data.id,displayName:'Class '+randomUUID(),sectionIds:['section'],exceptions:[]}});assert.equal(offering.response.status,201,offering.text);const classId=offering.json.data.data.id;
  const preview=(await request('/api/classroom/classes/'+classId+'/start-preview',{cookie:owner.cookie})).json.data;
  const session=await request('/api/classroom/classes/'+classId+'/sessions',{cookie:owner.cookie,method:'POST',body:{commandId:randomUUID(),scheduledStartAt:new Date().toISOString(),expectedConfigRevision:0,expectedRosterRevision:0,expectedRosterFingerprint:preview.rosterFingerprint}});assert.equal(session.response.status,201,session.text);return {classId,id:session.json.data.data.id};
 }
 const session=await start(teacher);const path='/api/classroom/sessions/'+session.id;
 const scanBody={commandId:randomUUID(),code:'00000001000'};
 const saved=await request(path+'/scans',{cookie:teacher.cookie,method:'POST',body:scanBody});assert.equal(saved.response.status,200,saved.text);assert.equal(saved.json.data.data.outcome,'RECORDED');assert.equal(saved.json.data.data.studentId,'a');assert.equal(saved.json.data.data.attendance.status,'PRESENT');
 const expectedStudent={id:'a',firstName:'Student',middleName:null,lastName:'a',usn:'00000001000',lrn:null};assert.deepEqual(saved.json.data.data.student,expectedStudent);
 await db.student.update({where:{id:'a'},data:{firstName:'Changed directory name'}});
 assert.deepEqual((await request(path+'/scans',{cookie:teacher.cookie,method:'POST',body:scanBody})).json.data.data,saved.json.data.data);
 const duplicate=await request(path+'/scans',{cookie:teacher.cookie,method:'POST',body:{commandId:randomUUID(),code:'a'}});assert.equal(duplicate.json.data.data.outcome,'ALREADY_RECORDED');assert.deepEqual(duplicate.json.data.data.student,expectedStudent);assert.deepEqual(duplicate.json.data.data.attendance,saved.json.data.data.attendance);
 assert.equal((await request(path+'/scans',{cookie:teacher.cookie,method:'POST',body:{...scanBody,code:'b'}})).json.code,'COMMAND_REUSED');
 assert.equal((await request('/api/classroom/commands/'+scanBody.commandId,{cookie:teacher.cookie})).json.data.result.studentId,'a');assert.equal((await request('/api/classroom/commands/'+scanBody.commandId,{cookie:other.cookie})).response.status,404);
 for(const [cookie,status] of [[undefined,401],[pending.cookie,403],[other.cookie,404]])assert.equal((await request(path+'/scans',{cookie,method:'POST',body:{commandId:randomUUID(),code:'a'}})).response.status,status);
 for(const [code,error] of [['unknown-card','UNKNOWN_QR'],['retired-card','QR_RETIRED'],['ambiguous-card','QR_AMBIGUOUS']]){
  const before=await db.classroomAttendanceChange.count({where:{sessionId:session.id}});const commandId=randomUUID();const result=await request(path+'/scans',{cookie:teacher.cookie,method:'POST',body:{commandId,code}});assert.equal(result.json.code,error,result.text);assert.equal(await db.classroomAttendanceChange.count({where:{sessionId:session.id}}),before);assert.equal(await db.classroomCommandReceipt.count({where:{commandId}}),0);
 }
 assert.equal((await request(path+'/scans',{cookie:teacher.cookie,method:'POST',body:{commandId:randomUUID(),code:'bad\0card'}})).response.status,400);
 assert.equal((await request(path+'/attendance/a',{cookie:teacher.cookie,method:'PUT',body:{commandId:randomUUID(),studentId:'b',expectedRevision:1,status:'ABSENT',reason:'Wrong path student'}})).json.code,'ROUTE_ID_MISMATCH');
 const manual=await request(path+'/attendance/b',{cookie:teacher.cookie,method:'PUT',body:{commandId:randomUUID(),expectedRevision:0,status:'ABSENT'}});assert.equal(manual.response.status,200,manual.text);
 const protectedMark=await request(path+'/scans',{cookie:teacher.cookie,method:'POST',body:{commandId:randomUUID(),code:'000000123456'}});assert.equal(protectedMark.json.data.data.outcome,'ALREADY_MARKED');assert.deepEqual(protectedMark.json.data.data.student,{id:'b',firstName:'Student',middleName:null,lastName:'b',usn:'00000001001',lrn:'000000123456'});assert.equal(protectedMark.json.data.data.attendance.status,'ABSENT');
 const unchanged=await request(path+'/attendance/a',{cookie:teacher.cookie,method:'PUT',body:{commandId:randomUUID(),expectedRevision:1,status:'PRESENT',reason:'Confirm unchanged attendance'}});assert.equal(unchanged.json.data.data.outcome,'UNCHANGED');assert.deepEqual(unchanged.json.data.data.student,expectedStudent);
 assert.equal((await request(path+'/attendance/b',{cookie:teacher.cookie,method:'PUT',body:{commandId:randomUUID(),expectedRevision:1,status:'EXCUSED'}})).json.code,'REASON_REQUIRED');
 const excuse=await request(path+'/attendance/b',{cookie:teacher.cookie,method:'PUT',body:{commandId:randomUUID(),expectedRevision:1,status:'EXCUSED',excuseNote:'Excuse letter received',reason:'Correct roll-call absence'}});assert.equal(excuse.response.status,200,excuse.text);assert.equal(excuse.json.data.data.attendance.excuseNote,'Excuse letter received');
 assert.equal((await request(path+'/attendance/b',{cookie:teacher.cookie,method:'PUT',body:{commandId:randomUUID(),expectedRevision:1,status:'PRESENT',reason:'Stale correction'}})).json.code,'ATTENDANCE_CHANGED');
 assert.equal((await request(path+'/scans',{cookie:admin.cookie,method:'POST',body:{commandId:randomUUID(),code:'c'}})).json.code,'REASON_REQUIRED');
 const assisted=await request(path+'/scans',{cookie:admin.cookie,method:'POST',body:{commandId:randomUUID(),code:'c',reason:'Assist the teacher with this meeting'}});assert.equal(assisted.response.status,200,assisted.text);assert.equal(assisted.json.data.data.attendance.recordedById,admin.id);
 const outside=await request(path+'/scans',{cookie:teacher.cookie,method:'POST',body:{commandId:randomUUID(),code:'visitor'}});assert.equal(outside.json.code,'STUDENT_NOT_IN_SESSION');assert.equal(outside.json.details.student.id,'visitor');assert.equal(Object.hasOwn(outside.json.details,'attendanceHistory'),false);
 const centralCount=await db.student.count();const inclusion={commandId:randomUUID(),studentId:'visitor',action:'INCLUDE',scope:'CLASS_AND_SESSION',expectedSnapshotRevision:0,expectedRosterRevision:0,reason:'Irregular enrollment',recordScan:true,code:'visitor'};
 const admitted=await request(path+'/roster-adjustments',{cookie:teacher.cookie,method:'POST',body:inclusion});assert.equal(admitted.response.status,200,admitted.text);assert.equal(admitted.json.data.data.attendance.status,'PRESENT');assert.equal(admitted.json.data.data.member.originalMember,false);assert.deepEqual(admitted.json.data.data.student,{id:'visitor',firstName:'Student',middleName:null,lastName:'visitor',usn:'00000001004',lrn:null});
 assert.deepEqual((await request(path+'/roster-adjustments',{cookie:teacher.cookie,method:'POST',body:inclusion})).json.data.data,admitted.json.data.data);assert.equal(await db.student.count(),centralCount);assert.equal((await db.student.findUniqueOrThrow({where:{id:'visitor'},include:{groups:true}})).groups[0].id,'outside');
 const finalized=await request(path+'/finalize',{cookie:teacher.cookie,method:'POST',body:{commandId:randomUUID(),expectedLifecycleRevision:0,expectedSnapshotRevision:1}});assert.equal(finalized.response.status,200,finalized.text);assert.equal(finalized.json.data.data.defaultedAbsent,1);
 assert.deepEqual((await request(path+'/scans',{cookie:teacher.cookie,method:'POST',body:scanBody})).json.data.data,saved.json.data.data,'lost acknowledgment recovers after finalization');
 assert.equal((await request(path+'/scans',{cookie:teacher.cookie,method:'POST',body:{commandId:randomUUID(),code:'d'}})).json.code,'SESSION_FINALIZED');
 const beforeFuture=(await request(path+'/roster',{cookie:teacher.cookie})).json.data;
 const future=await request(path+'/roster-adjustments',{cookie:teacher.cookie,method:'POST',body:{commandId:randomUUID(),studentId:'future',action:'INCLUDE',scope:'CLASS_ONLY',expectedSnapshotRevision:1,expectedRosterRevision:1,reason:'Enroll in future meetings only'}});assert.equal(future.response.status,200,future.text);assert.equal(future.json.data.data.attendance,null);assert.deepEqual((await request(path+'/roster',{cookie:teacher.cookie})).json.data,beforeFuture);
 assert.equal((await request('/api/events',{cookie:teacher.cookie})).response.status,403);assert.equal((await request('/api/students/imports/preview',{cookie:teacher.cookie,method:'POST',body:{}})).response.status,403);
 const dualSession=await start(dual);assert.equal((await request('/api/classroom/sessions/'+dualSession.id+'/scans',{cookie:dual.cookie,method:'POST',body:{commandId:randomUUID(),code:'a'}})).response.status,200);
 const membership=await db.classroomMembership.findUniqueOrThrow({where:{userId:dual.id}});const suspended=await request('/api/admin/classroom/teachers/'+dual.id,{cookie:admin.cookie,method:'PATCH',body:{commandId:randomUUID(),expectedRevision:membership.revision,action:'SUSPEND',reason:'Investigate class activity'}});assert.equal(suspended.response.status,200,suspended.text);
 assert.equal((await request('/api/classroom/sessions/'+dualSession.id+'/scans',{cookie:dual.cookie,method:'POST',body:{commandId:randomUUID(),code:'b'}})).response.status,403);assert.equal((await request('/api/events',{cookie:dual.cookie})).response.status,200,'independent organizer access survives classroom suspension');
 const key=createHash('sha256').update('classroom:scan:'+teacher.id).digest('hex');await db.requestRateLimit.update({where:{key},data:{hits:600,resetAt:new Date(Date.now()+60000)}});
 const limited=await request(path+'/scans',{cookie:teacher.cookie,method:'POST',body:scanBody});assert.equal(limited.response.status,429,limited.text);assert.equal(limited.response.headers.get('retry-after'),'60');assert.equal((await request('/api/classroom/commands/'+scanBody.commandId,{cookie:teacher.cookie})).response.status,200,'receipt recovery remains available when scan abuse bucket is full');
 console.log('PASS existing QR identities, duplicate/late-safe receipts, protected manual outcomes/reasons/notes, explicit enrollment scopes, immutable closure, admin attribution, tenant and bulk denials, dual-workspace suspension and shared scan limits.');
});
