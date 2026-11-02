import 'server-only';
import { randomUUID } from 'node:crypto';
import { Prisma,type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AuthError } from '@/globals/utils/authError';
import { isRetryableTransactionError } from '@/globals/utils/prismaError';
import { guardClassroomActor,classroomAdministrator,type ActorContext } from './access';
import { commandHash } from './commands';
import { reportQuerySchema,reportScopeFields } from '../schemas/reportSchema';
import { studentSnapshotSchema } from '../schemas/sessionSchema';
import type { ClassroomReport,ClassroomReportFilters,ClassroomReportSnapshot,ReportSnapshotSession } from '../types/report';
export const CLASSROOM_REPORT_LIMITS={sessions:500,members:100000} as const;
const frozenClass=z.object({displayName:z.string(),term:z.object({id:z.string(),name:z.string()}),subject:z.object({title:z.string()})});
/** Frozen rows only; current directory/section membership never supplies eligibility. */
export async function loadAuthorizedClassroomReport(db:PrismaClient,actor:ActorContext,raw:unknown,options:{purpose?:'JSON'|'CSV'|'PRINT'}={}):Promise<ClassroomReportSnapshot>{
 const input=reportQuerySchema.parse(raw);const purpose=options.purpose??'JSON';
 if(purpose!=='JSON'&&!input.expectedReportVersion)throw new AuthError('Prepare the report before printing or exporting.',400,'REPORT_VERSION_REQUIRED');
 const filters=Object.fromEntries(Object.keys(reportScopeFields).flatMap(key=>input[key as keyof typeof reportScopeFields]===undefined?[]:[[key,input[key as keyof typeof reportScopeFields]]])) as ClassroomReportFilters;
 for(let attempt=0;;attempt++)try{return await db.$transaction(async tx=>{
  await tx.$executeRaw`SET LOCAL lock_timeout = '1500ms'`;await tx.$executeRaw`SET LOCAL statement_timeout = '10000ms'`;
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.userId} FOR SHARE`;const user=await guardClassroomActor(tx,actor);const admin=classroomAdministrator(user);
  if(filters.termId&&!await tx.academicTerm.findUnique({where:{id:filters.termId},select:{id:true}}))throw new AuthError('Academic term not found.',404,'TERM_NOT_FOUND');
  let classId=filters.classId;
  if(filters.sessionId){const reference=await tx.classroomSession.findUnique({where:{id:filters.sessionId},select:{classId:true}});if(!reference||(classId&&classId!==reference.classId))throw new AuthError('Attendance report not found.',404,'REPORT_NOT_FOUND');classId=reference.classId;}
  const dateFilter:Prisma.DateTimeFilter={...(filters.from?{gte:new Date(filters.from+'T00:00:00+08:00')}:{}),...(filters.to?{lt:new Date(Date.parse(filters.to+'T00:00:00+08:00')+86400000)}:{})};
  const meetingWhere:Prisma.ClassroomSessionWhereInput={...(filters.sessionId?{id:filters.sessionId}:{}),...(filters.from||filters.to?{scheduledStartAt:dateFilter}:{})};
  const ownerWhere:Prisma.ClassOfferingWhereInput={...(!admin?{primaryTeacherId:user.id}:{}),...(filters.termId?{termId:filters.termId}:{})};
  const classes=await tx.classOffering.findMany({where:{...ownerWhere,...(classId?{id:classId}:{sessions:{some:{...meetingWhere,...(filters.studentId?{members:{some:{studentId:filters.studentId}}}:{})}}})},select:{id:true},orderBy:{id:'asc'},take:CLASSROOM_REPORT_LIMITS.sessions+1});
  if(classId&&!classes.length)throw new AuthError(filters.sessionId?'Attendance report not found.':'Class not found.',404,filters.sessionId?'REPORT_NOT_FOUND':'CLASS_NOT_FOUND');
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
  let projected:ReportSnapshotSession[];
  try{const grouped=new Map<string,ReportSnapshotSession['members']>();for(const member of members){const s=studentSnapshotSchema.parse(member.studentSnapshot);if(s.id!==member.studentId)throw new Error('Mismatched snapshot identity');const identity={id:s.id,firstName:s.firstName,lastName:s.lastName,middleName:s.middleName,usn:s.usn,lrn:s.lrn};const rows=grouped.get(member.sessionId)??[];rows.push({studentId:member.studentId,included:member.included,membershipRevision:member.membershipRevision,studentSnapshot:identity,attendance:member.attendance});grouped.set(member.sessionId,rows);}projected=sessions.map(session=>({...session,scheduledStartAt:session.scheduledStartAt.toISOString(),classSnapshot:frozenClass.parse(session.classSnapshot),members:grouped.get(session.id)??[]}));}
  catch{throw new AuthError('The historical report snapshot is incomplete. Contact an administrator.',500,'INCOMPLETE_REPORT');}
  const reportVersion=commandHash({v:1,policy:'CLASSROOM_RATE_V1',actorId:user.id,filters,sessions:projected});
  if(input.expectedReportVersion&&input.expectedReportVersion!==reportVersion)throw new AuthError('Attendance changed since this report was prepared. Refresh it before printing or exporting.',409,'REPORT_CHANGED');
  const evaluatedAt=new Date().toISOString();
  if(purpose!=='JSON')await tx.classroomAudit.create({data:{action:'CLASSROOM_REPORT_PREPARED',entityType:'ClassroomReport',entityId:reportVersion,classId:filters.classId,sessionId:filters.sessionId,studentId:filters.studentId,actorId:user.id,actorName:user.name,commandId:randomUUID(),after:{reportVersion,filters,purpose,format:input.format,sessionCount:sessions.length,memberCount:members.length,evaluatedAt}}});
  return {filters,evaluatedAt,reportVersion,sessions:projected};
 },{isolationLevel:'RepeatableRead',timeout:15000,maxWait:2000});}catch(error){if(attempt===0&&isRetryableTransactionError(error))continue;throw error;}
}
export function buildReportPage(report:ClassroomReport,{page=1,pageSize=100}:{page?:number;pageSize?:number}={}){const offset=(page-1)*pageSize;return {...report,rows:report.rows.slice(offset,offset+pageSize),entries:report.entries.slice(offset,offset+pageSize),totalRows:report.rows.length,totalEntries:report.entries.length,page,pageSize};}
