import 'server-only';
import type { Prisma,PrismaClient } from '@prisma/client';
import { AuthError } from '@/globals/utils/authError';
import { takeRosterSharedLock } from '@/globals/utils/pgLocks';
import { classroomRead,type ActorContext,type ClassroomUser } from './access';
import { lockOwnedClass,classDto,requireAssistanceReason,type ClassRow } from './classAccess';
import { composeClassRoster,rosterConfig } from './rosters';
import { fingerprintClassRoster } from '../utils/composeRoster';
import { buildAttendancePolicy,suggestClassroomStart,validateSessionStart } from '../utils/attendancePolicy';
import { scheduleSchema } from '../schemas/classSchema';
import { startSessionSchema,finalizeSessionSchema,cancelSessionSchema,amendPolicySchema,sessionRosterQuerySchema,sessionListQuerySchema } from '../schemas/sessionSchema';
import { executeClassroomCommand,commandHash } from './commands';
import { lockOwnedSession,requireActiveSession,requireLifecycleRevision,sessionDto,sessionCounts,sessionCountsForIds,attendanceProgress,emptyAttendanceCounts,rosterMemberDto,attendanceDto } from './sessionAccess';
const MAX_SESSION_ROSTER=1000;
/** Start-only policy: caller holds enabled/approved actor and roster SHARE locks. Catalog locks precede the Class lock. */
async function loadStartClass(tx:Prisma.TransactionClient,classId:string,user:ClassroomUser,mode:'SHARE'|'UPDATE'){
  if(user.role==='ADMIN')throw new AuthError('Only an approved teacher can start their own classroom meeting.',403,'TEACHER_START_REQUIRED');
  const reference=await tx.classOffering.findFirst({where:{id:classId,primaryTeacherId:user.id},select:{termId:true,subjectId:true}});
  if(!reference)throw new AuthError('Class not found.',404,'CLASS_NOT_FOUND');
  await tx.$queryRaw`SELECT id FROM "AcademicTerm" WHERE id=${reference.termId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Subject" WHERE id=${reference.subjectId} FOR SHARE`;
  const row=await lockOwnedClass(tx,classId,user,mode);
  if(row.termId!==reference.termId||row.subjectId!==reference.subjectId)throw new AuthError('Class configuration changed. Reload the start preview.',409,'CLASS_CONFIG_CHANGED');
  return row;
}
export async function getClassroomStartPreview(db:PrismaClient,actor:ActorContext,classId:string){
  return classroomRead(db,actor,async(tx,user)=>{
    const row=await loadStartClass(tx,classId,user,'SHARE');const roster=await composeClassRoster(tx,classId);const now=new Date();
    return {class:classDto(row),configRevision:row.configRevision,rosterRevision:row.rosterRevision,rosterFingerprint:fingerprintClassRoster(roster,rosterConfig(row)),rosterCount:roster.length,serverNow:now.toISOString(),suggestedStartAt:suggestClassroomStart(row.schedule?scheduleSchema.parse(row.schedule):null,now),activeSessionId:(await tx.classroomSession.findFirst({where:{classId,state:'ACTIVE'},select:{id:true}}))?.id??null};
  },{roster:true});
}
export async function startClassroomSession(db:PrismaClient,actor:ActorContext,classId:string,raw:unknown){
  const input=startSessionSchema.parse(raw);let offering!:ClassRow;
  return executeClassroomCommand(db,actor,'APPROVED_CLASSROOM',{commandId:input.commandId,operation:'START_CLASSROOM_SESSION',resourceId:classId,payload:input},async(tx,user)=>{
    requireAssistanceReason(user,offering,input.reason);
    if(offering.archivedAt)throw new AuthError('Unarchive the class before starting a meeting.',409,'CLASS_ARCHIVED');
    const active=await tx.classroomSession.findFirst({where:{classId,state:'ACTIVE'},select:{id:true}});
    if(active)throw new AuthError('A meeting is already active. Continue that session.',409,'ACTIVE_SESSION_EXISTS',{sessionId:active.id});
    if(offering.configRevision!==input.expectedConfigRevision)throw new AuthError('Class settings changed. Reload the start preview.',409,'CLASS_CONFIG_CHANGED');
    const roster=await composeClassRoster(tx,classId);const config=rosterConfig(offering);const fingerprint=fingerprintClassRoster(roster,config);
    if(offering.rosterRevision!==input.expectedRosterRevision||fingerprint!==input.expectedRosterFingerprint)throw new AuthError('The class roster changed. Reload and review it before starting.',409,'ROSTER_CHANGED');
    if(!roster.length)throw new AuthError('Include at least one existing student before starting attendance.',409,'EMPTY_ROSTER');
    if(roster.length>MAX_SESSION_ROSTER)throw new AuthError('This class exceeds the supported 1,000-student meeting limit. Split it into separate class offerings.',422,'CAPACITY_LIMIT');
    const now=new Date();const policy=buildAttendancePolicy(input.scheduledStartAt,offering.graceMinutes);const details=classDto(offering);
    validateSessionStart(policy,details.term,now);
    const classSnapshot={v:1,id:classId,displayName:details.displayName,term:details.term,subject:details.subject,primaryTeacher:details.primaryTeacher,sections:details.sections};
    const session=await tx.classroomSession.create({data:{classId,scheduledStartAt:new Date(policy.scheduledStartAt),startedAt:now,graceMinutes:policy.graceMinutes,lateAfter:new Date(policy.lateAfter),originalPolicySnapshot:policy,classSnapshot,rosterConfigSnapshot:{v:1,...config,configRevision:offering.configRevision,rosterFingerprint:fingerprint,count:roster.length},startedById:user.id,startedByName:user.name}});
    // Bounded batched inserts, no per-student queries and no partial materialization.
    for(let offset=0;offset<roster.length;offset+=250){
      const batch=roster.slice(offset,offset+250);
      await tx.sessionRosterMember.createMany({data:batch.map(member=>({sessionId:session.id,studentId:member.studentId,studentSnapshot:member.studentSnapshot,originSnapshot:member.originSnapshot,admittedAt:now}))});
      await tx.classroomAttendance.createMany({data:batch.map(member=>({sessionId:session.id,studentId:member.studentId}))});
    }
    const counts=emptyAttendanceCounts();counts.UNMARKED=roster.length;const result=sessionDto(session,counts);
    await tx.classroomAudit.create({data:{action:'CLASSROOM_SESSION_STARTED',entityType:'ClassroomSession',entityId:session.id,classId,sessionId:session.id,actorId:user.id,actorName:user.name,commandId:input.commandId,reason:input.reason,after:result}});
    return result;
  },{httpStatus:201,timeout:10000,maxWait:2000,authorizeResource:async(tx,user)=>{await takeRosterSharedLock(tx);offering=await loadStartClass(tx,classId,user,'UPDATE');}});
}
export async function getClassroomSession(db:PrismaClient,actor:ActorContext,sessionId:string){
  return classroomRead(db,actor,async(tx,user)=>{const {session,offering}=await lockOwnedSession(tx,sessionId,user,'SHARE');const completed=await tx.classroomSession.findFirst({where:{state:'FINALIZED',class:{primaryTeacherId:user.id}},select:{id:true}});return {...sessionDto(session,await sessionCounts(tx,sessionId)),currentPrimaryTeacherId:offering.primaryTeacherId,showFirstAttendanceGuidance:!completed&&session.state==='ACTIVE'&&session.classSnapshot!==null};});
}
export async function listClassroomSessions(db:PrismaClient,actor:ActorContext,classId:string,raw=new URLSearchParams()){
  const input=sessionListQuerySchema.parse(Object.fromEntries(raw));
  return classroomRead(db,actor,async(tx,user)=>{
    await lockOwnedClass(tx,classId,user,'SHARE');
    const where:Prisma.ClassroomSessionWhereInput={classId,...(input.state?{state:input.state}:{}),...(input.date?{scheduledStartAt:{gte:new Date(input.date+'T00:00:00+08:00'),lt:new Date(new Date(input.date+'T00:00:00+08:00').getTime()+86400000)}}:{})};
    const rows=await tx.classroomSession.findMany({where,orderBy:[{scheduledStartAt:'desc'},{id:'desc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize});
    const counts=await sessionCountsForIds(tx,rows.map(row=>row.id));
    return {items:rows.map(row=>({...attendanceProgress(counts.get(row.id)!),id:row.id,classId,state:row.state,scheduledStartAt:row.scheduledStartAt.toISOString(),startedAt:row.startedAt.toISOString(),finalizedAt:row.finalizedAt?.toISOString()??null,canceledAt:row.canceledAt?.toISOString()??null,lifecycleRevision:row.lifecycleRevision,snapshotRevision:row.snapshotRevision})),total:await tx.classroomSession.count({where}),page:input.page,pageSize:input.pageSize};
  });
}
export async function getSessionRoster(db:PrismaClient,actor:ActorContext,sessionId:string,raw=new URLSearchParams()){
  const input=sessionRosterQuerySchema.parse(Object.fromEntries(raw));
  return classroomRead(db,actor,async(tx,user)=>{
    const {session}=await lockOwnedSession(tx,sessionId,user,'SHARE');
    // Eligibility/identity are frozen under Session SHARE. The single attendance
    // relation query gives one result snapshot for filtering, totals and rows.
    const members=(await tx.sessionRosterMember.findMany({where:{sessionId},include:{attendance:true}})).map(rosterMemberDto);
    members.sort((a,b)=>a.studentSnapshot.lastName.localeCompare(b.studentSnapshot.lastName)||a.studentSnapshot.firstName.localeCompare(b.studentSnapshot.firstName)||(a.studentId<b.studentId?-1:a.studentId>b.studentId?1:0));
    const eligible=members.filter(row=>row.included);const counts=emptyAttendanceCounts();for(const row of eligible)counts[row.attendance.status]++;
    const q=input.q.toLocaleLowerCase('en');const filtered=members.filter(row=>(input.includeExcluded||row.included)&&(!input.status||row.attendance.status===input.status)&&(!q||[row.studentSnapshot.firstName,row.studentSnapshot.lastName,row.studentSnapshot.usn,row.studentSnapshot.lrn,row.studentId].some(value=>value?.toLocaleLowerCase('en').includes(q))));
    return {sessionId,state:session.state,lifecycleRevision:session.lifecycleRevision,snapshotRevision:session.snapshotRevision,items:filtered.slice((input.page-1)*input.pageSize,input.page*input.pageSize),counts,total:eligible.length,excludedCount:members.length-eligible.length,filteredCount:filtered.length,page:input.page,pageSize:input.pageSize,pageCount:Math.max(1,Math.ceil(filtered.length/input.pageSize))};
  });
}
export async function finalizeClassroomSession(db:PrismaClient,actor:ActorContext,sessionId:string,raw:unknown){
  const input=finalizeSessionSchema.parse(raw);let locked!:Awaited<ReturnType<typeof lockOwnedSession>>;
  return executeClassroomCommand(db,actor,'APPROVED_CLASSROOM',{commandId:input.commandId,operation:'FINALIZE_CLASSROOM_SESSION',resourceId:sessionId,payload:input},async(tx,user)=>{
    const {session,offering}=locked;requireAssistanceReason(user,offering,input.reason);requireActiveSession(session);requireLifecycleRevision(session,input.expectedLifecycleRevision);
    if(session.snapshotRevision!==input.expectedSnapshotRevision)throw new AuthError('Session eligibility changed. Review the current roster before finalizing.',409,'SESSION_ROSTER_CHANGED');
    const unmarked=await tx.classroomAttendance.findMany({where:{sessionId,status:'UNMARKED',member:{included:true}},orderBy:{studentId:'asc'}});const now=new Date();
    const update={status:'ABSENT' as const,method:'FINALIZATION' as const,markedAt:now,recordedById:user.id,recordedByName:user.name,lastModifiedById:user.id,lastModifiedByName:user.name,updatedAt:now};
    const changed=await tx.classroomAttendance.updateMany({where:{sessionId,status:'UNMARKED',member:{included:true}},data:{...update,revision:{increment:1}}});
    if(changed.count!==unmarked.length)throw new AuthError('Attendance changed unexpectedly. Reload and retry finalization.',409,'REVISION_CONFLICT');
    for(let offset=0;offset<unmarked.length;offset+=250)await tx.classroomAttendanceChange.createMany({data:unmarked.slice(offset,offset+250).map(row=>({sessionId,studentId:row.studentId,action:'FINALIZE_ABSENT',before:attendanceDto(row),after:attendanceDto({...row,...update,revision:row.revision+1}),actorId:user.id,actorName:user.name,commandId:input.commandId,reason:input.reason}))});
    const finalized=await tx.classroomSession.update({where:{id:sessionId},data:{state:'FINALIZED',finalizedAt:now,finalizedById:user.id,finalizedByName:user.name,lifecycleRevision:{increment:1}}});
    const result={...sessionDto(finalized,await sessionCounts(tx,sessionId)),defaultedAbsent:changed.count};
    await tx.classroomAudit.create({data:{action:'CLASSROOM_SESSION_FINALIZED',entityType:'ClassroomSession',entityId:sessionId,classId:session.classId,sessionId,actorId:user.id,actorName:user.name,commandId:input.commandId,reason:input.reason,before:{state:session.state,lifecycleRevision:session.lifecycleRevision},after:result}});return result;
  },{timeout:10000,maxWait:2000,authorizeResource:async(tx,user)=>{locked=await lockOwnedSession(tx,sessionId,user,'UPDATE');}});
}
export async function cancelClassroomSession(db:PrismaClient,actor:ActorContext,sessionId:string,raw:unknown){
  const input=cancelSessionSchema.parse(raw);let locked!:Awaited<ReturnType<typeof lockOwnedSession>>;
  return executeClassroomCommand(db,actor,'APPROVED_CLASSROOM',{commandId:input.commandId,operation:'CANCEL_CLASSROOM_SESSION',resourceId:sessionId,payload:input},async(tx,user)=>{
    const {session}=locked;requireLifecycleRevision(session,input.expectedLifecycleRevision);
    if(session.state==='CANCELED')return {...sessionDto(session,await sessionCounts(tx,sessionId)),changed:false};
    const canceled=await tx.classroomSession.update({where:{id:sessionId},data:{state:'CANCELED',canceledAt:new Date(),canceledById:user.id,canceledByName:user.name,cancellationReason:input.reason,lifecycleRevision:{increment:1}}});
    const result={...sessionDto(canceled,await sessionCounts(tx,sessionId)),changed:true};
    await tx.classroomAudit.create({data:{action:'CLASSROOM_SESSION_CANCELED',entityType:'ClassroomSession',entityId:sessionId,classId:session.classId,sessionId,actorId:user.id,actorName:user.name,commandId:input.commandId,reason:input.reason,before:{state:session.state,lifecycleRevision:session.lifecycleRevision},after:result}});return result;
  },{authorizeResource:async(tx,user)=>{locked=await lockOwnedSession(tx,sessionId,user,'UPDATE');}});
}
export async function amendSessionPolicy(db:PrismaClient,actor:ActorContext,sessionId:string,raw:unknown){
  const input=amendPolicySchema.parse(raw);let locked!:Awaited<ReturnType<typeof lockOwnedSession>>;
  return executeClassroomCommand(db,actor,'APPROVED_CLASSROOM',{commandId:input.commandId,operation:'AMEND_CLASSROOM_POLICY',resourceId:sessionId,payload:input},async(tx,user)=>{
    const {session}=locked;requireActiveSession(session);requireLifecycleRevision(session,input.expectedLifecycleRevision);
    const policy=buildAttendancePolicy(input.startAt,input.graceMinutes);
    const frozen=session.classSnapshot as {term?:{startDate:string;endDate:string}};
    if(!frozen.term)throw new AuthError('Session term snapshot is unavailable.',500,'INCOMPLETE_SESSION');
    validateSessionStart(policy,frozen.term,new Date());
    const before=buildAttendancePolicy(session.scheduledStartAt.toISOString(),session.graceMinutes);
    if(commandHash(before)===commandHash(policy))return {...sessionDto(session,await sessionCounts(tx,sessionId)),changed:false};
    const amended=await tx.classroomSession.update({where:{id:sessionId},data:{scheduledStartAt:new Date(policy.scheduledStartAt),graceMinutes:policy.graceMinutes,lateAfter:new Date(policy.lateAfter),lifecycleRevision:{increment:1}}});
    await tx.classroomAudit.create({data:{action:'CLASSROOM_SESSION_POLICY_AMENDED',entityType:'ClassroomSession',entityId:sessionId,classId:session.classId,sessionId,actorId:user.id,actorName:user.name,commandId:input.commandId,reason:input.reason,before,after:policy}});
    return {...sessionDto(amended,await sessionCounts(tx,sessionId)),changed:true};
  },{authorizeResource:async(tx,user)=>{locked=await lockOwnedSession(tx,sessionId,user,'UPDATE');}});
}
