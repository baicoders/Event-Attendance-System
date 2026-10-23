import { NextResponse } from 'next/server';
import { prisma } from '@/globals/libs/prisma';
import { ok } from '@/globals/utils/api';
import { requireAuth,requireRole } from '@/globals/utils/auth';
import { addCustomMember } from '@/features/custom-groups/server/membership';
import { customGroupFailure,addMemberSchema } from '@/features/custom-groups/server/http';
export async function POST(request:Request,{params}:{params:Promise<{groupId:string}>}) {
 try {
  const actor=await requireAuth();requireRole(actor,'ADMIN');const {groupId}=await params;
  const {studentId,position}=addMemberSchema.parse(await request.json());
  return NextResponse.json(ok(await addCustomMember(prisma,groupId,studentId,position,actor)));
 }catch(error){return customGroupFailure(error);}
}
