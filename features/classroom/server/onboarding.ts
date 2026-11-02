import 'server-only';
import type { Prisma,PrismaClient,TeacherOnboarding } from '@prisma/client';
import { AuthError } from '@/globals/utils/authError';
import { takeCommandLock,takeRosterSharedLock } from '@/globals/utils/pgLocks';
import { onboardingSchema,savedOnboardingDraftSchema,type SavedOnboardingDraft } from '../schemas/onboardingSchema';
import { nextOnboardingStep } from '../utils/onboarding';
import { classroomRead,type ActorContext,type ClassroomUser } from './access';
import { executeClassroomCommand } from './commands';
import { classDto,lockOwnedClass } from './classAccess';
import { composeClassRoster,rosterConfig } from './rosters';
import { fingerprintClassRoster } from '../utils/composeRoster';

export async function lockTeacherOnboarding(tx:Prisma.TransactionClient,userId:string) {
  await takeCommandLock(tx,'teacher-onboarding:'+userId);
  await tx.$queryRaw`SELECT "userId" FROM "TeacherOnboarding" WHERE "userId"=${userId} FOR UPDATE`;
  return tx.teacherOnboarding.findUnique({where:{userId}});
}
function draftOf(row:TeacherOnboarding|null):SavedOnboardingDraft {
  return savedOnboardingDraftSchema.parse(row?.draft??{});
}
function requireRevision(row:TeacherOnboarding|null,expected:number) {
  if ((row?.revision??0)!==expected) throw new AuthError('Setup changed on another device. Reload your saved progress before continuing.',409,'ONBOARDING_CHANGED');
}
async function projection(tx:Prisma.TransactionClient,user:ClassroomUser,row:TeacherOnboarding|null) {
  const draft=draftOf(row);
  // A stale setup reference must never reveal an unrelated teacher's class.
  const candidate=row?.classId?await tx.classOffering.findFirst({where:{id:row.classId,primaryTeacherId:user.id,archivedAt:null},select:{id:true}}):null;
  let currentClass=null;
  if(candidate){
    const locked=await lockOwnedClass(tx,candidate.id,user,'SHARE');
    if(locked.primaryTeacherId===user.id&&!locked.archivedAt)currentClass=locked;
  }
  const members=currentClass?await composeClassRoster(tx,currentClass.id):[];
  const readiness=currentClass?{
    classId:currentClass.id,rosterCount:members.length,rosterRevision:currentClass.rosterRevision,
    configRevision:currentClass.configRevision,
    rosterFingerprint:fingerprintClassRoster(members,rosterConfig(currentClass)),
  }:null;
  const rosterReviewed=!!readiness&&draft.reviewedRoster?.classId===readiness.classId&&draft.reviewedRoster.rosterRevision===readiness.rosterRevision&&draft.reviewedRoster.rosterFingerprint===readiness.rosterFingerprint;
  const settingsReviewed=!!readiness&&draft.reviewedSettings?.classId===readiness.classId&&draft.reviewedSettings.configRevision===readiness.configRevision;
  const [draftTerm,draftSubject]=await Promise.all([
    draft.classForm?.termId?tx.academicTerm.findFirst({where:{id:draft.classForm.termId,archivedAt:null}}):null,
    draft.classForm?.subjectId?tx.subject.findFirst({where:{id:draft.classForm.subjectId,archivedAt:null}}):null,
  ]);
  const draftChoices={
    term:draftTerm?{id:draftTerm.id,name:draftTerm.name,startDate:draftTerm.startDate.toISOString().slice(0,10),endDate:draftTerm.endDate.toISOString().slice(0,10),timeZone:draftTerm.timeZone,revision:draftTerm.revision,archivedAt:null}:null,
    subject:draftSubject?{id:draftSubject.id,code:draftSubject.code,title:draftSubject.title,revision:draftSubject.revision,archivedAt:null}:null,
  };
  return {
    revision:row?.revision??0,flowVersion:row?.flowVersion??1,completedAt:row?.completedAt?.toISOString()??null,
    nextStep:nextOnboardingStep({completed:!!row?.completedAt,welcomeSeen:!!draft.welcomeSeen,classAvailable:!!currentClass,
      rosterCount:members.length,rosterReviewed,settingsReviewed,tutorialDone:!!draft.tutorial}),
    classId:currentClass?.id??null,class:currentClass?classDto(currentClass):null,
    classUnavailable:!!row?.classId&&!currentClass,readiness,draft,draftChoices,
  };
}
export async function getTeacherOnboarding(db:PrismaClient,actor:ActorContext) {
  return classroomRead(db,actor,async(tx,user)=>projection(tx,user,await tx.teacherOnboarding.findUnique({where:{userId:user.id}})),{roster:true});
}
export async function saveTeacherOnboarding(db:PrismaClient,actor:ActorContext,raw:unknown) {
  const input=onboardingSchema.parse(raw);
  return executeClassroomCommand(db,actor,'APPROVED_CLASSROOM',{
    commandId:input.commandId,operation:'SAVE_TEACHER_ONBOARDING',resourceId:actor.userId,payload:input,
  },async(tx,user)=>{
    const previous=await lockTeacherOnboarding(tx,user.id);requireRevision(previous,input.expectedRevision);
    await takeRosterSharedLock(tx);
    let classId=previous?.classId??null;
    const draft=draftOf(previous);
    if(input.classId!==undefined){
      if(input.step!=='CLASS')throw new AuthError('Choose a class in the class setup step.',400,'INVALID_ONBOARDING_STEP');
      if(input.classId){
        const chosen=await tx.classOffering.findFirst({where:{id:input.classId,primaryTeacherId:user.id,archivedAt:null},select:{id:true}});
        if(!chosen)throw new AuthError('Choose one of your available classes.',404,'ONBOARDING_CLASS_UNAVAILABLE');
        await lockOwnedClass(tx,chosen.id,user,'SHARE');
      }
      if(classId!==input.classId){delete draft.reviewedRoster;delete draft.reviewedSettings;}
      classId=input.classId;
    }
    if(input.draft?.classForm)draft.classForm=input.draft.classForm;
    if(input.step==='WELCOME')draft.welcomeSeen=true;
    const virtual=previous?{...previous,classId,draft:draft as Prisma.JsonValue}:null;
    // New rows may select an existing administrator-created class.
    const current=await projection(tx,user,virtual??{userId:user.id,classId,draft:draft as Prisma.JsonValue,flowVersion:1,step:'WELCOME',revision:0,completedAt:null,createdAt:new Date(),updatedAt:new Date()});
    if(input.step==='ROSTER'){
      const ready=current.readiness;
      if(!ready||!ready.rosterCount)throw new AuthError('Include at least one existing student before continuing.',409,'EMPTY_ROSTER');
      if(input.expectedRosterRevision!==ready.rosterRevision||input.rosterFingerprint!==ready.rosterFingerprint)throw new AuthError('The live class roster changed. Reload and review it before continuing.',409,'ROSTER_CHANGED');
      draft.reviewedRoster={classId:ready.classId,rosterRevision:ready.rosterRevision,rosterFingerprint:ready.rosterFingerprint};
    }
    if(input.step==='SETTINGS'){
      const ready=current.readiness;
      if(!ready||input.expectedConfigRevision!==ready.configRevision)throw new AuthError('The class settings changed. Reload and review them before continuing.',409,'CLASS_CONFIG_CHANGED');
      draft.reviewedSettings={classId:ready.classId,configRevision:ready.configRevision};
    }
    if(input.step==='TUTORIAL'){
      if(!input.draft?.tutorial)throw new AuthError('Try the tutorial or choose Skip tutorial.',400,'TUTORIAL_CHOICE_REQUIRED');
      draft.tutorial=input.draft.tutorial;
    }
    if(input.complete&&current.nextStep!=='READY'&&current.nextStep!=='COMPLETED')throw new AuthError('Complete the class, roster and attendance settings steps first.',409,'ONBOARDING_NOT_READY');
    savedOnboardingDraftSchema.parse(draft);
    const data={classId,draft:draft as Prisma.InputJsonValue,step:input.step,completedAt:previous?.completedAt??(input.complete?new Date():null),revision:(previous?.revision??0)+1};
    const saved=await tx.teacherOnboarding.upsert({where:{userId:user.id},create:{userId:user.id,...data},update:data});
    await tx.classroomAudit.create({data:{action:input.complete?'TEACHER_ONBOARDING_COMPLETED':'TEACHER_ONBOARDING_SAVED',entityType:'TeacherOnboarding',entityId:user.id,actorId:user.id,actorName:user.name,commandId:input.commandId,after:{step:input.step,classId,revision:saved.revision,completed:!!saved.completedAt}}});
    return projection(tx,user,saved);
  },{authorizeReplay:async(tx,user,result)=>{
    // Replaying progress must not restore a private class DTO after ownership transfer.
    if(result&&typeof result==='object'&&!Array.isArray(result)&&typeof result.classId==='string'){
      await takeRosterSharedLock(tx);
      const row=await lockOwnedClass(tx,result.classId,user,'SHARE');
      if(row.primaryTeacherId!==user.id)throw new AuthError('Setup class is no longer available. Reload your setup.',404,'ONBOARDING_CLASS_UNAVAILABLE');
    }
  }});
}
/** Called inside first-class creation after its onboarding lock, before catalog/class locks. */
export async function validateFirstClassCreation(tx:Prisma.TransactionClient,userId:string,row:TeacherOnboarding|null,expectedRevision:number) {
  requireRevision(row,expectedRevision);
  if(!draftOf(row).welcomeSeen||row?.completedAt)throw new AuthError('Reload the first-class setup before creating this class.',409,'ONBOARDING_CHANGED');
  if(row?.classId&&await tx.classOffering.count({where:{id:row.classId,primaryTeacherId:userId,archivedAt:null}}))throw new AuthError('A first class is already saved. Continue its setup.',409,'ONBOARDING_CLASS_EXISTS');
}
export async function linkCreatedFirstClass(tx:Prisma.TransactionClient,userId:string,row:TeacherOnboarding|null,classId:string) {
  const draft=draftOf(row);delete draft.classForm;delete draft.reviewedRoster;delete draft.reviewedSettings;
  await tx.teacherOnboarding.upsert({where:{userId},create:{userId,classId,step:'ROSTER',draft:draft as Prisma.InputJsonValue,revision:1},update:{classId,step:'ROSTER',draft:draft as Prisma.InputJsonValue,revision:{increment:1}}});
}
