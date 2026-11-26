import { prisma } from '@/globals/libs/prisma';
import { verifyStudentProfile } from '@/features/students/server/verification';
import { requireClassroomActor,classroomJson,classroomError,readClassroomBody } from '@/features/classroom/server/http';
export async function POST(request:Request,{params}:{params:Promise<{studentId:string}>}){try{const actor=await requireClassroomActor();const {studentId}=await params;return classroomJson(await verifyStudentProfile(prisma,actor,studentId,await readClassroomBody(request)));}catch(error){return classroomError(error);}}
