import { Pool } from 'pg';import { setTimeout as delay } from 'node:timers/promises';import { getPgPoolConfig } from '@/globals/libs/dbConfig';
import assert from 'node:assert/strict';import { randomUUID } from 'node:crypto';import { before,after,test } from 'node:test';
import { createDisposableDb,createTestClient } from '@/globals/libs/testDb';
import { createAcademicTerm,createSubject,updateAcademicTerm } from './catalog';import { createClassOffering } from './classes';
import { getClassroomStartPreview,startClassroomSession,finalizeClassroomSession,listClassroomSessions } from './sessions';
import { setClassroomAttendance } from './attendance';
import { loadAuthorizedClassroomReport,buildReportPage } from './reports';
import { buildClassroomReport } from '../utils/reportProjection';
let fixture:Awaited<ReturnType<typeof createDisposableDb>>,client:ReturnType<typeof createTestClient>;const actor={userId:'report-teacher',credentialVersion:0};const other={userId:'report-other',credentialVersion:0};const admin={userId:'report-admin',credentialVersion:0};let termId:string,classId:string,sessionId:string;let firstVersion:string;
before(async()=>{fixture=await createDisposableDb();client=createTestClient(fixture.url);for(const account of [actor,other,admin]){await client.db.user.create({data:{id:account.userId,name:account.userId,email:account.userId+'@example.test',password:'test',role:account===admin?'ADMIN':'MEMBER',status:account===admin?'ACTIVE':'PENDING'}});if(account!==admin)await client.db.classroomMembership.create({data:{userId:account.userId,status:'APPROVED',departmentOrDesignation:'Teacher'}});}
 await client.db.group.create({data:{id:'report-section',name:'Report section',slug:'report-section',category:'SECTION'}});for(let i=0;i<6;i++)await client.db.student.create({data:{id:'report-student-'+i,usn:String(i).padStart(11,'0'),firstName:'Historical',lastName:'Student '+i,groups:{connect:{id:'report-section'}}}});
 const program=await client.db.group.create({data:{id:'report-program',name:'BS Information Technology',slug:'report-program',category:'PROGRAM'}});
 await client.db.group.update({where:{id:program.id},data:{students:{connect:Array.from({length:6},(_,i)=>({id:'report-student-'+i}))}}});
 termId=(await createAcademicTerm(client.db,actor,{commandId:randomUUID(),name:'Report term',startDate:'2026-08-01',endDate:'2026-12-31'})).data.id;const subjectId=(await createSubject(client.db,actor,{commandId:randomUUID(),title:'Report subject'})).data.id;
 classId=(await createClassOffering(client.db,actor,{commandId:randomUUID(),termId,subjectId,displayName:'Report class',sectionIds:['report-section'],exceptions:[]})).data.id;const preview=await getClassroomStartPreview(client.db,actor,classId);sessionId=(await startClassroomSession(client.db,actor,classId,{commandId:randomUUID(),scheduledStartAt:'2026-08-03T08:00:00+08:00',expectedConfigRevision:0,expectedRosterRevision:0,expectedRosterFingerprint:preview.rosterFingerprint})).data.id;
 for(const [index,status] of ['PRESENT','PRESENT','LATE','ABSENT','EXCUSED','EXCUSED'].entries())await setClassroomAttendance(client.db,actor,{commandId:randomUUID(),sessionId,studentId:'report-student-'+index,status,expectedRevision:0,...(status==='EXCUSED'?{excuseNote:'PRIVATE LETTER SHOULD NOT APPEAR'}:{})});await finalizeClassroomSession(client.db,actor,sessionId,{commandId:randomUUID(),expectedLifecycleRevision:0,expectedSnapshotRevision:0});
 const otherClass=(await createClassOffering(client.db,other,{commandId:randomUUID(),termId,subjectId,displayName:'Other private class',sectionIds:[],exceptions:[{studentId:'report-student-0',kind:'INCLUDE',reason:'Individually enrolled'}]})).data;const op=await getClassroomStartPreview(client.db,other,otherClass.id);const os=(await startClassroomSession(client.db,other,otherClass.id,{commandId:randomUUID(),scheduledStartAt:'2026-08-03T08:00:00+08:00',expectedConfigRevision:0,expectedRosterRevision:0,expectedRosterFingerprint:op.rosterFingerprint})).data;await finalizeClassroomSession(client.db,other,os.id,{commandId:randomUUID(),expectedLifecycleRevision:0,expectedSnapshotRevision:0});
});
after(async()=>{await client?.disconnect();await fixture?.cleanup();});
test('one authorized snapshot produces75% and a stable version across preparation times',async()=>{const snapshot=await loadAuthorizedClassroomReport(client.db,actor,{sessionId});firstVersion=snapshot.reportVersion;const report=buildClassroomReport(snapshot);assert.equal(report.totals.rateText,'75.0%');assert.equal(report.totals.excused,2);assert.equal((await loadAuthorizedClassroomReport(client.db,actor,{sessionId})).reportVersion,firstVersion);assert.ok(!JSON.stringify(snapshot).includes('PRIVATE LETTER'));assert.equal(snapshot.sessions[0].members[0].studentSnapshot.firstName,'Historical');});
test('shared identity never widens a teacher’s student-term attendance history; admin sees both classes',async()=>{const filters={termId,studentId:'report-student-0'};const own=buildClassroomReport(await loadAuthorizedClassroomReport(client.db,actor,filters));const school=buildClassroomReport(await loadAuthorizedClassroomReport(client.db,admin,filters));assert.equal(own.totals.eligibleMeetings,1);assert.equal(own.totals.rate,100);assert.equal(school.totals.eligibleMeetings,2);assert.equal(school.totals.rate,50);await assert.rejects(loadAuthorizedClassroomReport(client.db,other,{sessionId}),{code:'REPORT_NOT_FOUND'});await assert.rejects(loadAuthorizedClassroomReport(client.db,other,{termId,classId}),{code:'CLASS_NOT_FOUND'});});
test('current student renames/transfers do not change frozen reports or versions; display pagination does not change selection totals',async()=>{await client.db.student.update({where:{id:'report-student-0'},data:{firstName:'Current name',groups:{set:[]}}});const report=buildClassroomReport(await loadAuthorizedClassroomReport(client.db,actor,{sessionId}));assert.equal(report.reportVersion,firstVersion);assert.equal(report.rows[0].identity.firstName,'Historical');const page=buildReportPage(report,{page:2,pageSize:2});assert.equal(page.rows.length,2);assert.equal(page.totalRows,6);assert.equal(page.totals.rateText,'75.0%');assert.equal(page.reportVersion,firstVersion);});
test('student history pagination retains its aggregate identity and totals',async()=>{
 const report=buildClassroomReport(await loadAuthorizedClassroomReport(client.db,actor,{termId,classId,studentId:'report-student-0'}));
 report.entries=[report.entries[0],{...report.entries[0],sessionId:'another-meeting'}];
 const page=buildReportPage(report,{page:2,pageSize:1});assert.equal(page.rows.length,1);assert.equal(page.rows[0].studentId,'report-student-0');assert.equal(page.entries[0].sessionId,'another-meeting');assert.deepEqual(page.totals,report.totals);
});
test('historical student lookup runs before pagination without changing totals, versions, meetings or export scope',async()=>{
 const report=buildClassroomReport(await loadAuthorizedClassroomReport(client.db,actor,{sessionId,q:'historical'}));
 const historical=buildReportPage(report,{q:'hIsToRiCaL',pageSize:2,page:2});assert.equal(historical.rows.length,2);assert.equal(historical.totalRows,6);assert.equal(historical.totalStudents,6);
 const name=buildReportPage(report,{q:'Student 5',pageSize:1});assert.equal(name.totalRows,1);assert.equal(name.rows[0].studentId,'report-student-5');
 const identifier=buildReportPage(report,{q:'00000000005'});assert.equal(identifier.totalRows,1);
 const current=buildReportPage(report,{q:'Current name'});assert.equal(current.totalRows,0);
 for(const result of [historical,name,identifier,current]){assert.deepEqual(result.totals,report.totals);assert.deepEqual(result.meetings,report.meetings);assert.equal(result.reportVersion,firstVersion);assert.deepEqual(result.filters,{sessionId});}
 const previousName=structuredClone(report);previousName.entries.push({...previousName.entries[0],identity:{...previousName.entries[0].identity,firstName:'Earlier name',lrn:'012345678901'}});
 assert.equal(buildReportPage(previousName,{q:'Earlier name'}).totalRows,1);assert.equal(buildReportPage(previousName,{q:'012345678901'}).totalRows,1);
});
test('a correction invalidates expected exports/print; matching exports audit only preparation metadata',async()=>{await setClassroomAttendance(client.db,actor,{commandId:randomUUID(),sessionId,studentId:'report-student-1',status:'ABSENT',expectedRevision:1,reason:'Corrected after checking the attendance sheet'});await assert.rejects(loadAuthorizedClassroomReport(client.db,actor,{sessionId,expectedReportVersion:firstVersion},{purpose:'CSV'}),{code:'REPORT_CHANGED'});const fresh=await loadAuthorizedClassroomReport(client.db,actor,{sessionId});assert.notEqual(fresh.reportVersion,firstVersion);assert.equal(buildClassroomReport(fresh).totals.rateText,'50.0%');await loadAuthorizedClassroomReport(client.db,actor,{sessionId,expectedReportVersion:fresh.reportVersion},{purpose:'PRINT'});const audit=await client.db.classroomAudit.findFirstOrThrow({where:{action:'CLASSROOM_REPORT_PREPARED'},orderBy:{id:'desc'}});assert.equal(audit.actorId,actor.userId);assert.ok(!JSON.stringify(audit,(_key,value)=>typeof value==='bigint'?String(value):value).includes('PRIVATE LETTER'));assert.equal((audit.after as {reportVersion:string}).reportVersion,fresh.reportVersion);await assert.rejects(loadAuthorizedClassroomReport(client.db,actor,{sessionId},{purpose:'CSV'}),{code:'REPORT_VERSION_REQUIRED'});});
test('grading periods apply inclusive Manila dates and invalidate prepared print after an edit or removal',async()=>{
 const draft={name:'Prelim',startDate:'2026-08-03',endDate:'2026-08-03'};
 const update=(expectedRevision:number,gradingPeriods:Array<typeof draft & {id?:string}>,actorContext=admin)=>updateAcademicTerm(client.db,actorContext,termId,{commandId:randomUUID(),expectedRevision,gradingPeriods,reason:'Set the school grading calendar'});
 await assert.rejects(update(0,[draft],actor),{status:403});
 await assert.rejects(update(0,[{...draft,startDate:'2026-07-31'}]),{code:'INVALID_PERIOD_RANGE'});
 await assert.rejects(update(0,[draft,{...draft,name:'Midterm'}]),{code:'OVERLAPPING_PERIODS'});
 const term=(await update(0,[draft,{name:'Midterm',startDate:'2026-08-06',endDate:'2026-09-08'}])).data;
 const [gradingPeriod,midterm]=term.gradingPeriods;
 const filters={termId,classId,gradingPeriodId:gradingPeriod.id,view:'class' as const};
 const report=buildClassroomReport(await loadAuthorizedClassroomReport(client.db,actor,filters));
 assert.equal(report.gradingPeriod?.name,'Prelim');
 assert.equal(report.registerMetadata?.course,'BS Information Technology');
 assert.equal(report.registerMetadata?.instructor,'report-teacher');
 assert.deepEqual(report.registerMetadata?.sections,['Report section']);
 assert.equal(report.meetings[0]?.id,sessionId);
 await assert.rejects(loadAuthorizedClassroomReport(client.db,other,filters),{code:'CLASS_NOT_FOUND'});
 const studentFilters={termId,studentId:'report-student-0',gradingPeriodId:gradingPeriod.id};
 const student=buildClassroomReport(await loadAuthorizedClassroomReport(client.db,actor,studentFilters));
 assert.equal(student.gradingPeriod?.name,'Prelim');
 assert.deepEqual(student.meetings.map(meeting=>meeting.id),[sessionId]);
 const meeting=await loadAuthorizedClassroomReport(client.db,actor,{termId,sessionId,gradingPeriodId:gradingPeriod.id});
 assert.equal(meeting.gradingPeriod?.name,'Prelim');
 assert.deepEqual((await listClassroomSessions(client.db,actor,classId,new URLSearchParams({gradingPeriodId:gradingPeriod.id}))).items.map(item=>item.id),[sessionId]);
 assert.equal((await listClassroomSessions(client.db,actor,classId,new URLSearchParams({gradingPeriodId:midterm.id}))).total,0);
 await assert.rejects(loadAuthorizedClassroomReport(client.db,actor,{termId,sessionId,gradingPeriodId:midterm.id}),{code:'REPORT_NOT_FOUND'});
 await assert.rejects(loadAuthorizedClassroomReport(client.db,other,{termId,sessionId,gradingPeriodId:gradingPeriod.id}),{code:'REPORT_NOT_FOUND'});
 const print={...filters,expectedReportVersion:report.reportVersion};
 await loadAuthorizedClassroomReport(client.db,actor,print,{purpose:'PRINT'});
 await update(1,[{...gradingPeriod,endDate:'2026-08-04'}]);
 await assert.rejects(update(1,[]),{code:'CATALOG_CHANGED'});
 await assert.rejects(loadAuthorizedClassroomReport(client.db,actor,print,{purpose:'PRINT'}),{code:'REPORT_CHANGED'});
 await assert.rejects(loadAuthorizedClassroomReport(client.db,actor,{...studentFilters,expectedReportVersion:student.reportVersion},{purpose:'CSV'}),{code:'REPORT_CHANGED'});
 const latest=await loadAuthorizedClassroomReport(client.db,actor,filters);
 await update(2,[]);
 await assert.rejects(loadAuthorizedClassroomReport(client.db,actor,{...filters,expectedReportVersion:latest.reportVersion},{purpose:'PRINT'}),{code:'REPORT_CHANGED'});
});

