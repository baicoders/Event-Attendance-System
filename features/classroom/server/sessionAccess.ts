import 'server-only';
import type { Prisma,ClassroomSession,ClassroomAttendance,ClassroomAttendanceStatus } from '@prisma/client';
import { AuthError } from '@/globals/utils/authError';
import type { ClassroomUser } from './access';
import { lockOwnedClass } from './classAccess';
import { policySnapshotSchema,studentSnapshotSchema,memberOriginSchema } from '../schemas/sessionSchema';

export async function lockOwnedSession(tx:Prisma.TransactionClient,sessionId:string,user:ClassroomUser,mode:'SHARE'|'UPDATE',classMode:'SHARE'|'UPDATE'='SHARE'){
  const reference=await tx.classroomSession.findUnique({where:{id:sessionId},select:{classId:true}});
  if(!reference)throw new AuthError('Attendance session not found.',404,'SESSION_NOT_FOUND');
  const offering=await lockOwnedClass(tx,reference.classId,user,classMode);
  if(mode==='UPDATE')await tx.$queryRaw`SELECT id FROM "ClassroomSession" WHERE id=${sessionId} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "ClassroomSession" WHERE id=${sessionId} FOR SHARE`;
  const session=await tx.classroomSession.findUnique({where:{id:sessionId}});
  if(!session)throw new AuthError('Attendance session not found.',404,'SESSION_NOT_FOUND');
  return {session,offering};
}
export function requireActiveSession(session:ClassroomSession){
  if(session.state==='CANCELED')throw new AuthError('This session is canceled.',409,'SESSION_CANCELED');
  if(session.state==='FINALIZED')throw new AuthError('This session is finalized. Use a reasoned attendance correction.',409,'SESSION_FINALIZED');
}
export function requireLifecycleRevision(session:ClassroomSession,expected:number){
  if(session.lifecycleRevision!==expected)throw new AuthError('The session changed. Reload its current state.',409,'SESSION_CHANGED');
}
export type AttendanceCounts=Record<ClassroomAttendanceStatus,number>;
export function emptyAttendanceCounts():AttendanceCounts{return {UNMARKED:0,PRESENT:0,LATE:0,ABSENT:0,EXCUSED:0};}
/** Aggregate only returned session IDs; excluded members never contribute to progress. */
export async function sessionCountsForIds(tx:Prisma.TransactionClient,sessionIds:string[]){
  const counts=new Map(sessionIds.map(id=>[id,emptyAttendanceCounts()]));
  if(!sessionIds.length)return counts;
  const grouped=await tx.classroomAttendance.groupBy({by:['sessionId','status'],where:{sessionId:{in:sessionIds},member:{included:true}},_count:{_all:true}});
  for(const row of grouped)counts.get(row.sessionId)![row.status]=row._count._all;
  return counts;
}
export async function sessionCounts(tx:Prisma.TransactionClient,sessionId:string){
  return (await sessionCountsForIds(tx,[sessionId])).get(sessionId)!;
}
export function attendanceProgress(counts:AttendanceCounts){
  const rosterCount=Object.values(counts).reduce((sum,count)=>sum+count,0);
  return {counts,rosterCount,markedCount:rosterCount-counts.UNMARKED};
}
export function sessionDto(row:ClassroomSession,counts:AttendanceCounts){
  return {...row,scheduledStartAt:row.scheduledStartAt.toISOString(),startedAt:row.startedAt.toISOString(),finalizedAt:row.finalizedAt?.toISOString()??null,canceledAt:row.canceledAt?.toISOString()??null,lateAfter:row.lateAfter.toISOString(),createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),originalPolicySnapshot:policySnapshotSchema.parse(row.originalPolicySnapshot),counts};
}
export function attendanceDto(row:ClassroomAttendance){
  return {...row,markedAt:row.markedAt?.toISOString()??null,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
}
export function rosterMemberDto(row:Prisma.SessionRosterMemberGetPayload<{include:{attendance:true}}>){
  if(!row.attendance)throw new AuthError('This attendance snapshot is incomplete. Contact an administrator.',500,'INCOMPLETE_SESSION');
  return {sessionId:row.sessionId,studentId:row.studentId,studentSnapshot:studentSnapshotSchema.parse(row.studentSnapshot),originSnapshot:memberOriginSchema.parse(row.originSnapshot),originalMember:row.originalMember,included:row.included,admittedAt:row.admittedAt.toISOString(),removedAt:row.removedAt?.toISOString()??null,removalReason:row.removalReason,membershipRevision:row.membershipRevision,attendance:attendanceDto(row.attendance)};
}
