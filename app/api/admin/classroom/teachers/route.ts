import { z } from 'zod';
import { prisma } from '@/globals/libs/prisma';
import { requireAdmin } from '@/globals/utils/auth';
import { classroomJson, classroomError } from '@/features/classroom/server/http';
const schema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(100),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REVOKED']).optional(), q: z.string().trim().max(100).default('') });
export async function GET(req: Request) {
  try {
    await requireAdmin();
    const input = schema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const where = { ...(input.status ? { status: input.status } : {}), ...(input.q ? { user: { OR: [{ name: { contains: input.q, mode: 'insensitive' as const } }, { email: { contains: input.q, mode: 'insensitive' as const } }] } } : {}) };
    const result = await prisma.$transaction(async tx => ({
      items: await tx.classroomMembership.findMany({ where, include: { user: { select: { id: true, name: true, email: true, accountState: true } } }, orderBy: [{ appliedAt: 'asc' }, { userId: 'asc' }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
      total: await tx.classroomMembership.count({ where }), page: input.page, pageSize: input.pageSize,
    }), { isolationLevel: 'RepeatableRead', timeout: 5000 });
    return classroomJson(result);
  } catch (error) { return classroomError(error); }
}
