import { prisma } from '@/globals/libs/prisma';
import { getStudentProfile,correctStudentProfile } from '@/features/students/server/profileChanges';
import { requireClassroomActor,classroomJson,classroomError,readClassroomBody } from '@/features/classroom/server/http';
type Context={params:Promise<{studentId:string}>};
export async function GET(_request:Request,{params}:Context){try{const actor=await requireClassroomActor();const {studentId}=await params;return classroomJson(await getStudentProfile(prisma,actor,studentId));}catch(error){return classroomError(error);}}
export async function PATCH(request:Request,{params}:Context){try{const actor=await requireClassroomActor();const {studentId}=await params;return classroomJson(await correctStudentProfile(prisma,actor,studentId,await readClassroomBody(request)));}catch(error){return classroomError(error);}}
