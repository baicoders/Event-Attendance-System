import { prisma } from '@/globals/libs/prisma';
import { requireAdmin } from '@/globals/utils/auth';
import { reviewTeacherApplication } from '@/features/classroom/server/applications';
import { classroomJson, classroomError, readClassroomBody } from '@/features/classroom/server/http';
export async function PATCH(req: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    const user = await requireAdmin();
    const { userId } = await context.params;
    return classroomJson(await reviewTeacherApplication(prisma, { userId: user.id, credentialVersion: user.credentialVersion }, userId, await readClassroomBody(req)));
  } catch (error) { return classroomError(error); }
}

export async function GET(_req:Request,context:{params:Promise<{userId:string}>}){try{const user=await requireAdmin();const {getClassroomTeacherDetail}=await import('@/features/classroom/server/adminActivity');return classroomJson(await getClassroomTeacherDetail(prisma,{userId:user.id,credentialVersion:user.credentialVersion},(await context.params).userId));}catch(error){return classroomError(error);}}
