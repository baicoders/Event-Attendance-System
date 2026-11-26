import 'server-only';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AuthError } from '@/globals/utils/authError';
import { teacherApplicationSchema, teacherDecisionSchema } from '../schemas/applicationSchema';
import { executeClassroomCommand } from './commands';
import type { ActorContext } from './access';

export async function saveTeacherApplication(db: PrismaClient, actor: ActorContext, raw: unknown) {
  const input = teacherApplicationSchema.parse(raw);
  return executeClassroomCommand(db, actor, 'IDENTITY_APPLICATION', { commandId: input.commandId, operation: 'TEACHER_APPLICATION', resourceId: actor.userId, payload: input }, async (tx, user) => {
    const prior = await tx.classroomMembership.findUnique({ where: { userId: user.id } });
    if (prior && prior.revision !== input.expectedRevision) throw new AuthError('Application changed. Reload before saving.', 409, 'REVISION_CONFLICT');
    if (prior && !['PENDING', 'REJECTED'].includes(prior.status)) throw new AuthError('This membership cannot be resubmitted.', 409, 'INVALID_STATUS');
    const data = { departmentOrDesignation: input.departmentOrDesignation, staffReference: input.staffReference || null, applicationText: input.applicationText,
      ...(input.action === 'SUBMIT' ? { status: 'PENDING' as const, appliedAt: new Date(), decisionReason: null, reviewedAt: null, reviewerId: null, reviewerName: null } : {}) };
    const member = prior ? await tx.classroomMembership.update({ where: { userId: user.id }, data: { ...data, revision: { increment: 1 } } }) : await tx.classroomMembership.create({ data: { userId: user.id, ...data } });
    await tx.classroomAudit.create({ data: { action: input.action === 'SUBMIT' ? 'TEACHER_APPLICATION_SUBMITTED' : 'TEACHER_APPLICATION_EDITED', entityType: 'ClassroomMembership', entityId: user.id,
      actorId: user.id, actorName: user.name, commandId: input.commandId, before: prior ? JSON.parse(JSON.stringify(prior)) : Prisma.DbNull, after: JSON.parse(JSON.stringify(member)) } });
    return member;
  }, { updateUsers: true, membershipUserIds: [actor.userId], updateMemberships: true });
}

export async function reviewTeacherApplication(db: PrismaClient, actor: ActorContext, userId: string, raw: unknown) {
  const input = teacherDecisionSchema.parse(raw);
  return executeClassroomCommand(db, actor, 'ADMIN', { commandId: input.commandId, operation: 'TEACHER_REVIEW', resourceId: userId, payload: input }, async (tx, admin) => {
    const prior = await tx.classroomMembership.findUnique({ where: { userId } });
    if (!prior) throw new AuthError('Teacher application not found.', 404, 'TEACHER_NOT_FOUND');
    if (prior.revision !== input.expectedRevision) throw new AuthError('Application changed. Reload before reviewing.', 409, 'REVISION_CONFLICT');
    const allowed = { APPROVE: ['PENDING'], REJECT: ['PENDING'], SUSPEND: ['APPROVED'], REVOKE: ['APPROVED', 'SUSPENDED'], RESTORE: ['SUSPENDED', 'REVOKED'] };
    if (!allowed[input.action].includes(prior.status)) throw new AuthError('Invalid membership transition.', 409, 'INVALID_STATUS');
    const status = { APPROVE: 'APPROVED', REJECT: 'REJECTED', SUSPEND: 'SUSPENDED', REVOKE: 'REVOKED', RESTORE: 'APPROVED' } as const;
    const updated = await tx.classroomMembership.update({ where: { userId }, data: { status: status[input.action], reviewedAt: new Date(), reviewerId: admin.id, reviewerName: admin.name,
      decisionReason: input.reason ?? null, revision: { increment: 1 } } });
    await tx.classroomAudit.create({ data: { action: `TEACHER_${input.action}`, entityType: 'ClassroomMembership', entityId: userId, actorId: admin.id, actorName: admin.name,
      commandId: input.commandId, before: JSON.parse(JSON.stringify(prior)), after: JSON.parse(JSON.stringify(updated)), reason: input.reason } });
    return updated;
  }, { userIds: [userId], updateUsers: true, membershipUserIds: [userId], updateMemberships: true });
}
