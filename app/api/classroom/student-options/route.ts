import { prisma } from '@/globals/libs/prisma';
import { authorizedDirectoryRead } from '@/features/students/server/profileChanges';
import { requireClassroomActor,classroomJson,classroomError } from '@/features/classroom/server/http';
export async function GET(){try{const actor=await requireClassroomActor();return classroomJson(await authorizedDirectoryRead(prisma,actor,tx=>tx.group.findMany({where:{category:{in:['SECTION','DEPARTMENT','PROGRAM','STRAND']},slug:{not:'employees'}},select:{id:true,name:true,slug:true,category:true},orderBy:[{name:'asc'},{id:'asc'}]})));}catch(error){return classroomError(error);}}
