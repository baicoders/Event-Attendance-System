import { prisma } from '@/globals/libs/prisma';
import { classroomRouteBody } from '@/features/classroom/utils/routeBody';
import { recordClassroomScan } from '@/features/classroom/server/attendance';
import { requireClassroomActor,classroomJson,classroomError,readClassroomBody,classroomRequestLimit } from '@/features/classroom/server/http';
export async function POST(request:Request,{params}:{params:Promise<{sessionId:string}>}){
 try{
  const actor=await requireClassroomActor();await classroomRequestLimit(prisma,actor.userId,'scan');
  const body=await readClassroomBody(request);return classroomJson(await recordClassroomScan(prisma,actor,classroomRouteBody(body,{sessionId:(await params).sessionId})));
 }catch(error){return classroomError(error);}
}
