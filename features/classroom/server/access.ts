import 'server-only';
import type { Prisma,PrismaClient } from '@prisma/client';
import { takeRosterSharedLock } from '@/globals/utils/pgLocks';
import { AuthError } from '@/globals/utils/authError';
import { workspaceCapabilities } from '@/features/auth/utils/accessPolicy';

export type ActorContext = { userId: string; credentialVersion: number };
export type CommandPolicy = 'IDENTITY_APPLICATION' | 'APPROVED_CLASSROOM' | 'EVENTS_DIRECTORY' | 'ADMIN';
export const PUBLIC_IDENTITY_SELECT = {
  id: true, name: true, email: true, role: true, status: true, accountState: true,
  rejectionReason: true, mustChangePassword: true, credentialVersion: true,
} as const;
/** Caller holds the User row lock. The DB is authority; no cookie grant is trusted. */
export async function guardCommandActor(tx: Prisma.TransactionClient, actor: ActorContext, policy: CommandPolicy) {
  const user = await tx.user.findUnique({ where: { id: actor.userId }, select: PUBLIC_IDENTITY_SELECT });
  if (!user || user.credentialVersion !== actor.credentialVersion) throw new AuthError('Session expired. Sign in again.', 401, 'UNAUTHORIZED');
  if (user.accountState !== 'ENABLED') throw new AuthError('Account disabled.', 403, 'ACCOUNT_DISABLED');
  if (user.mustChangePassword) throw new AuthError('Choose a new password first.', 403, 'PASSWORD_CHANGE_REQUIRED');
  let membership = null;
  if (policy === 'APPROVED_CLASSROOM') {
    await tx.$queryRaw`SELECT "userId" FROM "ClassroomMembership" WHERE "userId" = ${user.id} FOR SHARE`;
    membership = await tx.classroomMembership.findUnique({ where: { userId: user.id } });
  }
  const capabilities = workspaceCapabilities(user, membership?.status);
  if (policy === 'ADMIN' && !capabilities.admin) throw new AuthError('Administrator access required.', 403, 'FORBIDDEN');
  if (policy === 'EVENTS_DIRECTORY' && !capabilities.events) throw new AuthError('Events access required.', 403, 'EVENTS_ACCESS_REQUIRED');
  if (policy === 'APPROVED_CLASSROOM' && !capabilities.classroom) throw new AuthError('Classroom access is unavailable.', 403,
    membership?.status === 'SUSPENDED' || membership?.status === 'REVOKED' ? 'CLASSROOM_SUSPENDED' : 'CLASSROOM_ACCESS_REQUIRED');
  return user;
}
export async function guardClassroomActor(tx: Prisma.TransactionClient, actor: ActorContext) {
  return guardCommandActor(tx, actor, 'APPROVED_CLASSROOM');
}

export type ClassroomUser=Awaited<ReturnType<typeof guardClassroomActor>>;
export function classroomAdministrator(user:ClassroomUser){return workspaceCapabilities(user).admin;}
/** Read grants remain locked until all scoped data has been collected. */
export async function classroomRead<T>(db:PrismaClient,actor:ActorContext,read:(tx:Prisma.TransactionClient,user:ClassroomUser)=>Promise<T>,options:{roster?:boolean}={}){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.userId} FOR SHARE`;
  const user=await guardClassroomActor(tx,actor);
  if(options.roster)await takeRosterSharedLock(tx);
  return read(tx,user);
 },{timeout:10000});
}
