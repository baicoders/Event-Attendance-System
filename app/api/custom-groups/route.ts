import { NextResponse } from 'next/server';
import { prisma } from '@/globals/libs/prisma';
import { ok } from '@/globals/utils/api';
import { requireAuth, requireRole } from '@/globals/utils/auth';
import { createCustomGroup } from '@/features/custom-groups/server/membership';
import { customGroupFailure,customGroupNameSchema } from '@/features/custom-groups/server/http';
export async function GET() {
  try {
    await requireAuth();
    const groups=await prisma.group.findMany({where:{category:'CUSTOM'},orderBy:{name:'asc'},select:{id:true,name:true,slug:true,category:true,_count:{select:{customMemberships:true}}}});
    return NextResponse.json(ok(groups.map(({_count,...group})=>({...group,memberCount:_count.customMemberships}))),{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) {return customGroupFailure(error);}
}
export async function POST(request:Request) {
  try {
    const actor=await requireAuth();requireRole(actor,'ADMIN');
    const {name}=customGroupNameSchema.parse(await request.json());
    return NextResponse.json(ok(await createCustomGroup(prisma,name,actor)),{status:201});
  } catch(error) {return customGroupFailure(error);}
}
