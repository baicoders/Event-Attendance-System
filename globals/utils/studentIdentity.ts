import type { Prisma } from '@prisma/client';
export class StudentIdentityError extends Error {
  constructor(message: string, public code='IDENTITY_CONFLICT', public status=409) { super(message); }
}
type Reader=Pick<Prisma.TransactionClient,'student'|'studentQrCode'>;
/** Legacy query shape is for inventory/import candidate discovery, never QR authority. */
export function studentIdentityWhere(code: string): Prisma.StudentWhereInput { return {OR:[{id:code},{usn:code},{lrn:code}]}; }
export async function resolveStudentQrCode(reader:Reader,raw:string) {
 const code=raw.trim();if(!code||code.length>128)return null;
 const reservation=await reader.studentQrCode.findUnique({where:{code},include:{student:{select:{id:true,archivedAt:true}}}});
 if(!reservation)return null;
 if(reservation.state==='RETIRED')throw new StudentIdentityError('This QR code was retired. Use manual attendance or the student’s reprinted card.','QR_RETIRED');
 if(reservation.state==='QUARANTINED')throw new StudentIdentityError('This QR code has conflicting identities. Select the verified student manually.','QR_AMBIGUOUS');
 if(!reservation.student||reservation.reservedOwnerId!==reservation.student.id)throw new StudentIdentityError('This QR code is unavailable.','QR_UNAVAILABLE');
 if(reservation.student.archivedAt)throw new StudentIdentityError('This student record is archived.','QR_STUDENT_ARCHIVED');
 return reservation.student.id;
}
export const resolveStudentIdentity=resolveStudentQrCode;
/** Already-selected IDs are entity references, even if an old raw code was retired. */
export async function findStudentByCanonicalId(reader:Pick<Prisma.TransactionClient,'student'>,id:string) {
 return reader.student.findUnique({where:{id},select:{id:true}});
}
export async function assertStudentIdentifiersAvailable(reader:Reader,identifiers:{usn?:string|null;lrn?:string|null},exceptId?:string) {
 const codes=[...new Set([identifiers.usn,identifiers.lrn].filter((v):v is string=>!!v))];if(!codes.length)return;
 const reservations=await reader.studentQrCode.findMany({where:{code:{in:codes}}});
 const prior=exceptId?await reader.student.findUnique({where:{id:exceptId},select:{id:true,usn:true,lrn:true}}):null;
 for(const reservation of reservations){
  if(reservation.state==='QUARANTINED'&&prior&&[prior.usn,prior.lrn].includes(reservation.code))continue;
  if(reservation.state!=='RESOLVABLE'||reservation.reservedOwnerId!==exceptId)throw new StudentIdentityError('This identifier is reserved or blocked. It cannot be assigned to another student.');
 }
}
