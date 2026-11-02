import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { commandIdSchema } from '../schemas/commandId';
import { AuthError } from '@/globals/utils/authError';
import { takeCommandLock } from '@/globals/utils/pgLocks';
import { isRetryableTransactionError } from '@/globals/utils/prismaError';
import { guardCommandActor, type ActorContext, type CommandPolicy } from './access';

export type CommandEnvelope = { commandId: string; operation: string; resourceId: string; payload: unknown };
export type CommandResult<T> = { data: T; replayed: boolean };
function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, normalize(v)]));
  return value;
}
export function commandHash(input: unknown) {
  return createHash('sha256').update(JSON.stringify(normalize(input))).digest('hex');
}
/** Stores the result atomically with domain changes; never retries an unknown commit. */
export async function executeClassroomCommand<T>(
  db: PrismaClient, actor: ActorContext, policy: CommandPolicy, raw: CommandEnvelope,
  operation: (tx: Prisma.TransactionClient, user: Awaited<ReturnType<typeof guardCommandActor>>) => Promise<T>,
  options: { httpStatus?: number; authorizeReplay?: (tx: Prisma.TransactionClient, user: Awaited<ReturnType<typeof guardCommandActor>>, result: Prisma.JsonValue) => Promise<void>; userIds?: string[]; updateUsers?: boolean; membershipUserIds?: string[]; updateMemberships?: boolean; authorizeResource?: (tx: Prisma.TransactionClient, user: Awaited<ReturnType<typeof guardCommandActor>>) => Promise<void>; timeout?: number } = {},
): Promise<CommandResult<T>> {
  const commandId = commandIdSchema.parse(raw.commandId);
  const input = { ...raw, commandId };
  const hash = commandHash({ ...input, actorId: actor.userId, policy });
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '1500ms'`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '8000ms'`;
        for (const id of [...new Set([actor.userId, ...options.userIds ?? []])].sort()) {
          if (options.updateUsers) await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
          else await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR SHARE`;
        }
        for (const id of [...new Set(options.membershipUserIds ?? [])].sort()) {
          if (options.updateMemberships) await tx.$queryRaw`SELECT "userId" FROM "ClassroomMembership" WHERE "userId" = ${id} FOR UPDATE`;
          else await tx.$queryRaw`SELECT "userId" FROM "ClassroomMembership" WHERE "userId" = ${id} FOR SHARE`;
        }
        const user = await guardCommandActor(tx, actor, policy);
        await takeCommandLock(tx, `classroom-command:${actor.userId}:${commandId}`);
        // Resource authorization must run even on replay; lifecycle/revision checks belong in operation.
        await options.authorizeResource?.(tx, user);
        const prior = await tx.classroomCommandReceipt.findUnique({ where: { actorId_commandId: { actorId: actor.userId, commandId } } });
        if (prior) {
          if (prior.requestHash !== hash) throw new AuthError('Command ID already used for another request.', 409, 'COMMAND_REUSED');
          await options.authorizeReplay?.(tx, user, prior.result);
          return { data: prior.result as T, replayed: true };
        }
        const data = await operation(tx, user);
        // JSON serialization is also the wire contract, so initial and replayed responses agree.
        const result = JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
        await tx.classroomCommandReceipt.create({ data: { actorId: actor.userId, commandId, operation: raw.operation, resourceId: raw.resourceId, requestHash: hash, result, httpStatus: options.httpStatus ?? 200 } });
        return { data: result as T, replayed: false };
      }, { maxWait: 1500, timeout: options.timeout ?? 5000 });
    } catch (error) {
      if (attempt === 0 && isRetryableTransactionError(error)) continue;
      throw error;
    }
  }
}
