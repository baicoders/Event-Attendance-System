import { prisma } from '@/globals/libs/prisma';
import { getTeacherOnboarding,saveTeacherOnboarding } from '@/features/classroom/server/onboarding';
import { requireClassroomActor,classroomJson,classroomError,readClassroomBody } from '@/features/classroom/server/http';
export async function GET(){
  try{return classroomJson(await getTeacherOnboarding(prisma,await requireClassroomActor()));}
  catch(error){return classroomError(error);}
}
export async function PUT(request:Request){
  try{const actor=await requireClassroomActor();return classroomJson(await saveTeacherOnboarding(prisma,actor,await readClassroomBody(request)));}
  catch(error){return classroomError(error);}
}
