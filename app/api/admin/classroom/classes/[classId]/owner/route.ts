import { prisma } from '@/globals/libs/prisma';
import { transferClassOwner } from '@/features/classroom/server/classes';
import { requireClassroomAdministrator,classroomJson,classroomError,readClassroomBody } from '@/features/classroom/server/http';
export async function POST(request:Request,{params}:{params:Promise<{classId:string}>}){try{const actor=await requireClassroomAdministrator();const {classId}=await params;return classroomJson(await transferClassOwner(prisma,actor,classId,await readClassroomBody(request)));}catch(error){return classroomError(error);}}
