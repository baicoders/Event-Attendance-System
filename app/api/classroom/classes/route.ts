import { prisma } from '@/globals/libs/prisma';
import { listClassOfferings,createClassOffering } from '@/features/classroom/server/classes';
import { requireClassroomActor,classroomJson,classroomError,readClassroomBody } from '@/features/classroom/server/http';
export async function GET(request:Request){try{const actor=await requireClassroomActor();return classroomJson(await listClassOfferings(prisma,actor,new URL(request.url).searchParams));}catch(error){return classroomError(error);}}
export async function POST(request:Request){try{const actor=await requireClassroomActor();return classroomJson(await createClassOffering(prisma,actor,await readClassroomBody(request,256*1024)),201);}catch(error){return classroomError(error);}}
