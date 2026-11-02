import type { Prisma } from '@prisma/client';
import { StudentIdentityError } from '@/globals/utils/studentIdentity';
export type IdentifierDisposition='KEEP_ALIAS_CONFIRMED'|'REPRINT_REQUIRED';
/** Caller holds roster EXCLUSIVE. Retired values are never reusable. */
export async function changeQrDisposition(tx:Prisma.TransactionClient,studentId:string,codes:string[],disposition:IdentifierDisposition){
 const student=await tx.student.findUniqueOrThrow({where:{id:studentId},select:{usn:true,lrn:true}});
 for(const code of [...new Set(codes)].sort()){
  if([student.usn,student.lrn].includes(code))throw new StudentIdentityError('This code remains a current identifier and cannot be retired.','QR_STILL_CURRENT');
  const reservation=await tx.studentQrCode.findUnique({where:{code}});
  if(!reservation)throw new StudentIdentityError('The prior QR reservation is missing.','QR_UNAVAILABLE');
  if(reservation.state==='QUARANTINED'){
   if(disposition==='KEEP_ALIAS_CONFIRMED')throw new StudentIdentityError('An ambiguous code cannot be kept as an alias. Reprint the student’s QR code.','QR_AMBIGUOUS');
   continue;
  }
  if(reservation.reservedOwnerId!==studentId)throw new StudentIdentityError('The prior code belongs to another identity.');
  if(disposition==='KEEP_ALIAS_CONFIRMED'&&reservation.state!=='RESOLVABLE')throw new StudentIdentityError('Retired QR codes cannot be reactivated.','QR_RETIRED');
  if(disposition==='REPRINT_REQUIRED'&&reservation.state==='RESOLVABLE')await tx.studentQrCode.update({where:{code},data:{state:'RETIRED',retiredAt:new Date()}});
 }
}
