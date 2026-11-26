import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AuthError } from '@/globals/utils/authError';
import { executeClassroomCommand } from '@/features/classroom/server/commands';
import { commandIdSchema } from '@/features/classroom/schemas/commandId';
import type { ActorContext } from '@/features/classroom/server/access';
const schema = z.object({ commandId: commandIdSchema }).strict();
/** Join the existing organizer approval flow without touching Classroom membership. */
export function requestEventsAccess(db: PrismaClient, actor: ActorContext, raw: unknown) {
  const input = schema.parse(raw);
  return executeClassroomCommand(db, actor, 'IDENTITY_APPLICATION', { commandId: input.commandId, operation: 'EVENTS_APPLICATION', resourceId: actor.userId, payload: input }, async (tx, user) => {
    if (user.role !== 'MEMBER') throw new AuthError('Events access was already requested.', 409, 'EVENTS_ALREADY_REQUESTED');
    await tx.user.update({ where: { id: user.id }, data: { role: 'ORGANIZER', status: 'PENDING', rejectionReason: null } });
    const result = { userId: user.id, role: 'ORGANIZER' as const, status: 'PENDING' as const };
    await tx.classroomAudit.create({ data: { action: 'EVENTS_APPLICATION_SUBMITTED', entityType: 'User', entityId: user.id, actorId: user.id, actorName: user.name, commandId: input.commandId,
      before: { role: user.role, status: user.status }, after: result } });
    return result;
  }, { updateUsers: true });
}
