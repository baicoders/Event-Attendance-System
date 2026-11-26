import 'server-only';
import type { Prisma,PrismaClient } from '@prisma/client';
import { AuthError } from '@/globals/utils/authError';
import { takeRosterSharedLock } from '@/globals/utils/pgLocks';
import { entityId,rosterSchema,rosterQuerySchema } from '../schemas/rosterSchema';
import { composeRosterFromStudents,fingerprintClassRoster,type RosterConfig } from '../utils/composeRoster';
import { executeClassroomCommand } from './commands';
import { classroomRead,type ActorContext } from './access';
import { lockOwnedClass,classDto,requireAssistanceReason,validateRosterSelections,lockSectionRows,type ClassRow } from './classAccess';
export function rosterConfig(row:ClassRow):RosterConfig{return {classId:row.id,rosterRevision:row.rosterRevision,sectionIds:row.sections.map(section=>section.sectionId).sort(),exceptions:row.rosterExceptions.map(({studentId,kind,reason})=>({studentId,kind,reason})).sort((a,b)=>a.studentId<b.studentId?-1:a.studentId>b.studentId?1:0)};}
/** Caller holds the shared central roster lock and the Class row lock. */
export async function composeClassRoster(tx:Prisma.TransactionClient,classId:string){
 const config=await tx.classOffering.findUniqueOrThrow({where:{id:classId},include:{sections:true,rosterExceptions:true}});
 const sectionIds=config.sections.map(row=>row.sectionId);const exceptions=config.rosterExceptions.map(({studentId,kind,reason})=>({studentId,kind,reason}));
 const students=await tx.student.findMany({where:{archivedAt:null,groups:{none:{slug:'employees'}},OR:[{groups:{some:{id:{in:sectionIds}}}},{id:{in:exceptions.filter(row=>row.kind==='INCLUDE').map(row=>row.studentId)}}]},include:{groups:true}});
 return composeRosterFromStudents(students,sectionIds,exceptions);
}
export async function getClassRoster(db:PrismaClient,actor:ActorContext,classId:string,raw=new URLSearchParams()){
 const input=rosterQuerySchema.parse(Object.fromEntries(raw));
 return classroomRead(db,actor,async(tx,user)=>{
  const row=await lockOwnedClass(tx,classId,user,'SHARE');const roster=await composeClassRoster(tx,classId);const fingerprint=fingerprintClassRoster(roster,rosterConfig(row));
  const q=input.q.toLocaleLowerCase('en');const filtered=q?roster.filter(member=>[member.studentSnapshot.firstName,member.studentSnapshot.lastName,member.studentSnapshot.usn,member.studentSnapshot.lrn,member.studentId].some(value=>value?.toLocaleLowerCase('en').includes(q))):roster;
  return {items:filtered.slice((input.page-1)*input.pageSize,input.page*input.pageSize),total:roster.length,filteredCount:filtered.length,page:input.page,pageSize:input.pageSize,rosterRevision:row.rosterRevision,configRevision:row.configRevision,rosterFingerprint:fingerprint,configuration:rosterConfig(row)};
 },{roster:true});
}
export async function replaceRosterConfiguration(tx:Prisma.TransactionClient,classId:string,sectionIds:string[],exceptions:Array<{studentId:string;kind:'INCLUDE'|'EXCLUDE';reason:string}>,actorId:string){
 await tx.classSection.deleteMany({where:{classId}});if(sectionIds.length)await tx.classSection.createMany({data:sectionIds.map(sectionId=>({classId,sectionId}))});
 const previous=await tx.classRosterException.findMany({where:{classId}});const originalActors=new Map(previous.map(row=>[row.studentId,row.createdById]));
 await tx.classRosterException.deleteMany({where:{classId}});
 if(exceptions.length)await tx.classRosterException.createMany({data:exceptions.map(row=>({...row,classId,createdById:originalActors.get(row.studentId)??actorId,updatedById:actorId}))});
}
export async function saveClassRoster(db:PrismaClient,actor:ActorContext,raw:unknown){
 const input=rosterSchema.extend({classId:entityId}).parse(raw);let row!:ClassRow;
 return executeClassroomCommand(db,actor,'APPROVED_CLASSROOM',{commandId:input.commandId,operation:'SAVE_CLASS_ROSTER',resourceId:input.classId,payload:input},async(tx,user)=>{
  await validateRosterSelections(tx,input.sectionIds,input.exceptions);
  requireAssistanceReason(user,row,input.reason);if(row.archivedAt)throw new AuthError('Unarchive this class before changing its future roster.',409,'CLASS_ARCHIVED');
  if(row.rosterRevision!==input.expectedRosterRevision)throw new AuthError('The saved class roster changed. Reload it before saving your draft.',409,'ROSTER_REVISION_CHANGED');
  const before=rosterConfig(row);const after={...before,sectionIds:input.sectionIds,exceptions:[...input.exceptions].sort((a,b)=>a.studentId<b.studentId?-1:a.studentId>b.studentId?1:0)};
  const changed=JSON.stringify(before)!==JSON.stringify(after);
  if(changed){await replaceRosterConfiguration(tx,row.id,input.sectionIds,input.exceptions,user.id);await tx.classOffering.update({where:{id:row.id},data:{rosterRevision:{increment:1}}});await tx.classroomAudit.create({data:{action:'CLASS_ROSTER_UPDATED',entityType:'ClassOffering',entityId:row.id,classId:row.id,actorId:user.id,actorName:user.name,reason:input.reason,commandId:input.commandId,before,after:{...after,rosterRevision:before.rosterRevision+1}}});}
  const fresh=await lockOwnedClass(tx,row.id,user,'UPDATE');const roster=await composeClassRoster(tx,row.id);
  return {...classDto(fresh),changed,rosterCount:roster.length,rosterFingerprint:fingerprintClassRoster(roster,rosterConfig(fresh))};
 },{authorizeResource:async(tx,user)=>{await takeRosterSharedLock(tx);await lockSectionRows(tx,input.sectionIds);row=await lockOwnedClass(tx,input.classId,user,'UPDATE');}});
}
