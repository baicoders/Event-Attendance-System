import { prisma } from '@/globals/libs/prisma';
import { requireIdentity } from '@/globals/utils/auth';
import { requestEventsAccess } from '@/features/auth/server/eventsApplication';
import { classroomJson, classroomError, readClassroomBody } from '@/features/classroom/server/http';
export async function POST(req: Request) {
  try {
    const user = await requireIdentity();
    return classroomJson(await requestEventsAccess(prisma, { userId: user.id, credentialVersion: user.credentialVersion }, await readClassroomBody(req)));
  } catch (error) { return classroomError(error); }
}
