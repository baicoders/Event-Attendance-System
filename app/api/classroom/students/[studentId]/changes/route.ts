import { prisma } from '@/globals/libs/prisma';
import { studentChangeHistory } from '@/features/students/server/profileChanges';
import { requireClassroomActor,classroomJson,classroomError } from '@/features/classroom/server/http';
export async function GET(request:Request,{params}:{params:Promise<{studentId:string}>}){try{const actor=await requireClassroomActor();const {studentId}=await params;return classroomJson(await studentChangeHistory(prisma,actor,studentId,new URL(request.url).searchParams));}catch(error){return classroomError(error);}}
