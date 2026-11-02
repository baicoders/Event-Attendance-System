import { prisma } from '@/globals/libs/prisma';
import { listStudentDirectory } from '@/features/students/server/profileChanges';
import { requireClassroomActor,classroomJson,classroomError } from '@/features/classroom/server/http';
export async function GET(request:Request){try{const actor=await requireClassroomActor();return classroomJson(await listStudentDirectory(prisma,actor,new URL(request.url).searchParams));}catch(error){return classroomError(error);}}
