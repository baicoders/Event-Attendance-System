import { prisma } from '@/globals/libs/prisma';
import { getClassroomOverview } from '@/features/classroom/server/overview';
import { requireClassroomActor,classroomJson,classroomError } from '@/features/classroom/server/http';
export async function GET(request:Request){try{const actor=await requireClassroomActor();return classroomJson(await getClassroomOverview(prisma,actor,new URL(request.url).searchParams));}catch(error){return classroomError(error);}}
