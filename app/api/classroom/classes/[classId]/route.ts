import { prisma } from '@/globals/libs/prisma';
import { getClassOffering,updateClassOffering } from '@/features/classroom/server/classes';
import { requireClassroomActor,classroomJson,classroomError,readClassroomBody } from '@/features/classroom/server/http';
type Context={params:Promise<{classId:string}>};
export async function GET(_request:Request,{params}:Context){try{const actor=await requireClassroomActor();const {classId}=await params;return classroomJson(await getClassOffering(prisma,actor,classId));}catch(error){return classroomError(error);}}
export async function PATCH(request:Request,{params}:Context){try{const actor=await requireClassroomActor();const {classId}=await params;return classroomJson(await updateClassOffering(prisma,actor,classId,await readClassroomBody(request)));}catch(error){return classroomError(error);}}
