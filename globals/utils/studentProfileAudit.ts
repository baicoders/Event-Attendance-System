import type { Prisma } from '@prisma/client';
export type StudentWriteContext={actorId?:string;actorName:string;source:'TEACHER'|'ADMIN'|'EVENTS'|'IMPORT'|'BULK'|'MAINTENANCE';reason?:string;commandId?:string;identifierDisposition?:'KEEP_ALIAS_CONFIRMED'|'REPRINT_REQUIRED'};
/** Context is local to this transaction; SQL triggers cover raw and implicit writes. */
export async function setStudentWriteContext(tx:Prisma.TransactionClient,context:StudentWriteContext){
 await tx.$queryRaw`SELECT set_config('school.student_write',${JSON.stringify(context)},true)`;
}
/** Flush after all scalar/membership writes and before constructing response/receipt. */
export async function flushStudentProfileChanges(tx:Prisma.TransactionClient){await tx.$executeRaw`SELECT school_flush_student_profiles()`;}

export async function setStudentIdentifierDisposition(tx:Prisma.TransactionClient,disposition:'KEEP_ALIAS_CONFIRMED'|'REPRINT_REQUIRED'){
 await tx.$queryRaw`SELECT set_config('school.student_write',(COALESCE(NULLIF(current_setting('school.student_write',true),''),'{}')::jsonb || jsonb_build_object('identifierDisposition',${disposition}::text))::text,true)`;
}
