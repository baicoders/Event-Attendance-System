import { prisma } from '@/globals/libs/prisma';
import { listAcademicTerms,createAcademicTerm } from '@/features/classroom/server/catalog';
import { requireClassroomActor,classroomJson,classroomError,readClassroomBody } from '@/features/classroom/server/http';
export async function GET(request:Request){try{const actor=await requireClassroomActor();return classroomJson(await listAcademicTerms(prisma,actor,new URL(request.url).searchParams));}catch(error){return classroomError(error);}}
export async function POST(request:Request){try{const actor=await requireClassroomActor();return classroomJson(await createAcademicTerm(prisma,actor,await readClassroomBody(request)),201);}catch(error){return classroomError(error);}}
