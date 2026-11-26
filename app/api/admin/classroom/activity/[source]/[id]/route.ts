import { prisma } from '@/globals/libs/prisma';
import { requireAdmin } from '@/globals/utils/auth';
import { getClassroomActivityDetail } from '@/features/classroom/server/adminActivity';
import { classroomJson,classroomError } from '@/features/classroom/server/http';
export async function GET(_request:Request,{params}:{params:Promise<{source:string;id:string}>}){try{const user=await requireAdmin();const {source,id}=await params;return classroomJson(await getClassroomActivityDetail(prisma,{userId:user.id,credentialVersion:user.credentialVersion},source,id));}catch(error){return classroomError(error);}}
