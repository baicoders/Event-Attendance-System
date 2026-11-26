import { prisma } from '@/globals/libs/prisma';
import { updateAcademicTerm } from '@/features/classroom/server/catalog';
import { requireClassroomAdministrator,classroomJson,classroomError,readClassroomBody } from '@/features/classroom/server/http';
export async function PATCH(request:Request,{params}:{params:Promise<{termId:string}>}){try{const actor=await requireClassroomAdministrator();const {termId}=await params;return classroomJson(await updateAcademicTerm(prisma,actor,termId,await readClassroomBody(request)));}catch(error){return classroomError(error);}}
