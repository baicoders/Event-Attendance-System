import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { buildEventStudentFilter } from "@/globals/utils/buildEventStudentFilter";
import { CorrectionError } from "./correctAttendance";
import { parseSnapshot, positiveChangeIdSchema } from "./attendanceChange";

export const reviewQuerySchema = z.object({
  search: z.string().max(100).default(""),
  state: z.enum(["all", "recorded", "voided"]).default("all"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});
export type ReviewQuery = z.infer<typeof reviewQuerySchema>;

type Viewer = { id: string; credentialVersion: number };

async function loadManagerEvent(db: Prisma.TransactionClient, eventId: string, viewer: Viewer) {
  await db.$queryRaw`SELECT id FROM "User" WHERE id = ${viewer.id} FOR SHARE`;
  const actor = await db.user.findUnique({ where: { id: viewer.id }, select: { id: true, role: true, status: true, mustChangePassword: true, credentialVersion: true } });
  if (!actor || actor.status !== "ACTIVE" || actor.mustChangePassword || actor.credentialVersion !== viewer.credentialVersion) throw new CorrectionError("Unauthorized", 401, "UNAUTHORIZED");
  const event = await db.event.findUnique({ where: { id: eventId }, include: { includedGroups: true } });
  if (!event) throw new CorrectionError("Event not found", 404, "EVENT_NOT_FOUND");
  if (actor.role !== "ADMIN" && event.createdById !== actor.id) throw new CorrectionError("Forbidden", 403, "FORBIDDEN");
  return event;
}

export async function listAttendanceReview(db: PrismaClient, eventId: string, viewer: Viewer, rawQuery: unknown) {
  const query = reviewQuerySchema.parse(rawQuery);
  return db.$transaction(async (tx) => {
  const event = await loadManagerEvent(tx, eventId, viewer);
  const current: Prisma.StudentWhereInput = { records: { some: { eventId } } };
  const historical: Prisma.StudentWhereInput = { attendanceChanges: { some: { eventId } } };
  const evidence: Prisma.StudentWhereInput = query.state === "recorded" ? current
    : query.state === "voided" ? { AND: [{ records: { none: { eventId } } }, historical] }
    : { OR: [current, historical] };
  const nameTerms = query.search.trim().split(/\s+/).filter(Boolean);
  const where: Prisma.StudentWhereInput = { AND: [evidence, ...nameTerms.map((term): Prisma.StudentWhereInput => ({ OR: [
    { id: { contains: term } }, { firstName: { contains: term, mode: "insensitive" } },
    { middleName: { contains: term, mode: "insensitive" } }, { lastName: { contains: term, mode: "insensitive" } },
  ] }))] };
  const total = await tx.student.count({ where });
  const students = await tx.student.findMany({ where, orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * query.pageSize, take: query.pageSize,
      select: { id: true, firstName: true, middleName: true, lastName: true,
        records: { where: { eventId }, take: 1 },
        attendanceChanges: { where: { eventId }, orderBy: { id: "desc" }, take: 1,
          select: { id: true, action: true, createdAt: true } },
      } });
  const eligible = students.length ? await tx.student.findMany({ where: { id: { in: students.map((item) => item.id) }, ...buildEventStudentFilter(event) }, select: { id: true } }) : [];
  const eligibleIds = new Set(eligible.map((item) => item.id));
  return { eventId, eventTitle: event.title, page: query.page, pageSize: query.pageSize, total,
    items: students.map((student) => ({
      studentId: student.id, studentLabel: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" "),
      record: student.records[0] ?? null, latestAction: student.attendanceChanges[0]?.action ?? null,
      latestChangeId: student.attendanceChanges[0]?.id.toString() ?? null,
      latestChangedAt: student.attendanceChanges[0]?.createdAt ?? null,
      inCurrentAudience: eligibleIds.has(student.id),
    })) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 5000 });
}

export async function getAttendanceHistory(db: PrismaClient, eventId: string, studentId: string, viewer: Viewer, rawPaging: unknown) {
  const paging = z.object({ beforeId: positiveChangeIdSchema.optional(), limit: z.number().int().min(1).max(100).default(25) }).parse(rawPaging);
  return db.$transaction(async (tx) => {
  const event = await loadManagerEvent(tx, eventId, viewer);
  const student = await tx.student.findUnique({ where: { id: studentId }, select: { id: true, firstName: true, middleName: true, lastName: true } });
  if (!student) throw new CorrectionError("Student not found", 404, "STUDENT_NOT_FOUND");
  const record = await tx.record.findUnique({ where: { eventId_studentId: { eventId, studentId } } });
  const eligible = await tx.student.findFirst({ where: { id: studentId, ...buildEventStudentFilter(event) }, select: { id: true } });
  const rows = await tx.attendanceChange.findMany({ where: { eventId, studentId, ...(paging.beforeId ? { id: { lt: BigInt(paging.beforeId) } } : {}) },
      orderBy: { id: "desc" }, take: paging.limit + 1 });
  const page = rows.slice(0, paging.limit);
  return { eventId, studentId, eventTitle: event.title, eventStart: event.start, eventEnd: event.end,
    studentLabel: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" "),
    inCurrentAudience: !!eligible, record,
    changes: page.map((change) => ({ id: change.id.toString(), action: change.action, recordId: change.recordId,
      actorId: change.actorId, actorName: change.actorName, reason: change.reason,
      before: parseSnapshot(change.before), after: parseSnapshot(change.after),
      sourceChangeId: change.sourceChangeId?.toString() ?? null, createdAt: change.createdAt })),
    nextBeforeId: rows.length > paging.limit ? page.at(-1)!.id.toString() : null,
    earlierHistoryUnavailable: true,
  };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 5000 });
}
