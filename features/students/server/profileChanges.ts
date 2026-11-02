import 'server-only';
import { z } from 'zod';
import type { Prisma,PrismaClient } from '@prisma/client';
import { studentSchema } from '@/globals/schemas/studentSchema';
import { studentEditVersion } from '@/globals/utils/studentDetail';
import { AuthError } from '@/globals/utils/authError';
import { takeRosterExclusiveLock,takeRosterSharedLock } from '@/globals/utils/pgLocks';
import { assertStudentIdentifiersAvailable } from '@/globals/utils/studentIdentity';
import { validateStudentGroupSlugs } from '@/globals/utils/studentGroups';
import { setStudentWriteContext,flushStudentProfileChanges } from '@/globals/utils/studentProfileAudit';
import { studentCorrectionSchema } from '@/features/classroom/schemas/studentCorrectionSchema';
import { executeClassroomCommand } from '@/features/classroom/server/commands';
import { guardClassroomActor,type ActorContext } from '@/features/classroom/server/access';
import { changeQrDisposition } from './qrReservations';
import { verificationContentHash } from './verificationContent';
export const academicFields={section:'SECTION',department:'DEPARTMENT',program:'PROGRAM',strand:'STRAND'} as const;
export type ProfileStudent=Prisma.StudentGetPayload<{include:{groups:true}}>;
export function permittedStudent(student:ProfileStudent){
 return {id:student.id,usn:student.usn,lrn:student.lrn,firstName:student.firstName,lastName:student.lastName,middleName:student.middleName,schoolLevel:student.schoolLevel,yearLevel:student.yearLevel,
  groups:student.groups.filter(g=>Object.values(academicFields).includes(g.category as never)).map(({id,name,slug,category})=>({id,name,slug,category})),
  section:student.groups.find(g=>g.category==='SECTION')?.slug??null,department:student.groups.find(g=>g.category==='DEPARTMENT')?.slug??null,program:student.groups.find(g=>g.category==='PROGRAM')?.slug??null,strand:student.groups.find(g=>g.category==='STRAND')?.slug??null,
  editVersion:studentEditVersion(student),profileRevision:student.profileRevision};
}
export async function profileDto(tx:Prisma.TransactionClient,student:ProfileStudent){
 const assertion=await tx.studentVerification.findFirst({where:{studentId:student.id,profileRevision:student.profileRevision,verifiedContentHash:verificationContentHash(student)},orderBy:{id:'desc'}});
 return {...permittedStudent(student),verification:assertion?{state:assertion.state,note:assertion.note,actorName:assertion.actorName,createdAt:assertion.createdAt.toISOString()}:{state:'UNVERIFIED' as const}};
}
export async function authorizedDirectoryRead<T>(db:PrismaClient,actor:ActorContext,read:(tx:Prisma.TransactionClient)=>Promise<T>){
 return db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.userId} FOR SHARE`;await guardClassroomActor(tx,actor);await takeRosterSharedLock(tx);return read(tx);},{timeout:10000});
}
export async function getStudentProfile(db:PrismaClient,actor:ActorContext,id:string){
 return authorizedDirectoryRead(db,actor,async tx=>{const student=await tx.student.findUnique({where:{id,archivedAt:null},include:{groups:true}});if(!student||student.groups.some(g=>g.slug==='employees'))throw new AuthError('Student not found.',404,'STUDENT_NOT_FOUND');return profileDto(tx,student);});
}
export async function correctStudentProfile(db:PrismaClient,actor:ActorContext,id:string,raw:unknown){
 const input=studentCorrectionSchema.parse(raw);
 return executeClassroomCommand(db,actor,'APPROVED_CLASSROOM',{commandId:input.commandId,operation:'CORRECT_STUDENT_PROFILE',resourceId:id,payload:input},async(tx,user)=>{
  await takeRosterExclusiveLock(tx);
  const current=await tx.student.findUnique({where:{id,archivedAt:null},include:{groups:true}});
  if(!current||current.groups.some(g=>g.slug==='employees'))throw new AuthError('Student not found.',404,'STUDENT_NOT_FOUND');
  if(studentEditVersion(current)!==input.expectedVersion)throw new AuthError('Another person updated this student. Reload the current record; your draft is preserved.',409,'STUDENT_EDIT_CONFLICT');
  const needsReview=Object.entries(academicFields).filter(([,category])=>current.groups.filter(group=>group.category===category).length>1).map(([field])=>field);
  if(needsReview.some(field=>!Object.hasOwn(input.student,field)))throw new AuthError('Review the duplicate official assignments and explicitly choose which one to keep.',409,'STUDENT_GROUP_REVIEW_REQUIRED',{fields:needsReview});
  const prior=Object.fromEntries(Object.entries(academicFields).map(([field,category])=>[field,current.groups.find(g=>g.category===category)?.slug??null]));
  const form=studentSchema.parse({...current,...prior,...input.student});
  const removed=[current.usn,current.lrn].filter((code):code is string=>!!code&&![form.usn,form.lrn].includes(code));
  if(removed.length&&!input.identifierDisposition)throw new AuthError('Confirm whether existing printed cards belong to this student, or choose reprinting.',400,'QR_DISPOSITION_REQUIRED');
  await assertStudentIdentifiersAvailable(tx,form,id);
  const resolution=await validateStudentGroupSlugs([form],tx);if(!resolution.ok)throw new AuthError(resolution.error,400,'INVALID_GROUPS');
  const preserved=current.groups.filter(g=>!Object.values(academicFields).includes(g.category as never)).map(g=>g.id);
  const ids=[...preserved,...Object.keys(academicFields).flatMap(field=>{const slug=form[field as keyof typeof academicFields];return slug?[resolution.slugToId.get(slug)!]:[];})];
  const changed=['firstName','lastName','middleName','schoolLevel','yearLevel','usn','lrn'].some(field=>(current[field as keyof typeof current]||null)!==(form[field as keyof typeof form]||null))||JSON.stringify([...ids].sort())!==JSON.stringify(current.groups.map(g=>g.id).sort());
  if(changed){
   await setStudentWriteContext(tx,{actorId:user.id,actorName:user.name,source:user.role==='ADMIN'?'ADMIN':'TEACHER',reason:input.reason,commandId:input.commandId,identifierDisposition:input.identifierDisposition});
   await tx.student.update({where:{id},data:{firstName:form.firstName,lastName:form.lastName,middleName:form.middleName||null,usn:form.usn||null,lrn:form.lrn||null,schoolLevel:form.schoolLevel??null,yearLevel:form.yearLevel??null,groups:{set:ids.map(id=>({id}))}}});
   if(removed.length)await changeQrDisposition(tx,id,removed,input.identifierDisposition!);
   await flushStudentProfileChanges(tx);
  }
  return {...await profileDto(tx,await tx.student.findUniqueOrThrow({where:{id},include:{groups:true}})),changed,qrAction:removed.length?input.identifierDisposition:null};
 });
}

export async function listStudentDirectory(db:PrismaClient,actor:ActorContext,raw:URLSearchParams){
 const input=z.object({q:z.string().trim().max(100).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(100)}).strict().parse(Object.fromEntries(raw));
 return authorizedDirectoryRead(db,actor,async tx=>{
  const where:Prisma.StudentWhereInput={archivedAt:null,groups:{none:{slug:'employees'}},...(input.q?{OR:[{firstName:{contains:input.q,mode:'insensitive'}},{lastName:{contains:input.q,mode:'insensitive'}},{usn:{startsWith:input.q}},{lrn:{startsWith:input.q}},{id:input.q}]}:{})};
  const total=await tx.student.count({where});const students=await tx.student.findMany({where,orderBy:[{lastName:'asc'},{firstName:'asc'},{id:'asc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize,include:{groups:true,verifications:{take:1,orderBy:{id:'desc'}}}});
  return {items:students.map(student=>{const assertion=student.verifications[0];const matching=assertion&&assertion.profileRevision===student.profileRevision&&assertion.verifiedContentHash===verificationContentHash(student);return {...permittedStudent(student),verification:{state:matching?assertion.state:'UNVERIFIED'}};}),total,page:input.page,pageSize:input.pageSize};
 });
}
export async function studentChangeHistory(db:PrismaClient,actor:ActorContext,id:string,raw=new URLSearchParams()){
 const input=z.object({limit:z.coerce.number().int().min(1).max(100).default(100),cursor:z.string().regex(/^[1-9][0-9]{0,18}$/).refine(value=>BigInt(value)<=BigInt('9223372036854775807')).optional()}).strict().parse(Object.fromEntries(raw));
 return authorizedDirectoryRead(db,actor,async tx=>{
  const student=await tx.student.findUnique({where:{id},include:{groups:true}});if(!student||student.groups.some(g=>g.slug==='employees'))throw new AuthError('Student not found.',404,'STUDENT_NOT_FOUND');
  const scrub=(value:Prisma.JsonValue|null)=>{
   if(!value||typeof value!=='object'||Array.isArray(value))return null;
   const allowed=['id','usn','lrn','firstName','lastName','middleName','schoolLevel','yearLevel','profileRevision'];
   const snapshot:Record<string,unknown>=Object.fromEntries(Object.entries(value).filter(([key])=>allowed.includes(key)));
   snapshot.groups=Array.isArray(value.groups)?value.groups.filter(g=>g&&typeof g==='object'&&!Array.isArray(g)&&['SECTION','DEPARTMENT','PROGRAM','STRAND'].includes(String(g.category))):[];
   return snapshot;
  };
  const changes=await tx.studentProfileChange.findMany({where:{studentId:id,...(input.cursor?{id:{lt:BigInt(input.cursor)}}:{})},orderBy:{id:'desc'},take:input.limit+1});
  const items=changes.slice(0,input.limit);
  return {items:items.map(change=>({id:change.id.toString(),fromRevision:change.fromRevision,toRevision:change.toRevision,before:scrub(change.before),after:scrub(change.after),actorName:change.actorName,actorId:change.actorId,source:change.source,reason:change.reason,createdAt:change.createdAt.toISOString()})),nextCursor:changes.length>input.limit?items[items.length-1].id.toString():null,total:await tx.studentProfileChange.count({where:{studentId:id}})};
 });
}
