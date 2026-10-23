import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { takeRosterExclusiveLock } from '@/globals/utils/pgLocks';

export class CustomGroupError extends Error {
  constructor(message: string, public status = 409, public code = 'CUSTOM_GROUP_CONFLICT') { super(message); }
}
type Actor = { id: string; credentialVersion: number };

// Match the existing guarded roster write protocol. Re-read authorization after
// locking the actor so a concurrent demotion/password change cannot authorize a write.
async function guardedWrite<T>(db: PrismaClient, actor: Actor, write: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR SHARE`;
    const current = await tx.user.findUnique({where:{id:actor.id},select:{role:true,status:true,mustChangePassword:true,credentialVersion:true}});
    if (!current || current.status !== 'ACTIVE' || current.mustChangePassword || current.credentialVersion !== actor.credentialVersion)
      throw new CustomGroupError('Unauthorized',401,'UNAUTHORIZED');
    if (current.role !== 'ADMIN') throw new CustomGroupError('Forbidden',403,'FORBIDDEN');
    await takeRosterExclusiveLock(tx);
    return write(tx);
  }, { maxWait: 10000, timeout: 10000 });
}
async function customGroup(tx: Prisma.TransactionClient, groupId: string) {
  const group = await tx.group.findFirst({where:{id:groupId,category:'CUSTOM'}});
  if (!group) throw new CustomGroupError('Custom group not found.',404,'NOT_FOUND');
  return group;
}
export function createCustomGroup(db: PrismaClient, name: string, actor: Actor) {
  return guardedWrite(db,actor,async tx => {
    if (await tx.group.findFirst({where:{category:'CUSTOM',name:{equals:name,mode:'insensitive'}}}))
      throw new CustomGroupError('A custom group with that name already exists.');
    const base=name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,45).replace(/-$/,'');
    let slug=`custom-${base || randomUUID()}`;
    if (await tx.group.findUnique({where:{slug}})) slug=`${slug}-${randomUUID().slice(0,8)}`;
    return tx.group.create({data:{name,slug,category:'CUSTOM'}});
  });
}
export function renameCustomGroup(db: PrismaClient, groupId: string, name: string, actor: Actor) {
  return guardedWrite(db,actor,async tx => {
    await customGroup(tx,groupId);
    if (await tx.group.findFirst({where:{id:{not:groupId},category:'CUSTOM',name:{equals:name,mode:'insensitive'}}}))
      throw new CustomGroupError('A custom group with that name already exists.');
    return tx.group.update({where:{id:groupId},data:{name}});
  });
}
export function addCustomMember(db: PrismaClient, groupId: string, studentId: string, position: string | null | undefined, actor: Actor) {
  return guardedWrite(db,actor,async tx => {
    await customGroup(tx,groupId);
    if (!await tx.student.findUnique({where:{id:studentId},select:{id:true}}))
      throw new CustomGroupError('Student not found.',404,'NOT_FOUND');
    const existing=await tx.customGroupMembership.findUnique({where:{studentId},include:{group:{select:{name:true}}}});
    if (existing && existing.groupId !== groupId)
      throw new CustomGroupError(`Student is already assigned to ${existing.group.name}. Remove that membership before assigning another custom group.`,409,'MEMBERSHIP_CONFLICT');
    // Adding twice is idempotent. Editing positions has its own explicit action.
    if (existing) return existing;
    return tx.customGroupMembership.create({data:{studentId,groupId,position}});
  });
}
export function updateCustomPosition(db: PrismaClient, groupId: string, studentId: string, position: string | null, actor: Actor) {
  return guardedWrite(db,actor,async tx => {
    await customGroup(tx,groupId);
    const changed=await tx.customGroupMembership.updateMany({where:{groupId,studentId},data:{position}});
    if (!changed.count) throw new CustomGroupError('Membership not found.',404,'NOT_FOUND');
    return tx.customGroupMembership.findUniqueOrThrow({where:{studentId_groupId:{studentId,groupId}}});
  });
}
export function removeCustomMember(db: PrismaClient, groupId: string, studentId: string, actor: Actor) {
  return guardedWrite(db,actor,async tx => {
    await customGroup(tx,groupId);
    // This operation deliberately writes only membership rows. Historical
    // Record and AttendanceChange rows are untouched as eligibility changes live.
    return tx.customGroupMembership.deleteMany({where:{groupId,studentId}});
  });
}
