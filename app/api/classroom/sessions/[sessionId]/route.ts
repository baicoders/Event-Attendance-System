import { prisma } from '@/globals/libs/prisma';
import { getClassroomSession } from '@/features/classroom/server/sessions';
import { requireClassroomActor,classroomJson,classroomError } from '@/features/classroom/server/http';
export async function GET(_request:Request,{params}:{params:Promise<{sessionId:string}>}){
 try{return classroomJson(await getClassroomSession(prisma,await requireClassroomActor(),(await params).sessionId));}
 catch(error){return classroomError(error);}
}
