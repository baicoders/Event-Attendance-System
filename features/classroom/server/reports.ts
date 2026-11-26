import 'server-only';
import { randomUUID } from 'node:crypto';
import { Prisma,type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AuthError } from '@/globals/utils/authError';
import { isRetryableTransactionError } from '@/globals/utils/prismaError';
import { guardClassroomActor,classroomAdministrator,type ActorContext } from './access';
import { commandHash } from './commands';
import { reportQuerySchema,reportScopeFields } from '../schemas/reportSchema';
import { gradingPeriodSchema } from '../schemas/classSchema';
import { REGISTER_MEETINGS_PER_PAGE, buildRegisterMarks, orderRegisterRows } from '../utils/reportRegister';
import { schoolDateRange } from '../utils/attendancePolicy';
import { studentSnapshotSchema } from '../schemas/sessionSchema';
import type { ClassroomReport,ClassroomReportFilters,ClassroomReportSnapshot,ReportSnapshotSession, RegisterMetadata } from '../types/report';
export const CLASSROOM_REPORT_LIMITS={sessions:500,members:100000} as const;
const frozenClass=z.object({displayName:z.string(),term:z.object({id:z.string(),name:z.string()}),subject:z.object({title:z.string()}),sections:z.array(z.object({name:z.string()})).optional(),primaryTeacher:z.object({name:z.string()}).optional()});
/** Frozen rows only; current directory/section membership never supplies eligibility. */
export async function loadAuthorizedClassroomReport(db:PrismaClient,actor:ActorContext,raw:unknown,options:{purpose?:'JSON'|'CSV'|'PRINT'|'XLSX'}={}):Promise<ClassroomReportSnapshot>{
 const input=reportQuerySchema.parse(raw);const purpose=options.purpose??'JSON';
 if(purpose!=='JSON'&&!input.expectedReportVersion)throw new AuthError('Prepare the report before printing or exporting.',400,'REPORT_VERSION_REQUIRED');
 const filters=Object.fromEntries(Object.keys(reportScopeFields).flatMap(key=>input[key as keyof typeof reportScopeFields]===undefined?[]:[[key,input[key as keyof typeof reportScopeFields]]])) as ClassroomReportFilters;
 const classRegister=!!(filters.classId&&filters.termId&&!filters.sessionId&&!filters.studentId);
 for(let attempt=0;;attempt++)try{return await db.$transaction(async tx=>{
  await tx.$executeRaw`SET LOCAL lock_timeout = '1500ms'`;await tx.$executeRaw`SET LOCAL statement_timeout = '10000ms'`;
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.userId} FOR SHARE`;const user=await guardClassroomActor(tx,actor);const admin=classroomAdministrator(user);
  const term=filters.termId?await tx.academicTerm.findUnique({where:{id:filters.termId},select:{id:true,gradingPeriods:true}}):null;
  if(filters.termId&&!term)throw new AuthError('Academic term not found.',404,'TERM_NOT_FOUND');
  let classId=filters.classId;
  if(filters.sessionId){const reference=await tx.classroomSession.findUnique({where:{id:filters.sessionId},select:{classId:true}});if(!reference||(classId&&classId!==reference.classId))throw new AuthError('Attendance report not found.',404,'REPORT_NOT_FOUND');classId=reference.classId;}
  const ownerWhereBase:Prisma.ClassOfferingWhereInput={...(!admin?{primaryTeacherId:user.id}:{}),...(filters.termId?{termId:filters.termId}:{})};
  const gradingPeriod=filters.gradingPeriodId?z.array(gradingPeriodSchema).parse(term?.gradingPeriods).find(period=>period.id===filters.gradingPeriodId):undefined;
  const from=gradingPeriod?.startDate??filters.from;
  const to=gradingPeriod?.endDate??filters.to;
  const meetingWhere:Prisma.ClassroomSessionWhereInput={...(filters.sessionId?{id:filters.sessionId}:{}),...(from||to?{scheduledStartAt:schoolDateRange(from,to)}:{})};
  const classes=await tx.classOffering.findMany({where:{...ownerWhereBase,...(classId?{id:classId}:{sessions:{some:{...meetingWhere,...(filters.studentId?{members:{some:{studentId:filters.studentId}}}:{})}}})},select:{id:true},orderBy:{id:'asc'},take:CLASSROOM_REPORT_LIMITS.sessions+1});
  if(classId&&!classes.length)throw new AuthError(filters.sessionId?'Attendance report not found.':'Class not found.',404,filters.sessionId?'REPORT_NOT_FOUND':'CLASS_NOT_FOUND');
  if(filters.gradingPeriodId&&!gradingPeriod){
   if(input.expectedReportVersion)throw new AuthError('The grading period was removed. Choose another range before preparing the report.',409,'REPORT_CHANGED');
   throw new AuthError('This grading period is unavailable. Choose another range.',404,'PERIOD_NOT_FOUND');
  }
  if(classes.length>CLASSROOM_REPORT_LIMITS.sessions)throw new AuthError('Narrow the report by class or dates.',422,'REPORT_TOO_LARGE');
  const ids=classes.map(row=>row.id);
  // Current ownership cannot change between permission validation and response
  // preparation. A changed RR row raises serialization failure, retried below.
  if(ids.length)await tx.$queryRaw(Prisma.sql`SELECT id FROM "ClassOffering" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`);
  if(filters.studentId&&!await tx.student.findUnique({where:{id:filters.studentId},select:{id:true}}))throw new AuthError('Student not found.',404,'STUDENT_NOT_FOUND');
  const sessions=await tx.classroomSession.findMany({where:{...meetingWhere,classId:{in:ids}},select:{id:true,classId:true,state:true,scheduledStartAt:true,lifecycleRevision:true,snapshotRevision:true,classSnapshot:true},orderBy:[{scheduledStartAt:'asc'},{id:'asc'}],take:CLASSROOM_REPORT_LIMITS.sessions+1});
  if(sessions.length>CLASSROOM_REPORT_LIMITS.sessions)throw new AuthError('This selection exceeds500 meetings. Narrow the dates or class.',422,'REPORT_TOO_LARGE');
  if(filters.sessionId&&!sessions.length)throw new AuthError('Attendance report not found for these dates.',404,'REPORT_NOT_FOUND');
  const finalizedIds=sessions.filter(row=>row.state==='FINALIZED').map(row=>row.id);const memberWhere={sessionId:{in:finalizedIds},...(filters.studentId?{studentId:filters.studentId}:{})};
  if(await tx.sessionRosterMember.count({where:memberWhere})>CLASSROOM_REPORT_LIMITS.members)throw new AuthError('This selection exceeds100,000 eligibility records. Narrow the dates or class.',422,'REPORT_TOO_LARGE');
  const members=await tx.sessionRosterMember.findMany({where:memberWhere,select:{sessionId:true,studentId:true,included:true,membershipRevision:true,studentSnapshot:true,attendance:{select:{status:true,revision:true}}},orderBy:[{sessionId:'asc'},{studentId:'asc'}],take:CLASSROOM_REPORT_LIMITS.members+1});
  if(members.length>CLASSROOM_REPORT_LIMITS.members)throw new AuthError('Narrow the attendance report selection.',422,'REPORT_TOO_LARGE');
  const programs=new Map<string,Array<{id:string;name:string}>>();
  let registerMetadata:RegisterMetadata|undefined;
  let projected:ReportSnapshotSession[];
  try{const grouped=new Map<string,ReportSnapshotSession['members']>();for(const member of members){const s=studentSnapshotSchema.parse(member.studentSnapshot);if(s.id!==member.studentId)throw new Error('Mismatched snapshot identity');if(classRegister&&member.included){
   const programGroups=s.groups.filter(group=>group.category==='PROGRAM');
   programs.set(member.sessionId+':'+member.studentId,programGroups);
  }
  const identity={id:s.id,firstName:s.firstName,lastName:s.lastName,middleName:s.middleName,usn:s.usn,lrn:s.lrn};const rows=grouped.get(member.sessionId)??[];rows.push({studentId:member.studentId,included:member.included,membershipRevision:member.membershipRevision,studentSnapshot:identity,attendance:member.attendance});grouped.set(member.sessionId,rows);}projected=sessions.map(session=>({...session,scheduledStartAt:session.scheduledStartAt.toISOString(),classSnapshot:frozenClass.parse(session.classSnapshot),members:grouped.get(session.id)??[]}));}
  catch{throw new AuthError('The historical report snapshot is incomplete. Contact an administrator.',500,'INCOMPLETE_REPORT');}
  if(classRegister&&classId){
   const finalized=projected.filter(session=>session.state==='FINALIZED');
   const latest=finalized.at(-1)?.classSnapshot;
   const current=latest?null:await tx.classOffering.findUniqueOrThrow({where:{id:classId},select:{
    subject:{select:{title:true}},term:{select:{name:true}},primaryTeacher:{select:{name:true}},
    sections:{orderBy:{sectionId:'asc'},select:{section:{select:{name:true}}}},
   }});
   const latestPrograms=new Map<string,Array<{id:string;name:string}>>();
   for(const session of finalized)for(const member of session.members)if(member.included){
    latestPrograms.set(member.studentId,programs.get(session.id+':'+member.studentId)??[]);
   }
   const first=[...latestPrograms.values()][0]?.[0];
   const course=first&&[...latestPrograms.values()].every(groups=>groups.length===1&&groups[0].id===first.id)?first.name:'';
   registerMetadata={
    subject:latest?.subject.title??current?.subject.title??'',
    term:latest?.term.name??current?.term.name??'',
    instructor:latest?.primaryTeacher?.name??current?.primaryTeacher.name??'',
    sections:latest?.sections?.map(section=>section.name)??current?.sections.map(({section})=>section.name)??[],
    course,
   };
  }
  const reportVersion=commandHash({v:1,policy:'CLASSROOM_RATE_V1',actorId:user.id,filters,gradingPeriod,registerMetadata,sessions:projected});
  if(input.expectedReportVersion&&input.expectedReportVersion!==reportVersion)throw new AuthError('Attendance changed since this report was prepared. Refresh it before printing or exporting.',409,'REPORT_CHANGED');
  if(purpose==='XLSX'&&input.view==='class'){
   const finalSessions=projected.filter(session=>session.state==='FINALIZED');
   const students=new Set<string>();
   for(const session of finalSessions)for(const member of session.members)if(member.included)students.add(member.studentId);
   if(students.size*finalSessions.length>CLASSROOM_REPORT_LIMITS.members){
    throw new AuthError('This register is too large to download. Choose a shorter report range.',422,'REPORT_TOO_LARGE');
   }
  }
  const evaluatedAt=new Date().toISOString();
  if(purpose!=='JSON')await tx.classroomAudit.create({data:{action:'CLASSROOM_REPORT_PREPARED',entityType:'ClassroomReport',entityId:reportVersion,classId:filters.classId,sessionId:filters.sessionId,studentId:filters.studentId,actorId:user.id,actorName:user.name,commandId:randomUUID(),after:{reportVersion,filters,purpose,format:input.format,sessionCount:sessions.length,memberCount:members.length,evaluatedAt}}});
  return {filters,gradingPeriod,registerMetadata,evaluatedAt,reportVersion,sessions:projected};
 },{isolationLevel:'RepeatableRead',timeout:15000,maxWait:2000});}catch(error){if(attempt===0&&isRetryableTransactionError(error))continue;throw error;}
}
/** Table lookup matches frozen identities, including earlier included meeting names. */
export function buildReportPage(report:ClassroomReport,{page=1,pageSize=100,q='',view,meetingPage=1}:{page?:number;pageSize?:number;q?:string;view?:'class';meetingPage?:number}={}){
 const offset=(page-1)*pageSize;const needle=q.trim().toLocaleLowerCase();
 const matchingIds=needle?new Set(report.entries.filter(entry=>[entry.identity.firstName,entry.identity.lastName,entry.identity.middleName,entry.identity.usn,entry.identity.lrn,[entry.identity.firstName,entry.identity.middleName,entry.identity.lastName].filter(Boolean).join(' '),[entry.identity.lastName,entry.identity.firstName].join(', ')].some(value=>value?.toLocaleLowerCase().includes(needle))).map(entry=>entry.studentId)):null;
 const orderedRows=view==='class'?orderRegisterRows(report.rows):report.rows;
 const rowNumbers=new Map(orderedRows.map((row,index)=>[row.studentId,index+1]));
 const rows=matchingIds?orderedRows.filter(row=>matchingIds.has(row.studentId)):orderedRows;
 const visibleRows=report.filters.studentId?rows:rows.slice(offset,offset+pageSize);
 const pageCount=Math.max(1,Math.ceil(report.meetings.length/REGISTER_MEETINGS_PER_PAGE));
 const currentMeetingPage=Math.min(meetingPage,pageCount);
 const end=Math.max(0,report.meetings.length-(currentMeetingPage-1)*REGISTER_MEETINGS_PER_PAGE);
 const meetingIds=report.meetings.slice(Math.max(0,end-REGISTER_MEETINGS_PER_PAGE),end).map(meeting=>meeting.id);
 const register=view==='class'?{meetingIds,rowNumbers:visibleRows.map(row=>rowNumbers.get(row.studentId)!),marks:buildRegisterMarks(report.entries,visibleRows,meetingIds),meetingPage:currentMeetingPage,pageCount}:undefined;
 return {...report,rows:visibleRows,...(register?{register}:{}),entries:report.entries.slice(offset,offset+pageSize),totalRows:rows.length,totalStudents:report.rows.length,totalEntries:report.entries.length,page,pageSize};
}
