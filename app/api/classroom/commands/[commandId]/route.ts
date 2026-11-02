import { prisma } from '@/globals/libs/prisma';
import { readAttendanceCommand } from '@/features/classroom/server/attendance';
import { requireClassroomActor,classroomJson,classroomError } from '@/features/classroom/server/http';
export async function GET(_request:Request,{params}:{params:Promise<{commandId:string}>}){
 try{return classroomJson(await readAttendanceCommand(prisma,await requireClassroomActor(),(await params).commandId));}
 catch(error){return classroomError(error);}
}
