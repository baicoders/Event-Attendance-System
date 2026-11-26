import { prisma } from '@/globals/libs/prisma';
import { requireIdentity } from '@/globals/utils/auth';
import { saveTeacherApplication } from '@/features/classroom/server/applications';
import { classroomJson, classroomError, readClassroomBody } from '@/features/classroom/server/http';
export async function GET() {
  try {
    const user = await requireIdentity();
    return classroomJson(await prisma.classroomMembership.findUnique({ where: { userId: user.id } }));
  } catch (error) { return classroomError(error); }
}
export async function PUT(req: Request) {
  try {
    const user = await requireIdentity();
    return classroomJson(await saveTeacherApplication(prisma, { userId: user.id, credentialVersion: user.credentialVersion }, await readClassroomBody(req)));
  } catch (error) { return classroomError(error); }
}
