import { prisma } from '@/globals/libs/prisma';
import { listClassroomSessions,startClassroomSession } from '@/features/classroom/server/sessions';
import { requireClassroomActor,classroomJson,classroomError,readClassroomBody } from '@/features/classroom/server/http';
export async function GET(request:Request,{params}:{params:Promise<{classId:string}>}){
 try{return classroomJson(await listClassroomSessions(prisma,await requireClassroomActor(),(await params).classId,new URL(request.url).searchParams));}
 catch(error){return classroomError(error);}
}
export async function POST(request:Request,{params}:{params:Promise<{classId:string}>}){
 try{const actor=await requireClassroomActor();return classroomJson(await startClassroomSession(prisma,actor,(await params).classId,await readClassroomBody(request)),201);}
 catch(error){return classroomError(error);}
}
