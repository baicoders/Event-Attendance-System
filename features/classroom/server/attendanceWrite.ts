import 'server-only';
import type { Prisma,ClassroomAttendance,ClassroomAttendanceStatus,ClassroomAttendanceMethod } from '@prisma/client';
import { AuthError } from '@/globals/utils/authError';
import type { ClassroomUser } from './access';
import { lockOwnedSession,attendanceDto } from './sessionAccess';
import { attendanceStudentDisplaySchema } from '../schemas/attendanceSchema';
import { buildAttendancePolicy } from '../utils/attendancePolicy';
export type LockedAttendanceSession=Awaited<ReturnType<typeof lockOwnedSession>>;
export async function eligibleResult(tx:Prisma.TransactionClient,sessionId:string,studentId:string){
  const member=await tx.sessionRosterMember.findUnique({where:{sessionId_studentId:{sessionId,studentId}},include:{attendance:true}});
  if(!member?.included)throw new AuthError('This student is not included in this session.',409,'STUDENT_NOT_IN_SESSION');
  if(!member.attendance)throw new AuthError('The attendance snapshot is incomplete.',500,'INCOMPLETE_SESSION');
  return {attendance:member.attendance,studentSnapshot:member.studentSnapshot};
}
export function effectivePolicy(locked:LockedAttendanceSession){
  return {...buildAttendancePolicy(locked.session.scheduledStartAt.toISOString(),locked.session.graceMinutes),lifecycleRevision:locked.session.lifecycleRevision};
}
export function attendanceResult(row:ClassroomAttendance,outcome:'RECORDED'|'ALREADY_RECORDED'|'ALREADY_MARKED'|'UNCHANGED',changed:boolean,studentSnapshot:Prisma.JsonValue){
  const student=attendanceStudentDisplaySchema.parse(studentSnapshot);
  if(student.id!==row.studentId)throw new AuthError('The attendance identity snapshot is inconsistent.',500,'INCOMPLETE_SESSION');
  return {outcome,sessionId:row.sessionId,studentId:row.studentId,student,attendance:attendanceDto(row),changed};
}
/** Caller owns Session SHARE/UPDATE and this result's pair lock. */
export async function writeClassroomResult(tx:Prisma.TransactionClient,user:ClassroomUser,locked:LockedAttendanceSession,row:ClassroomAttendance,input:{status:Exclude<ClassroomAttendanceStatus,'UNMARKED'>;method:ClassroomAttendanceMethod;excuseNote:string|null;reason?:string;commandId:string},at:Date){
  const next:ClassroomAttendance={...row,status:input.status,method:input.method,excuseNote:input.excuseNote,markedAt:at,recordedById:row.recordedById??user.id,recordedByName:row.recordedByName??user.name,lastModifiedById:user.id,lastModifiedByName:user.name,revision:row.revision+1,updatedAt:at};
  const changed=await tx.classroomAttendance.updateMany({where:{sessionId:row.sessionId,studentId:row.studentId,revision:row.revision},data:{status:next.status,method:next.method,excuseNote:next.excuseNote,markedAt:at,recordedById:next.recordedById,recordedByName:next.recordedByName,lastModifiedById:user.id,lastModifiedByName:user.name,revision:{increment:1},updatedAt:at}});
  if(changed.count!==1)throw new AuthError('Attendance changed. Reload the current result before correcting it.',409,'ATTENDANCE_CHANGED');
  await tx.classroomAttendanceChange.create({data:{sessionId:row.sessionId,studentId:row.studentId,action:row.status==='UNMARKED'?'MARK':'CORRECT',before:attendanceDto(row),after:{...attendanceDto(next),appliedPolicy:effectivePolicy(locked)},actorId:user.id,actorName:user.name,reason:input.reason,commandId:input.commandId}});
  return next;
}
