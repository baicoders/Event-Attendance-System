import { prisma } from '@/globals/libs/prisma';
import { getClassroomStartPreview } from '@/features/classroom/server/sessions';
import { requireClassroomActor,classroomJson,classroomError } from '@/features/classroom/server/http';
export async function GET(_request:Request,{params}:{params:Promise<{classId:string}>}){
 try{return classroomJson(await getClassroomStartPreview(prisma,await requireClassroomActor(),(await params).classId));}
 catch(error){return classroomError(error);}
}
