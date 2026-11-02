import 'server-only';
import type { Prisma,PrismaClient } from '@prisma/client';
import { AuthError } from '@/globals/utils/authError';
import { takeRosterSharedLock,takeClassroomAttendancePairLock } from '@/globals/utils/pgLocks';
import { resolveStudentQrCode } from '@/globals/utils/studentIdentity';
import { rosterAdjustmentSchema } from '../schemas/attendanceSchema';
import { composeRosterFromStudents } from '../utils/composeRoster';
import { classifyClassroomArrival } from '../utils/attendancePolicy';
import { executeClassroomCommand } from './commands';
import type { ActorContext } from './access';
import { lockOwnedSession,rosterMemberDto,attendanceDto } from './sessionAccess';
import { effectivePolicy,attendanceResult,writeClassroomResult,type LockedAttendanceSession } from './attendanceWrite';
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export async function adjustSessionRoster(db:PrismaClient,actor:ActorContext,raw:unknown){
  const input=rosterAdjustmentSchema.parse(raw);let locked!:LockedAttendanceSession;
  const changesClass=input.scope!=='SESSION';const changesSession=input.scope!=='CLASS_ONLY';
  return executeClassroomCommand(db,actor,'APPROVED_CLASSROOM',{commandId:input.commandId,operation:'ADJUST_SESSION_ROSTER',resourceId:input.sessionId,payload:input},async(tx,user)=>{
    const {session,offering}=locked;
    if(session.state==='CANCELED')throw new AuthError('This session is canceled. Manage future enrollment from the class roster.',409,'SESSION_CANCELED');
    if(session.snapshotRevision!==input.expectedSnapshotRevision)throw new AuthError('Session enrollment changed. Reload the current roster before confirming this choice.',409,'SESSION_ROSTER_CHANGED');
    if(changesClass&&offering.archivedAt)throw new AuthError('Unarchive this class before changing future enrollment.',409,'CLASS_ARCHIVED');
    if(changesClass&&offering.rosterRevision!==input.expectedRosterRevision)throw new AuthError('The permanent class roster changed. Review it before confirming this choice.',409,'ROSTER_REVISION_CHANGED');
    if(changesSession&&session.state==='FINALIZED'&&input.action==='INCLUDE'&&!input.finalStatus)throw new AuthError('Choose the historical attendance outcome when including a student in a finalized meeting.',400,'FINAL_STATUS_REQUIRED');
    if(changesSession&&session.state==='FINALIZED'&&input.recordScan)throw new AuthError('A finalized meeting requires an explicit historical attendance outcome.',400,'FINAL_STATUS_REQUIRED');
    if(session.state==='ACTIVE'&&input.finalStatus)throw new AuthError('Use manual attendance to mark an active meeting.',400,'INVALID_ROSTER_ACTION');
    await takeClassroomAttendancePairLock(tx,input.sessionId,input.studentId);
    let member=await tx.sessionRosterMember.findUnique({where:{sessionId_studentId:{sessionId:input.sessionId,studentId:input.studentId}},include:{attendance:true}});
    if(changesSession&&input.action==='EXCLUDE'&&!member)throw new AuthError('This student has no enrollment in this session.',409,'STUDENT_NOT_IN_SESSION');
    if(changesSession&&input.finalStatus&&member?.included)throw new AuthError('Use the attendance correction action for a student already included in this meeting.',400,'USE_ATTENDANCE_CORRECTION');
    if(changesSession&&input.finalStatus&&member?.attendance&&input.expectedAttendanceRevision!==member.attendance.revision)throw new AuthError('This historical attendance changed. Review it before re-including the student.',409,'ATTENDANCE_CHANGED',{current:attendanceDto(member.attendance)});
    const student=await tx.student.findUnique({where:{id:input.studentId},include:{groups:true}});
    if(!student||((student.archivedAt||student.groups.some(group=>group.slug==='employees'))&&(input.action==='INCLUDE'||!member)))throw new AuthError('Choose an existing active student record.',404,'STUDENT_NOT_FOUND');
    if(input.recordScan){
      const resolved=await resolveStudentQrCode(tx,input.code!);
      if(!resolved)throw new AuthError('This QR code is not recognized.',404,'UNKNOWN_QR');
      if(resolved!==input.studentId)throw new AuthError('The QR code does not belong to the selected student.',409,'IDENTITY_MISMATCH');
    }
    if(changesSession&&!member&&input.action==='INCLUDE'&&await tx.sessionRosterMember.count({where:{sessionId:session.id}})>=1000)throw new AuthError('This session already retains 1,000 student memberships. Use a separate meeting instead.',422,'CAPACITY_LIMIT');
    const previousException=changesClass?await tx.classRosterException.findUnique({where:{classId_studentId:{classId:offering.id,studentId:input.studentId}}}):null;
    if(changesClass&&input.action==='INCLUDE'&&previousException?.kind==='EXCLUDE'&&!input.confirmReplaceExclusion)throw new AuthError('Confirm replacing this student’s permanent class exclusion.',409,'EXCLUSION_CONFIRMATION_REQUIRED');
    const classChanged=changesClass&&(previousException?.kind!==input.action||previousException?.reason!==input.reason);
    let rosterRevision=offering.rosterRevision;
    if(classChanged){
      await tx.classRosterException.upsert({where:{classId_studentId:{classId:offering.id,studentId:input.studentId}},create:{classId:offering.id,studentId:input.studentId,kind:input.action,reason:input.reason,createdById:user.id,updatedById:user.id},update:{kind:input.action,reason:input.reason,updatedById:user.id}});
      rosterRevision=(await tx.classOffering.update({where:{id:offering.id},data:{rosterRevision:{increment:1}}})).rosterRevision;
      await tx.classroomAudit.create({data:{action:'CLASS_ROSTER_EXCEPTION_UPDATED',entityType:'ClassOffering',entityId:offering.id,classId:offering.id,sessionId:session.id,studentId:input.studentId,actorId:user.id,actorName:user.name,reason:input.reason,commandId:input.commandId,before:{rosterRevision:offering.rosterRevision,exception:previousException?{studentId:input.studentId,kind:previousException.kind,reason:previousException.reason}:null},after:{rosterRevision,exception:{studentId:input.studentId,kind:input.action,reason:input.reason}}}});
    }
    const beforeMember=member?rosterMemberDto(member):null;const now=new Date();let sessionChanged=false;
    if(changesSession){
      if(!member){
        const config=session.rosterConfigSnapshot as {sectionIds?:string[]};
        const projection=composeRosterFromStudents([student],config.sectionIds??[],[{studentId:student.id,kind:'INCLUDE',reason:input.reason}])[0];
        if(!projection)throw new AuthError('This student cannot be included in attendance.',409,'STUDENT_NOT_ELIGIBLE');
        await tx.sessionRosterMember.create({data:{sessionId:session.id,studentId:student.id,studentSnapshot:projection.studentSnapshot,originSnapshot:{...projection.originSnapshot,admissionScope:input.scope,admissionReason:input.reason,admittedById:user.id,admittedByName:user.name},originalMember:false,admittedAt:now}});
        await tx.classroomAttendance.create({data:{sessionId:session.id,studentId:student.id}});sessionChanged=true;
      }else if(member.included!==(input.action==='INCLUDE')||(!member.included&&input.action==='EXCLUDE'&&member.removalReason!==input.reason)){
        await tx.sessionRosterMember.update({where:{sessionId_studentId:{sessionId:session.id,studentId:student.id}},data:{included:input.action==='INCLUDE',removedAt:input.action==='INCLUDE'?null:now,removalReason:input.action==='INCLUDE'?null:input.reason,membershipRevision:{increment:1}}});sessionChanged=true;
      }
      member=await tx.sessionRosterMember.findUniqueOrThrow({where:{sessionId_studentId:{sessionId:session.id,studentId:student.id}},include:{attendance:true}});
    }
    let mark:ReturnType<typeof attendanceResult>|null=null;
    if(changesSession&&input.action==='INCLUDE'){
      const row=member?.attendance;if(!row)throw new AuthError('The session attendance snapshot is incomplete.',500,'INCOMPLETE_SESSION');
      if(input.finalStatus){
        const next=await writeClassroomResult(tx,user,locked,row,{status:input.finalStatus,method:'MANUAL',excuseNote:input.finalStatus==='EXCUSED'?input.excuseNote||null:null,reason:input.reason,commandId:input.commandId},new Date());
        mark=attendanceResult(next,'RECORDED',true);
      }else if(input.recordScan){
        if(row.status==='UNMARKED'){
          const at=new Date();const next=await writeClassroomResult(tx,user,locked,row,{status:classifyClassroomArrival(effectivePolicy(locked),at),method:'SCANNED',excuseNote:null,reason:input.reason,commandId:input.commandId},at);mark=attendanceResult(next,'RECORDED',true);
        }else mark=attendanceResult(row,row.status==='PRESENT'||row.status==='LATE'?'ALREADY_RECORDED':'ALREADY_MARKED',false);
      }
    }
    let snapshotRevision=session.snapshotRevision;
    if(sessionChanged){
      snapshotRevision=(await tx.classroomSession.update({where:{id:session.id},data:{snapshotRevision:{increment:1}}})).snapshotRevision;
      const afterMember=await tx.sessionRosterMember.findUniqueOrThrow({where:{sessionId_studentId:{sessionId:session.id,studentId:student.id}},include:{attendance:true}});
      await tx.classroomAudit.create({data:{action:'SESSION_ROSTER_ADJUSTED',entityType:'SessionRosterMember',entityId:session.id+':'+student.id,classId:offering.id,sessionId:session.id,studentId:student.id,actorId:user.id,actorName:user.name,reason:input.reason,commandId:input.commandId,before:json({snapshotRevision:session.snapshotRevision,member:beforeMember}),after:json({snapshotRevision,member:rosterMemberDto(afterMember),scope:input.scope})}});
      member=afterMember;
    }
    if(mark?.changed&&!sessionChanged)member=await tx.sessionRosterMember.findUniqueOrThrow({where:{sessionId_studentId:{sessionId:session.id,studentId:student.id}},include:{attendance:true}});
    const currentMember=changesSession&&member?rosterMemberDto(member):null;
    return {sessionId:session.id,studentId:student.id,scope:input.scope,action:input.action,snapshotRevision,rosterRevision,changed:classChanged||sessionChanged||!!mark?.changed,member:currentMember,attendance:currentMember?.attendance??null,outcome:mark?.outcome??null};
  },{timeout:10000,maxWait:2000,authorizeResource:async(tx,user)=>{await takeRosterSharedLock(tx);locked=await lockOwnedSession(tx,input.sessionId,user,'UPDATE',changesClass?'UPDATE':'SHARE');}});
}
