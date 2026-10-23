import type {PrismaClient} from '@prisma/client';
import {studentSchema} from '../schemas/studentSchema';
import {takeRosterExclusiveLock} from './pgLocks';
import {validateStudentGroupSlugs} from './studentGroups';
import {assertStudentIdentifiersAvailable,StudentIdentityError} from './studentIdentity';
export async function createStudentRecord(db:PrismaClient,raw:unknown) {
 const input=studentSchema.parse(raw);
 return db.$transaction(async tx=>{
  await takeRosterExclusiveLock(tx);
  await assertStudentIdentifiersAvailable(tx,input);
  const resolution=await validateStudentGroupSlugs([input],tx);
  if(!resolution.ok)throw new StudentIdentityError(resolution.error,'INVALID_GROUPS',400);
  const groups=[input.house,input.section,input.department,input.program,input.strand].filter((v):v is string=>!!v).map(slug=>({id:resolution.slugToId.get(slug)!}));
  return tx.student.create({data:{usn:input.usn||null,lrn:input.lrn||null,firstName:input.firstName,lastName:input.lastName,middleName:input.middleName||null,schoolLevel:input.schoolLevel??null,yearLevel:input.yearLevel??null,groups:{connect:groups}},include:{groups:true}});
 });
}
