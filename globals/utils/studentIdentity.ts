import type { Prisma } from '@prisma/client';
export class StudentIdentityError extends Error {
  constructor(message: string, public code='IDENTITY_CONFLICT',public status=409) {super(message);}
}
export function studentIdentityWhere(code: string): Prisma.StudentWhereInput {
  return {OR:[{id:code},{usn:code},{lrn:code}]};
}
/** Resolve all namespaces together; ambiguity must never depend on query order. */
export async function resolveStudentIdentity(reader:Pick<Prisma.TransactionClient,'student'>,code:string) {
  const matches=await reader.student.findMany({where:studentIdentityWhere(code),select:{id:true},take:2});
  if(matches.length>1) throw new StudentIdentityError('This code matches multiple people. Resolve the identifier conflict before attendance.');
  return matches[0]?.id ?? null;
}
export async function assertStudentIdentifiersAvailable(reader:Pick<Prisma.TransactionClient,'student'>,identifiers:{usn?:string|null;lrn?:string|null},exceptId?:string) {
  const codes=[identifiers.usn,identifiers.lrn].filter((v):v is string=>!!v);
  if(!codes.length)return;
  const matches=await reader.student.findMany({where:{OR:codes.map(studentIdentityWhere),...(exceptId?{id:{not:exceptId}}:{})},select:{id:true},take:1});
  if(matches.length)throw new StudentIdentityError('USN or LRN already belongs to another person.');
}
