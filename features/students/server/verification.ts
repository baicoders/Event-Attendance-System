import 'server-only';
import { studentSchema } from '@/globals/schemas/studentSchema';
import type { PrismaClient } from '@prisma/client';
import { studentEditVersion } from '@/globals/utils/studentDetail';
import { AuthError } from '@/globals/utils/authError';
import { takeRosterSharedLock } from '@/globals/utils/pgLocks';
import { executeClassroomCommand } from '@/features/classroom/server/commands';
import type { ActorContext } from '@/features/classroom/server/access';
import { studentVerificationSchema } from '@/features/classroom/schemas/studentCorrectionSchema';
import { verificationContentHash } from './verificationContent';
import { profileDto,academicFields } from './profileChanges';
export async function verifyStudentProfile(db:PrismaClient,actor:ActorContext,id:string,raw:unknown){
 const input=studentVerificationSchema.parse(raw);
 return executeClassroomCommand(db,actor,'APPROVED_CLASSROOM',{commandId:input.commandId,operation:'VERIFY_STUDENT_PROFILE',resourceId:id,payload:input},async(tx,user)=>{
  await takeRosterSharedLock(tx);await tx.$queryRaw`SELECT id FROM "Student" WHERE id=${id} FOR UPDATE`;
  const student=await tx.student.findUnique({where:{id,archivedAt:null},include:{groups:true}});
  if(!student||student.groups.some(g=>g.slug==='employees'))throw new AuthError('Student not found.',404,'STUDENT_NOT_FOUND');
  if(studentEditVersion(student)!==input.expectedVersion)throw new AuthError('This record changed. Reload before verifying.',409,'STUDENT_EDIT_CONFLICT');
  if(input.state==='VERIFIED'&&Object.values(academicFields).some(category=>student.groups.filter(group=>group.category===category).length>1))throw new AuthError('Resolve the duplicate official assignments before marking this record verified.',409,'STUDENT_GROUP_REVIEW_REQUIRED');
  if(input.state==='VERIFIED'){
   const academic=Object.fromEntries(Object.entries(academicFields).map(([field,category])=>[field,student.groups.find(group=>group.category===category)?.slug??null]));
   const valid=studentSchema.safeParse({...student,...academic});
   if(!valid.success)throw new AuthError('Correct the missing or invalid official information before verifying this record.',409,'STUDENT_PROFILE_INVALID',{fields:valid.error.issues.map(issue=>String(issue.path[0]??'record'))});
  }
  await tx.studentVerification.create({data:{studentId:id,profileRevision:student.profileRevision,verifiedContentHash:verificationContentHash(student),state:input.state,note:input.note||null,actorId:user.id,actorName:user.name,commandId:input.commandId}});
  return profileDto(tx,student);
 });
}