test('revocation and stale credential generations deny report snapshots',async()=>{await client.db.classroomMembership.update({where:{userId:actor.userId},data:{status:'SUSPENDED'}});await assert.rejects(loadAuthorizedClassroomReport(client.db,actor,{sessionId}),{code:'CLASSROOM_SUSPENDED'});await client.db.classroomMembership.update({where:{userId:actor.userId},data:{status:'APPROVED'}});await assert.rejects(loadAuthorizedClassroomReport(client.db,{...actor,credentialVersion:9},{sessionId}),{code:'UNAUTHORIZED'});});
test('midway enrollment contributes only its frozen meeting; active and canceled sessions stay outside totals',async()=>{
 await client.db.student.create({data:{id:'report-midway',usn:'99999999999',firstName:'Midway',lastName:'Student',groups:{connect:{id:'report-section'}}}});
 const preview=await getClassroomStartPreview(client.db,actor,classId);const start={commandId:randomUUID(),scheduledStartAt:'2026-08-03T13:00:00+08:00',expectedConfigRevision:preview.configRevision,expectedRosterRevision:preview.rosterRevision,expectedRosterFingerprint:preview.rosterFingerprint};const later=(await startClassroomSession(client.db,actor,classId,start)).data;
 let report=buildClassroomReport(await loadAuthorizedClassroomReport(client.db,actor,{termId,classId}));assert.equal(report.excludedSessions.active,1);assert.equal(report.meetings.length,1);
 await finalizeClassroomSession(client.db,actor,later.id,{commandId:randomUUID(),expectedLifecycleRevision:0,expectedSnapshotRevision:0});report=buildClassroomReport(await loadAuthorizedClassroomReport(client.db,actor,{termId,classId,studentId:'report-midway'}));assert.equal(report.totals.eligibleMeetings,1);assert.equal(report.meetings.length,1);assert.equal(report.totals.absent,1);assert.equal(report.rows[0].studentId,'report-midway');
 const classReport=buildClassroomReport(await loadAuthorizedClassroomReport(client.db,actor,{termId,classId,view:'class'}));
 assert.equal(classReport.registerMetadata?.course,'');
 const register=buildReportPage(classReport,{view:'class',q:'Midway'}).register;
 assert.deepEqual(register?.meetingIds,[sessionId,later.id]);
 assert.deepEqual(register?.marks,[['NOT_ENROLLED','ABSENT']]);
 const manyMeetings=Array.from({length:13},(_,index)=>({...classReport.meetings[0],id:'meeting-'+index}));
 assert.deepEqual(buildReportPage({...classReport,meetings:manyMeetings},{view:'class'}).register?.meetingIds,manyMeetings.slice(1).map(meeting=>meeting.id));
 assert.deepEqual(buildReportPage({...classReport,meetings:manyMeetings},{view:'class',meetingPage:2}).register?.meetingIds,['meeting-0']);
 const {cancelClassroomSession}=await import('./sessions');await cancelClassroomSession(client.db,actor,later.id,{commandId:randomUUID(),expectedLifecycleRevision:1,reason:'Cancel the duplicate meeting for reporting'});report=buildClassroomReport(await loadAuthorizedClassroomReport(client.db,actor,{termId,classId}));assert.equal(report.excludedSessions.canceled,1);assert.equal(report.totals.eligibleMeetings,6);assert.equal(report.rows.some(row=>row.studentId==='report-midway'),false);
});

