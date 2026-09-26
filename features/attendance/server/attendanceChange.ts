import { Prisma, type Record as AttendanceRecord } from "@prisma/client";
import { z } from "zod";

export const recordSnapshotSchema = z.strictObject({
  version: z.literal(1),
  id: z.string(),
  eventId: z.string(),
  studentId: z.string(),
  method: z.enum(["MANUAL", "SCANNED"]),
  timein: z.iso.datetime().nullable(),
  timeout: z.iso.datetime().nullable(),
  recordedById: z.string().nullable(),
  lastModifiedById: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const positiveChangeIdSchema = z.string().regex(/^[1-9][0-9]{0,18}$/)
  .refine((value) => BigInt(value) <= BigInt("9223372036854775807"));

export type RecordSnapshot = z.infer<typeof recordSnapshotSchema>;

export function snapshot(record: AttendanceRecord): RecordSnapshot {
  return recordSnapshotSchema.parse({
    version: 1,
    id: record.id,
    eventId: record.eventId,
    studentId: record.studentId,
    method: record.method,
    timein: record.timein?.toISOString() ?? null,
    timeout: record.timeout?.toISOString() ?? null,
    recordedById: record.recordedById,
    lastModifiedById: record.lastModifiedById,
    revision: record.revision,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

export function parseSnapshot(value: Prisma.JsonValue | null): RecordSnapshot | null {
  return value === null ? null : recordSnapshotSchema.parse(value);
}

type ChangeInput = {
  eventId: string;
  studentId: string;
  recordId: string;
  action: "CREATE" | "TIME_IN" | "TIME_OUT" | "CORRECT" | "VOID" | "RESTORE";
  actorId: string;
  before: AttendanceRecord | null;
  after: AttendanceRecord | null;
  reason?: string;
  commandId?: string;
  commandHash?: string;
  sourceChangeId?: bigint;
};

export async function appendAttendanceChange(tx: Prisma.TransactionClient, input: ChangeInput) {
  const event = await tx.event.findUniqueOrThrow({ where: { id: input.eventId }, select: { title: true } });
  const student = await tx.student.findUniqueOrThrow({ where: { id: input.studentId }, select: { firstName: true, middleName: true, lastName: true } });
  const actor = await tx.user.findUnique({ where: { id: input.actorId }, select: { name: true } });
  return tx.attendanceChange.create({ data: {
    eventId: input.eventId,
    studentId: input.studentId,
    recordId: input.recordId,
    action: input.action,
    actorId: input.actorId,
    actorName: actor?.name ?? null,
    eventTitle: event.title,
    studentLabel: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" "),
    reason: input.reason ?? null,
    before: input.before ? snapshot(input.before) : Prisma.DbNull,
    after: input.after ? snapshot(input.after) : Prisma.DbNull,
    commandId: input.commandId ?? null,
    commandHash: input.commandHash ?? null,
    sourceChangeId: input.sourceChangeId ?? null,
    createdAt: new Date(),
  } });
}
