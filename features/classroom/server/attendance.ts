import 'server-only';
import type { Prisma,PrismaClient } from '@prisma/client';
import { AuthError } from '@/globals/utils/authError';
import { resolveStudentQrCode } from '@/globals/utils/studentIdentity';
import { takeRosterSharedLock,takeClassroomAttendancePairLock } from '@/globals/utils/pgLocks';
import { classroomScanSchema,manualAttendanceSchema } from '../schemas/attendanceSchema';
import { commandIdSchema } from '../schemas/commandId';
import { classifyClassroomArrival } from '../utils/attendancePolicy';
import { executeClassroomCommand } from './commands';
import { classroomRead,type ActorContext } from './access';
import { lockOwnedClass,requireAssistanceReason } from './classAccess';
import { eligibleResult,effectivePolicy,attendanceResult,writeClassroomResult,type LockedAttendanceSession } from './attendanceWrite';
import { lockOwnedSession,requireActiveSession,attendanceDto } from './sessionAccess';
async function notInSession(tx:Prisma.TransactionClient,locked:LockedAttendanceSession,studentId:string):Promise<never>{
  const student=await tx.student.findUnique({where:{id:studentId,archivedAt:null},include:{groups:true}});
  if(!student||student.groups.some(group=>group.slug==='employees'))throw new AuthError('Student not found.',404,'STUDENT_NOT_FOUND');
  const exception=await tx.classRosterException.findUnique({where:{classId_studentId:{classId:locked.offering.id,studentId}}});
  throw new AuthError('This student is not included in the session. Choose whether to include them.',409,'STUDENT_NOT_IN_SESSION',{
    student:{id:student.id,firstName:student.firstName,lastName:student.lastName,usn:student.usn,lrn:student.lrn,sections:student.groups.filter(group=>group.category==='SECTION').map(({id,name})=>({id,name}))},
    classException:exception?{kind:exception.kind,reason:exception.reason}:null,
    snapshotRevision:locked.session.snapshotRevision,rosterRevision:locked.offering.rosterRevision,
    choices:locked.offering.archivedAt?['SESSION']:['SESSION','CLASS_AND_SESSION','CLASS_ONLY'],
  });
}
export async function recordClassroomScan(db:PrismaClient,actor:ActorContext,raw:unknown){
  const input=classroomScanSchema.parse(raw);let locked!:LockedAttendanceSession;
  return executeClassroomCommand(db,actor,'APPROVED_CLASSROOM',{commandId:input.commandId,operation:'RECORD_CLASSROOM_SCAN',resourceId:input.sessionId,payload:input},async(tx,user)=>{
    requireAssistanceReason(user,locked.offering,input.reason);
    requireActiveSession(locked.session);
    const studentId=await resolveStudentQrCode(tx,input.code);
    if(!studentId)throw new AuthError('This QR code is not recognized. Search the student directory or use manual attendance.',404,'UNKNOWN_QR');
    await takeClassroomAttendancePairLock(tx,input.sessionId,studentId);
    const member=await tx.sessionRosterMember.findUnique({where:{sessionId_studentId:{sessionId:input.sessionId,studentId}},include:{attendance:true}});
    if(!member?.included)return notInSession(tx,locked,studentId);
    const row=member.attendance;if(!row)throw new AuthError('The attendance snapshot is incomplete.',500,'INCOMPLETE_SESSION');
    if(row.status!=='UNMARKED')return attendanceResult(row,row.status==='PRESENT'||row.status==='LATE'?'ALREADY_RECORDED':'ALREADY_MARKED',false,member.studentSnapshot);
    const now=new Date();const next=await writeClassroomResult(tx,user,locked,row,{status:classifyClassroomArrival(effectivePolicy(locked),now),method:'SCANNED',excuseNote:null,reason:input.reason,commandId:input.commandId},now);
    return attendanceResult(next,'RECORDED',true,member.studentSnapshot);
  },{authorizeResource:async(tx,user)=>{await takeRosterSharedLock(tx);locked=await lockOwnedSession(tx,input.sessionId,user,'SHARE');}});
}
export async function setClassroomAttendance(db:PrismaClient,actor:ActorContext,raw:unknown){
  const input=manualAttendanceSchema.parse(raw);let locked!:LockedAttendanceSession;
  return executeClassroomCommand(db,actor,'APPROVED_CLASSROOM',{commandId:input.commandId,operation:'SET_CLASSROOM_ATTENDANCE',resourceId:input.sessionId,payload:input},async(tx,user)=>{
    requireAssistanceReason(user,locked.offering,input.reason);
    if(locked.session.state==='CANCELED')throw new AuthError('This session is canceled.',409,'SESSION_CANCELED');
    await takeClassroomAttendancePairLock(tx,input.sessionId,input.studentId);
    const {attendance:row,studentSnapshot}=await eligibleResult(tx,input.sessionId,input.studentId);
    if(row.revision!==input.expectedRevision)throw new AuthError('Another device updated this attendance. Review the current result before correcting it.',409,'ATTENDANCE_CHANGED',{current:attendanceDto(row)});
    if((row.status!=='UNMARKED'||locked.session.state==='FINALIZED')&&!input.reason)throw new AuthError('Enter a reason for this attendance correction.',400,'REASON_REQUIRED');
    const excuseNote=input.status==='EXCUSED'?input.excuseNote||null:null;
    if(row.status===input.status&&row.excuseNote===excuseNote)return attendanceResult(row,'UNCHANGED',false,studentSnapshot);
    const next=await writeClassroomResult(tx,user,locked,row,{status:input.status,method:'MANUAL',excuseNote,reason:input.reason,commandId:input.commandId},new Date());
    return attendanceResult(next,'RECORDED',true,studentSnapshot);
  },{authorizeResource:async(tx,user)=>{locked=await lockOwnedSession(tx,input.sessionId,user,'SHARE');}});
}
const SESSION_RECEIPT_OPERATIONS=new Set(['RECORD_CLASSROOM_SCAN','SET_CLASSROOM_ATTENDANCE','ADJUST_SESSION_ROSTER','FINALIZE_CLASSROOM_SESSION','CANCEL_CLASSROOM_SESSION','AMEND_CLASSROOM_POLICY']);
/** Receipt absence is only an observation; an in-flight command may still commit. */
export async function readAttendanceCommand(db:PrismaClient,actor:ActorContext,rawCommandId:string){
  const commandId=commandIdSchema.parse(rawCommandId);
  return classroomRead(db,actor,async(tx,user)=>{
    const receipt=await tx.classroomCommandReceipt.findUnique({where:{actorId_commandId:{actorId:user.id,commandId}}});
    if(!receipt)throw new AuthError('No committed attendance command was found at this time. Retry the same command to settle an uncertain save.',404,'COMMAND_NOT_FOUND');
    if(SESSION_RECEIPT_OPERATIONS.has(receipt.operation))await lockOwnedSession(tx,receipt.resourceId,user,'SHARE');
    else if(receipt.operation==='START_CLASSROOM_SESSION')await lockOwnedClass(tx,receipt.resourceId,user,'SHARE');
    else throw new AuthError('Use the original operation to recover this command.',404,'COMMAND_NOT_FOUND');
    return {commandId:receipt.commandId,operation:receipt.operation,resourceId:receipt.resourceId,httpStatus:receipt.httpStatus,result:receipt.result,createdAt:receipt.createdAt.toISOString()};
  });
}

export { adjustSessionRoster } from './sessionRosterAdjustments';
