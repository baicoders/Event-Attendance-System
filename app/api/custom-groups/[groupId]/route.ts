import { NextResponse } from 'next/server';
import { prisma } from '@/globals/libs/prisma';
import { ok,err } from '@/globals/utils/api';
import { requireAuth,requireRole } from '@/globals/utils/auth';
import { renameCustomGroup } from '@/features/custom-groups/server/membership';
import { customGroupFailure,customGroupNameSchema,customStudentSelect } from '@/features/custom-groups/server/http';
type Context={params:Promise<{groupId:string}>};
export async function GET(_request:Request,{params}:Context) {
 try {
  await requireAuth();const {groupId}=await params;
  const group=await prisma.group.findFirst({where:{id:groupId,category:'CUSTOM'},include:{customMemberships:{include:{student:{select:customStudentSelect}},orderBy:[{student:{lastName:'asc'}},{student:{firstName:'asc'}},{studentId:'asc'}]}}});
  if(!group)return NextResponse.json(err('Custom group not found.','NOT_FOUND'),{status:404});
  const {customMemberships,...details}=group;
  return NextResponse.json(ok({...details,members:customMemberships,memberCount:customMemberships.length}),{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return customGroupFailure(error);}
}
export async function PATCH(request:Request,{params}:Context) {
 try {
  const actor=await requireAuth();requireRole(actor,'ADMIN');const {groupId}=await params;
  const {name}=customGroupNameSchema.parse(await request.json());
  return NextResponse.json(ok(await renameCustomGroup(prisma,groupId,name,actor)));
 }catch(error){return customGroupFailure(error);}
}
