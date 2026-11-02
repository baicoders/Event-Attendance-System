import { prisma } from '@/globals/libs/prisma';
import { classroomRouteBody } from '@/features/classroom/utils/routeBody';
import { adjustSessionRoster } from '@/features/classroom/server/attendance';
import { requireClassroomActor,classroomJson,classroomError,readClassroomBody } from '@/features/classroom/server/http';
export async function POST(request:Request,{params}:{params:Promise<{sessionId:string}>}){
 try{
  const actor=await requireClassroomActor();const body=await readClassroomBody(request);
  return classroomJson(await adjustSessionRoster(prisma,actor,classroomRouteBody(body,{sessionId:(await params).sessionId})));
 }catch(error){return classroomError(error);}
}
