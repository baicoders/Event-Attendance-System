import { prisma } from '@/globals/libs/prisma';
import { cancelClassroomSession } from '@/features/classroom/server/sessions';
import { requireClassroomActor,classroomJson,classroomError,readClassroomBody } from '@/features/classroom/server/http';
export async function POST(request:Request,{params}:{params:Promise<{sessionId:string}>}){
 try{const actor=await requireClassroomActor();return classroomJson(await cancelClassroomSession(prisma,actor,(await params).sessionId,await readClassroomBody(request)));}
 catch(error){return classroomError(error);}
}
