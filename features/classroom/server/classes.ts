import 'server-only';
import { Prisma,type PrismaClient } from '@prisma/client';
import { AuthError } from '@/globals/utils/authError';
import { takeRosterSharedLock } from '@/globals/utils/pgLocks';
import { classSchema,classPatchSchema,classQuerySchema,ownerSchema } from '../schemas/classSchema';
import { executeClassroomCommand,commandHash } from './commands';
import { classroomRead,classroomAdministrator,type ActorContext } from './access';
import { classInclude,classDto,lockOwnedClass,lockSectionRows,validateRosterSelections,requireAssistanceReason,type ClassRow } from './classAccess';
import { replaceRosterConfiguration } from './rosters';
import { lockTeacherOnboarding,validateFirstClassCreation,linkCreatedFirstClass } from './onboarding';
async function approvedOwner(tx:Prisma.TransactionClient,userId:string){
 const user=await tx.user.findUnique({where:{id:userId},select:{id:true,accountState:true,classroomMembership:{select:{status:true}}}});
 if(!user||user.accountState!=='ENABLED'||user.classroomMembership?.status!=='APPROVED')throw new AuthError('Choose an approved teacher with enabled access.',409,'TEACHER_NOT_APPROVED');
 return user;
}
export async function createClassOffering(db:PrismaClient,actor:ActorContext,raw:unknown){
 const input=classSchema.parse(raw);const teacherId=input.primaryTeacherId??actor.userId;
 return executeClassroomCommand(db,actor,'APPROVED_CLASSROOM',{commandId:input.commandId,operation:'CREATE_CLASS',resourceId:'classes',payload:input},async(tx,user)=>{
  if(input.primaryTeacherId&&!classroomAdministrator(user))throw new AuthError('Only an administrator can assign another owner.',403,'FORBIDDEN');
  requireAssistanceReason(user,{primaryTeacherId:teacherId},input.reason);
  await approvedOwner(tx,teacherId);
  if(input.onboardingExpectedRevision!==undefined&&teacherId!==user.id)throw new AuthError('First-run setup belongs to your own classes.',403,'FORBIDDEN');
  const onboarding=input.onboardingExpectedRevision===undefined?null:await lockTeacherOnboarding(tx,user.id);
  await takeRosterSharedLock(tx);
  if(input.onboardingExpectedRevision!==undefined)await validateFirstClassCreation(tx,user.id,onboarding,input.onboardingExpectedRevision);
  await tx.$queryRaw`SELECT id FROM "AcademicTerm" WHERE id=${input.termId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Subject" WHERE id=${input.subjectId} FOR SHARE`;
  const term=await tx.academicTerm.findUnique({where:{id:input.termId}});const subject=await tx.subject.findUnique({where:{id:input.subjectId}});
  if(!term||term.archivedAt)throw new AuthError('Choose an available academic term.',409,'TERM_UNAVAILABLE');
  if(!subject||subject.archivedAt)throw new AuthError('Choose an available subject.',409,'SUBJECT_UNAVAILABLE');
  await lockSectionRows(tx,input.sectionIds);await validateRosterSelections(tx,input.sectionIds,input.exceptions);
  const created=await tx.classOffering.create({data:{termId:term.id,subjectId:subject.id,primaryTeacherId:teacherId,displayName:input.displayName,graceMinutes:input.graceMinutes,schedule:input.schedule??Prisma.DbNull}});
  await replaceRosterConfiguration(tx,created.id,input.sectionIds,input.exceptions,user.id);
  if(input.onboardingExpectedRevision!==undefined)await linkCreatedFirstClass(tx,user.id,onboarding,created.id);
  const result=classDto(await lockOwnedClass(tx,created.id,user,'UPDATE'));
  await tx.classroomAudit.create({data:{action:'CLASS_CREATED',entityType:'ClassOffering',entityId:created.id,classId:created.id,actorId:user.id,actorName:user.name,reason:input.reason,commandId:input.commandId,after:result}});return result;
 },{httpStatus:201,userIds:[teacherId],membershipUserIds:[teacherId],authorizeReplay:async(tx,user,result)=>{
  if(!result||typeof result!=='object'||Array.isArray(result)||typeof result.id!=='string')throw new AuthError('Stored class command is unavailable.',500,'INVALID_RECEIPT');
  await takeRosterSharedLock(tx);await lockOwnedClass(tx,result.id,user,'SHARE');
 }});
}
export async function getClassOffering(db:PrismaClient,actor:ActorContext,classId:string){
 return classroomRead(db,actor,async(tx,user)=>classDto(await lockOwnedClass(tx,classId,user,'SHARE')),{roster:true});
}
export async function listClassOfferings(db:PrismaClient,actor:ActorContext,raw=new URLSearchParams()){
 const input=classQuerySchema.parse(Object.fromEntries(raw));return classroomRead(db,actor,async(tx,user)=>{
  const admin=classroomAdministrator(user);if(input.teacherId&&!admin)throw new AuthError('Only administrators can filter other teachers.',403,'FORBIDDEN');
  const where:Prisma.ClassOfferingWhereInput={...(!input.includeArchived?{archivedAt:null}:{}),...(!admin?{primaryTeacherId:user.id}:input.teacherId?{primaryTeacherId:input.teacherId}:{}),...(input.termId?{termId:input.termId}:{}),...(input.q?{displayName:{contains:input.q,mode:'insensitive'}}:{})};
  const items=await tx.classOffering.findMany({where,include:{...classInclude,rosterExceptions:false,sessions:{orderBy:[{scheduledStartAt:'desc'},{id:'desc'}],take:1,select:{id:true,state:true,scheduledStartAt:true}},},orderBy:[{updatedAt:'desc'},{id:'asc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize});
  const active=await tx.classroomSession.findMany({where:{classId:{in:items.map(row=>row.id)},state:'ACTIVE'},select:{id:true,classId:true,scheduledStartAt:true}});
  return {items:items.map(row=>{const {exceptions:_,...summary}=classDto({...row,rosterExceptions:[]});void _;const current=active.find(meeting=>meeting.classId===row.id);const latest=row.sessions[0];return {...summary,activeSession:current?{id:current.id,scheduledStartAt:current.scheduledStartAt.toISOString()}:null,latestSession:latest?{...latest,scheduledStartAt:latest.scheduledStartAt.toISOString()}:null};}),total:await tx.classOffering.count({where}),page:input.page,pageSize:input.pageSize};
 });
}
export async function updateClassOffering(db:PrismaClient,actor:ActorContext,classId:string,raw:unknown){
 const input=classPatchSchema.parse(raw);let row!:ClassRow;
 return executeClassroomCommand(db,actor,'APPROVED_CLASSROOM',{commandId:input.commandId,operation:'UPDATE_CLASS',resourceId:classId,payload:input},async(tx,user)=>{
  requireAssistanceReason(user,row,input.reason);if(row.configRevision!==input.expectedConfigRevision)throw new AuthError('Class settings changed. Reload them before applying your draft.',409,'CLASS_CONFIG_CHANGED');
  const schedule=input.schedule===undefined?row.schedule:input.schedule;
  const archived=input.archived===undefined?!!row.archivedAt:input.archived;
  const changed=(input.displayName!==undefined&&input.displayName!==row.displayName)||(input.graceMinutes!==undefined&&input.graceMinutes!==row.graceMinutes)||commandHash(schedule)!==commandHash(row.schedule)||archived!==!!row.archivedAt;
  if(changed){
   if(input.archived&&!row.archivedAt){const active=await tx.classroomSession.findFirst({where:{classId,state:'ACTIVE'},select:{id:true}});if(active)throw new AuthError('Continue or cancel the active meeting before archiving this class.',409,'ACTIVE_SESSION_EXISTS',{sessionId:active.id});}
   const before=classDto(row);await tx.classOffering.update({where:{id:classId},data:{displayName:input.displayName,graceMinutes:input.graceMinutes,...(input.schedule!==undefined?{schedule:input.schedule??Prisma.DbNull}:{}),...(input.archived!==undefined?{archivedAt:input.archived?(row.archivedAt??new Date()):null}:{}),configRevision:{increment:1}}});
   row=await lockOwnedClass(tx,classId,user,'UPDATE');const after=classDto(row);await tx.classroomAudit.create({data:{action:'CLASS_SETTINGS_UPDATED',entityType:'ClassOffering',entityId:classId,classId,actorId:user.id,actorName:user.name,reason:input.reason,commandId:input.commandId,before,after}});
  }
  return {...classDto(row),changed};
 },{authorizeResource:async(tx,user)=>{await takeRosterSharedLock(tx);row=await lockOwnedClass(tx,classId,user,'UPDATE');}});
}
export async function transferClassOwner(db:PrismaClient,actor:ActorContext,classId:string,raw:unknown){
 const input=ownerSchema.parse(raw);let row!:ClassRow;
 return executeClassroomCommand(db,actor,'ADMIN',{commandId:input.commandId,operation:'TRANSFER_CLASS_OWNER',resourceId:classId,payload:input},async(tx,user)=>{
  if(row.configRevision!==input.expectedConfigRevision)throw new AuthError('Class settings changed. Reload before transferring ownership.',409,'CLASS_CONFIG_CHANGED');
  await approvedOwner(tx,input.teacherId);
  if(row.primaryTeacherId===input.teacherId)return {...classDto(row),changed:false};
  const before=classDto(row);await tx.classOffering.update({where:{id:classId},data:{primaryTeacherId:input.teacherId,configRevision:{increment:1}}});
  row=await lockOwnedClass(tx,classId,user,'UPDATE');const after=classDto(row);
  await tx.classroomAudit.create({data:{action:'CLASS_OWNER_CHANGED',entityType:'ClassOffering',entityId:classId,classId,actorId:user.id,actorName:user.name,reason:input.reason,commandId:input.commandId,before,after}});return {...after,changed:true};
 },{userIds:[input.teacherId],membershipUserIds:[input.teacherId],authorizeResource:async(tx,user)=>{await takeRosterSharedLock(tx);row=await lockOwnedClass(tx,classId,user,'UPDATE');}});
}
