import { setStudentWriteContext } from './studentProfileAudit';
import type { Prisma } from '@prisma/client';
import { AuthError } from './authError';
import { PUBLIC_USER_SELECT } from './credentials';
export type LegacyActor = { id: string; credentialVersion: number };
/** Acquire before roster/group locks; global disable and credential changes linearize here. */
export async function guardEventsActor(tx: Prisma.TransactionClient, actor: LegacyActor, adminOnly = false) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR SHARE`;
  const current = await tx.user.findUnique({ where: { id: actor.id }, select: PUBLIC_USER_SELECT });
  if (!current || current.credentialVersion !== actor.credentialVersion || current.accountState !== 'ENABLED' || current.mustChangePassword || current.status !== 'ACTIVE' || !['ADMIN', 'ORGANIZER'].includes(current.role)) throw new AuthError('Session no longer authorizes this operation.', 401, 'UNAUTHORIZED');
  if (adminOnly && current.role !== 'ADMIN') throw new AuthError('Administrator access required.', 403, 'FORBIDDEN');
  await setStudentWriteContext(tx,{actorId:current.id,actorName:current.name,source:current.role==='ADMIN'?'ADMIN':'EVENTS'});
  return current;
}
