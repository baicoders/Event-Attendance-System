import { NextResponse } from 'next/server';
import { prisma } from '@/globals/libs/prisma';
import { ok } from '@/globals/utils/api';
import { requireAuth,requireRole } from '@/globals/utils/auth';
import { updateCustomPosition,removeCustomMember } from '@/features/custom-groups/server/membership';
import { customGroupFailure,positionSchema } from '@/features/custom-groups/server/http';
type Context={params:Promise<{groupId:string;studentId:string}>};
export async function PATCH(request:Request,{params}:Context) {
 try {
  const actor=await requireAuth();requireRole(actor,'ADMIN');const {groupId,studentId}=await params;
  const {position}=positionSchema.parse(await request.json());
  return NextResponse.json(ok(await updateCustomPosition(prisma,groupId,studentId,position,actor)));
 }catch(error){return customGroupFailure(error);}
}
export async function DELETE(_request:Request,{params}:Context) {
 try {
  const actor=await requireAuth();requireRole(actor,'ADMIN');const {groupId,studentId}=await params;
  return NextResponse.json(ok(await removeCustomMember(prisma,groupId,studentId,actor)));
 }catch(error){return customGroupFailure(error);}
}
