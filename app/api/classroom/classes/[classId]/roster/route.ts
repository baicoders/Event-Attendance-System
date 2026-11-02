import { prisma } from '@/globals/libs/prisma';
import { getClassRoster,saveClassRoster } from '@/features/classroom/server/rosters';
import { rosterSchema } from '@/features/classroom/schemas/rosterSchema';
import { requireClassroomActor,classroomJson,classroomError,readClassroomBody } from '@/features/classroom/server/http';
type Context={params:Promise<{classId:string}>};
export async function GET(request:Request,{params}:Context){try{const actor=await requireClassroomActor();const {classId}=await params;return classroomJson(await getClassRoster(prisma,actor,classId,new URL(request.url).searchParams));}catch(error){return classroomError(error);}}
export async function PUT(request:Request,{params}:Context){try{const actor=await requireClassroomActor();const {classId}=await params;const body=rosterSchema.parse(await readClassroomBody(request,256*1024));return classroomJson(await saveClassRoster(prisma,actor,{...body,classId}));}catch(error){return classroomError(error);}}