async function reportWaits(name:string){const end=Date.now()+1200;while(Date.now()<end){const rows=await client.db.$queryRaw<Array<{waiting:boolean}>>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${name} AND wait_event_type='Lock') AS waiting`;if(rows[0].waiting)return;await delay(10);}throw new Error('Report did not reach the PostgreSQL lock barrier.');}
test('ownership changed before a queued report lock forces a fresh scope check, never old-owner data',async()=>{
 const name='report-owner-'+randomUUID();const url=new URL(fixture.url);url.searchParams.set('application_name',name);const reader=createTestClient(url.toString());const pool=new Pool(getPgPoolConfig(fixture.url));const writer=await pool.connect();await writer.query('BEGIN');await writer.query('SELECT id FROM "ClassOffering" WHERE id=$1 FOR UPDATE',[classId]);
 const pending=loadAuthorizedClassroomReport(reader.db,actor,{sessionId}).then(value=>({value}),error=>({error}));
 try{await reportWaits(name);await writer.query('UPDATE "ClassOffering" SET "primaryTeacherId"=$1,"configRevision"="configRevision"+1 WHERE id=$2',[other.userId,classId]);await writer.query('COMMIT');const result=await pending;assert.ok('error' in result);assert.equal(result.error.code,'REPORT_NOT_FOUND');assert.equal(buildClassroomReport(await loadAuthorizedClassroomReport(client.db,other,{sessionId})).totals.rate,50);}
 finally{await writer.query('ROLLBACK');await pending;writer.release();await pool.end();await reader.disconnect();}
});
test('membership revocation committed ahead of a waiting report is rechecked after RR retry',async()=>{
 const name='report-revoke-'+randomUUID();const url=new URL(fixture.url);url.searchParams.set('application_name',name);const reader=createTestClient(url.toString());const pool=new Pool(getPgPoolConfig(fixture.url));const writer=await pool.connect();await writer.query('BEGIN');await writer.query('SELECT "userId" FROM "ClassroomMembership" WHERE "userId"=$1 FOR UPDATE',[other.userId]);
 const pending=loadAuthorizedClassroomReport(reader.db,other,{sessionId}).then(value=>({value}),error=>({error}));
 try{await reportWaits(name);await writer.query('UPDATE "ClassroomMembership" SET status=$1 WHERE "userId"=$2',['SUSPENDED',other.userId]);await writer.query('COMMIT');const result=await pending;assert.ok('error' in result);assert.equal(result.error.code,'CLASSROOM_SUSPENDED');}
 finally{await writer.query('ROLLBACK');await pending;writer.release();await pool.end();await reader.disconnect();}
});
