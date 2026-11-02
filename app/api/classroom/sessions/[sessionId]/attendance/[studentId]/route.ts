import { prisma } from '@/globals/libs/prisma';
import { classroomRouteBody } from '@/features/classroom/utils/routeBody';
import { setClassroomAttendance } from '@/features/classroom/server/attendance';
import { requireClassroomActor,classroomJson,classroomError,readClassroomBody } from '@/features/classroom/server/http';
export async function PUT(request:Request,{params}:{params:Promise<{sessionId:string;studentId:string}>}){
 try{
  const actor=await requireClassroomActor();const body=await readClassroomBody(request);const {sessionId,studentId}=await params;
  return classroomJson(await setClassroomAttendance(prisma,actor,classroomRouteBody(body,{sessionId,studentId})));
 }catch(error){return classroomError(error);}
}
