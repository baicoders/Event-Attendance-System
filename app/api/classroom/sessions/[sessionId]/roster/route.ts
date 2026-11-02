import { prisma } from '@/globals/libs/prisma';
import { getSessionRoster } from '@/features/classroom/server/sessions';
import { requireClassroomActor,classroomJson,classroomError } from '@/features/classroom/server/http';
export async function GET(request:Request,{params}:{params:Promise<{sessionId:string}>}){
 try{return classroomJson(await getSessionRoster(prisma,await requireClassroomActor(),(await params).sessionId,new URL(request.url).searchParams));}
 catch(error){return classroomError(error);}
}
