import 'server-only';
import { Prisma,type PrismaClient } from '@prisma/client';
import { AuthError } from '@/globals/utils/authError';
import { catalogQuerySchema,termSchema,subjectSchema,termPatchSchema,subjectPatchSchema } from '../schemas/classSchema';
import { executeClassroomCommand,commandHash } from './commands';
import { classroomRead,type ActorContext } from './access';
const collapse=(value:string)=>value.normalize('NFC').trim().replace(/\s+/gu,' ');
export const normalizeCatalogText=(value:string)=>collapse(value).toLowerCase();
const termDto=(term:Prisma.AcademicTermGetPayload<object>)=>({id:term.id,name:term.name,startDate:term.startDate.toISOString().slice(0,10),endDate:term.endDate.toISOString().slice(0,10),timeZone:term.timeZone,revision:term.revision,archivedAt:term.archivedAt?.toISOString()??null});
const subjectDto=(subject:Prisma.SubjectGetPayload<object>)=>({id:subject.id,code:subject.code,title:subject.title,revision:subject.revision,archivedAt:subject.archivedAt?.toISOString()??null});
export async function createAcademicTerm(db:PrismaClient,actor:ActorContext,raw:unknown){
 const input=termSchema.parse(raw);const name=collapse(input.name);const normalizedKey=[normalizeCatalogText(name),input.startDate,input.endDate].join('|');
 return executeClassroomCommand(db,actor,'APPROVED_CLASSROOM',{commandId:input.commandId,operation:'CREATE_ACADEMIC_TERM',resourceId:'catalog:terms',payload:input},async(tx,user)=>{
  const existing=await tx.academicTerm.findUnique({where:{normalizedKey}});if(existing)throw new AuthError('This term already exists. Choose it from the list.',409,'DUPLICATE_TERM',{existingId:existing.id,existing:termDto(existing)});
  const term=await tx.academicTerm.create({data:{name,normalizedKey,startDate:new Date(input.startDate+'T00:00:00Z'),endDate:new Date(input.endDate+'T00:00:00Z'),createdById:user.id}});
  const result=termDto(term);await tx.classroomAudit.create({data:{action:'TERM_CREATED',entityType:'AcademicTerm',entityId:term.id,actorId:user.id,actorName:user.name,commandId:input.commandId,after:result}});return result;
 },{httpStatus:201});
}
export async function createSubject(db:PrismaClient,actor:ActorContext,raw:unknown){
 const input=subjectSchema.parse(raw);const title=collapse(input.title);const code=input.code?collapse(input.code):null;const normalizedCode=code?.toUpperCase()??null;const normalizedTitle=normalizeCatalogText(title);
 return executeClassroomCommand(db,actor,'APPROVED_CLASSROOM',{commandId:input.commandId,operation:'CREATE_SUBJECT',resourceId:'catalog:subjects',payload:input},async(tx,user)=>{
  const existing=await tx.subject.findFirst({where:normalizedCode?{normalizedCode}:{code:null,normalizedTitle}});if(existing)throw new AuthError('This subject already exists. Choose it from the list.',409,'DUPLICATE_SUBJECT',{existingId:existing.id,existing:subjectDto(existing)});
  const subject=await tx.subject.create({data:{title,code,normalizedCode,normalizedTitle,createdById:user.id}});const result=subjectDto(subject);
  await tx.classroomAudit.create({data:{action:'SUBJECT_CREATED',entityType:'Subject',entityId:subject.id,actorId:user.id,actorName:user.name,commandId:input.commandId,after:result}});return result;
 },{httpStatus:201});
}
export async function listAcademicTerms(db:PrismaClient,actor:ActorContext,raw=new URLSearchParams()){
 const input=catalogQuerySchema.parse(Object.fromEntries(raw));return classroomRead(db,actor,async tx=>{
  const where:Prisma.AcademicTermWhereInput={...(!input.includeArchived?{archivedAt:null}:{}),...(input.q?{name:{contains:input.q,mode:'insensitive'}}:{})};
  const [items,total]=await Promise.all([tx.academicTerm.findMany({where,orderBy:[{startDate:'desc'},{id:'asc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize}),tx.academicTerm.count({where})]);return {items:items.map(termDto),total,page:input.page,pageSize:input.pageSize};
 });
}
export async function listSubjects(db:PrismaClient,actor:ActorContext,raw=new URLSearchParams()){
 const input=catalogQuerySchema.parse(Object.fromEntries(raw));return classroomRead(db,actor,async tx=>{
  const where:Prisma.SubjectWhereInput={...(!input.includeArchived?{archivedAt:null}:{}),...(input.q?{OR:[{title:{contains:input.q,mode:'insensitive'}},{code:{contains:input.q,mode:'insensitive'}}]}:{})};
  const [items,total]=await Promise.all([tx.subject.findMany({where,orderBy:[{title:'asc'},{id:'asc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize}),tx.subject.count({where})]);return {items:items.map(subjectDto),total,page:input.page,pageSize:input.pageSize};
 });
}
export async function listSections(db:PrismaClient,actor:ActorContext,raw=new URLSearchParams()){
 const input=catalogQuerySchema.omit({includeArchived:true}).parse(Object.fromEntries(raw));return classroomRead(db,actor,async tx=>{
  const where:Prisma.GroupWhereInput={category:'SECTION',slug:{not:'employees'},...(input.q?{name:{contains:input.q,mode:'insensitive'}}:{})};
  const items=await tx.group.findMany({where,orderBy:[{name:'asc'},{id:'asc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize,select:{id:true,name:true,slug:true,_count:{select:{students:{where:{archivedAt:null,groups:{none:{slug:'employees'}}}}}}}});
  return {items:items.map(row=>({id:row.id,name:row.name,slug:row.slug,studentCount:row._count.students})),total:await tx.group.count({where}),page:input.page,pageSize:input.pageSize};
 },{roster:true});
}

export async function updateAcademicTerm(db:PrismaClient,actor:ActorContext,id:string,raw:unknown){
 const input=termPatchSchema.parse(raw);
 return executeClassroomCommand(db,actor,'ADMIN',{commandId:input.commandId,operation:'UPDATE_ACADEMIC_TERM',resourceId:id,payload:input},async(tx,user)=>{
  await tx.$queryRaw`SELECT id FROM "AcademicTerm" WHERE id=${id} FOR UPDATE`;
  const current=await tx.academicTerm.findUnique({where:{id}});if(!current)throw new AuthError('Term not found.',404,'TERM_NOT_FOUND');
  if(current.revision!==input.expectedRevision)throw new AuthError('The term changed. Reload it before saving.',409,'CATALOG_CHANGED');
  const next=termSchema.parse({commandId:input.commandId,name:input.name??current.name,startDate:input.startDate??current.startDate.toISOString().slice(0,10),endDate:input.endDate??current.endDate.toISOString().slice(0,10)});
  const name=collapse(next.name);const normalizedKey=[normalizeCatalogText(name),next.startDate,next.endDate].join('|');
  const duplicate=await tx.academicTerm.findFirst({where:{normalizedKey,id:{not:id}}});if(duplicate)throw new AuthError('This term already exists.',409,'DUPLICATE_TERM',{existingId:duplicate.id});
  const archived=input.archived??!!current.archivedAt;const before=termDto(current);
  const changed=name!==current.name||normalizedKey!==current.normalizedKey||archived!==!!current.archivedAt;
  if(!changed)return {...before,changed:false};
  const updated=await tx.academicTerm.update({where:{id},data:{name,normalizedKey,startDate:new Date(next.startDate+'T00:00:00Z'),endDate:new Date(next.endDate+'T00:00:00Z'),archivedAt:archived?(current.archivedAt??new Date()):null,revision:{increment:1}}});const after=termDto(updated);
  await tx.classroomAudit.create({data:{action:'TERM_UPDATED',entityType:'AcademicTerm',entityId:id,actorId:user.id,actorName:user.name,commandId:input.commandId,reason:input.reason,before,after}});return {...after,changed:true};
 });
}
export async function updateSubject(db:PrismaClient,actor:ActorContext,id:string,raw:unknown){
 const input=subjectPatchSchema.parse(raw);
 return executeClassroomCommand(db,actor,'ADMIN',{commandId:input.commandId,operation:'UPDATE_SUBJECT',resourceId:id,payload:input},async(tx,user)=>{
  await tx.$queryRaw`SELECT id FROM "Subject" WHERE id=${id} FOR UPDATE`;
  const current=await tx.subject.findUnique({where:{id}});if(!current)throw new AuthError('Subject not found.',404,'SUBJECT_NOT_FOUND');
  if(current.revision!==input.expectedRevision)throw new AuthError('The subject changed. Reload it before saving.',409,'CATALOG_CHANGED');
  const title=collapse(input.title??current.title);const code=input.code===undefined?current.code:input.code?collapse(input.code):null;const normalizedCode=code?.toUpperCase()??null;const normalizedTitle=normalizeCatalogText(title);const archived=input.archived??!!current.archivedAt;
  const duplicate=await tx.subject.findFirst({where:{id:{not:id},...(normalizedCode?{normalizedCode}:{code:null,normalizedTitle})}});if(duplicate)throw new AuthError('This subject already exists.',409,'DUPLICATE_SUBJECT',{existingId:duplicate.id});
  const before=subjectDto(current);const next={...before,title,code,archivedAt:archived?(current.archivedAt?.toISOString()??'new'):null};
  if(commandHash(next)===commandHash(before))return {...before,changed:false};
  const updated=await tx.subject.update({where:{id},data:{title,code,normalizedCode,normalizedTitle,archivedAt:archived?(current.archivedAt??new Date()):null,revision:{increment:1}}});const after=subjectDto(updated);
  await tx.classroomAudit.create({data:{action:'SUBJECT_UPDATED',entityType:'Subject',entityId:id,actorId:user.id,actorName:user.name,commandId:input.commandId,reason:input.reason,before,after}});return {...after,changed:true};
 });
}
