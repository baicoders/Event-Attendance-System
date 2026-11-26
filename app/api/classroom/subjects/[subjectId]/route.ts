import { prisma } from '@/globals/libs/prisma';
import { updateSubject } from '@/features/classroom/server/catalog';
import { requireClassroomAdministrator,classroomJson,classroomError,readClassroomBody } from '@/features/classroom/server/http';
export async function PATCH(request:Request,{params}:{params:Promise<{subjectId:string}>}){try{const actor=await requireClassroomAdministrator();const {subjectId}=await params;return classroomJson(await updateSubject(prisma,actor,subjectId,await readClassroomBody(request)));}catch(error){return classroomError(error);}}
