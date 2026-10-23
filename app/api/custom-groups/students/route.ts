import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/globals/libs/prisma';
import { ok } from '@/globals/utils/api';
import { requireAuth } from '@/globals/utils/auth';
import { customGroupFailure,customStudentSelect } from '@/features/custom-groups/server/http';
export async function GET(request:Request) {
 try {
  await requireAuth();
  const search=(new URL(request.url).searchParams.get('search')??'').trim().slice(0,160);
  const tokens=search.split(/\s+/).filter(Boolean);
  const where:Prisma.StudentWhereInput=tokens.length?{AND:tokens.map(token=>({OR:['firstName','middleName','lastName','usn','lrn'].map(field=>({[field]:{contains:token,mode:'insensitive'}}))}))}:{};
  const students=await prisma.student.findMany({where,orderBy:[{lastName:'asc'},{firstName:'asc'},{id:'asc'}],take:30,select:{...customStudentSelect,customMemberships:{select:{groupId:true,group:{select:{name:true}}}}}});
  return NextResponse.json(ok(students.map(({customMemberships,...student})=>({...student,customGroupId:customMemberships[0]?.groupId??null,customGroupName:customMemberships[0]?.group.name??null}))),{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return customGroupFailure(error);}
}
