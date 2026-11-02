import 'server-only';
import { Prisma } from '@prisma/client';
import { AuthError } from '@/globals/utils/authError';
import { classroomAdministrator,type ClassroomUser } from './access';
export const classInclude={term:true,subject:true,primaryTeacher:{select:{id:true,name:true}},sections:{include:{section:{select:{id:true,name:true,slug:true,category:true}}},orderBy:{sectionId:'asc'}},rosterExceptions:{include:{student:{select:{id:true,usn:true,lrn:true,firstName:true,lastName:true,archivedAt:true}}},orderBy:{studentId:'asc'}}} satisfies Prisma.ClassOfferingInclude;
export type ClassRow=Prisma.ClassOfferingGetPayload<{include:typeof classInclude}>;
export async function lockOwnedClass(tx:Prisma.TransactionClient,classId:string,user:ClassroomUser,mode:'SHARE'|'UPDATE'){
 if(mode==='UPDATE')await tx.$queryRaw`SELECT id FROM "ClassOffering" WHERE id=${classId} FOR UPDATE`;
 else await tx.$queryRaw`SELECT id FROM "ClassOffering" WHERE id=${classId} FOR SHARE`;
 const row=await tx.classOffering.findUnique({where:{id:classId},include:classInclude});
 if(!row||(!classroomAdministrator(user)&&row.primaryTeacherId!==user.id))throw new AuthError('Class not found.',404,'CLASS_NOT_FOUND');
 return row;
}
export function requireAssistanceReason(user:ClassroomUser,row:{primaryTeacherId:string},reason?:string){
 if(classroomAdministrator(user)&&row.primaryTeacherId!==user.id&&!reason)throw new AuthError('Enter a reason for changes made on the teacher’s behalf.',400,'REASON_REQUIRED');
}
export function classDto(row:ClassRow){
 return {id:row.id,displayName:row.displayName,termId:row.termId,subjectId:row.subjectId,primaryTeacherId:row.primaryTeacherId,primaryTeacher:row.primaryTeacher,
  term:{id:row.term.id,name:row.term.name,startDate:row.term.startDate.toISOString().slice(0,10),endDate:row.term.endDate.toISOString().slice(0,10),timeZone:row.term.timeZone,archivedAt:row.term.archivedAt?.toISOString()??null},
  subject:{id:row.subject.id,code:row.subject.code,title:row.subject.title,archivedAt:row.subject.archivedAt?.toISOString()??null},
  schedule:row.schedule,graceMinutes:row.graceMinutes,configRevision:row.configRevision,rosterRevision:row.rosterRevision,archivedAt:row.archivedAt?.toISOString()??null,
  sections:row.sections.map(({sectionId,section})=>({sectionId,name:section.name,slug:section.slug})),exceptions:row.rosterExceptions.map(({studentId,kind,reason,student})=>({studentId,kind,reason,student:{...student,archivedAt:student.archivedAt?.toISOString()??null}})),
  createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
}
export async function lockSectionRows(tx:Prisma.TransactionClient,sectionIds:string[]){
 if(sectionIds.length)await tx.$queryRaw(Prisma.sql`SELECT id FROM "Group" WHERE id IN (${Prisma.join(sectionIds)}) ORDER BY id FOR SHARE`);
}
export async function validateRosterSelections(tx:Prisma.TransactionClient,sectionIds:string[],exceptions:Array<{studentId:string}>){
 const sections=await tx.group.findMany({where:{id:{in:sectionIds},category:'SECTION',slug:{not:'employees'}},select:{id:true}});
 if(sections.length!==sectionIds.length)throw new AuthError('Choose existing official student sections.',400,'INVALID_SECTIONS');
 const ids=exceptions.map(row=>row.studentId);const students=await tx.student.count({where:{id:{in:ids},archivedAt:null,groups:{none:{slug:'employees'}}}});
 if(students!==ids.length)throw new AuthError('A roster exception is unavailable or is not an active student. Remove it or choose a current student record.',400,'INVALID_ROSTER_STUDENT');
}
