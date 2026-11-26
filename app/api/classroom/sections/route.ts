import { prisma } from '@/globals/libs/prisma';
import { listSections } from '@/features/classroom/server/catalog';
import { requireClassroomActor,classroomJson,classroomError } from '@/features/classroom/server/http';
export async function GET(request:Request){try{const actor=await requireClassroomActor();return classroomJson(await listSections(prisma,actor,new URL(request.url).searchParams));}catch(error){return classroomError(error);}}
