import { prisma } from '@/globals/libs/prisma';
import { requireAdmin } from '@/globals/utils/auth';
import { listClassroomActivity } from '@/features/classroom/server/adminActivity';
import { classroomJson,classroomError } from '@/features/classroom/server/http';
export async function GET(request:Request){try{const user=await requireAdmin();return classroomJson(await listClassroomActivity(prisma,{userId:user.id,credentialVersion:user.credentialVersion},Object.fromEntries(new URL(request.url).searchParams)));}catch(error){return classroomError(error);}}
