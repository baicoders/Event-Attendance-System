import { createHash } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { buildEventStudentFilter } from "@/globals/utils/buildEventStudentFilter";
import { takeCommandLock, takeRecordPairLock, takeRosterSharedLock } from "@/globals/utils/pgLocks";
import { isRetryableTransactionError } from "@/globals/utils/prismaError";
import { appendAttendanceChange, parseSnapshot, positiveChangeIdSchema, type RecordSnapshot } from "./attendanceChange";

const reason = z.string().trim().min(5).max(1000);
const common = { commandId: z.uuid(), studentId: z.string().min(1) };
const timestamp = z.iso.datetime({ offset: true });
export const correctionCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...common, action: z.literal("CORRECT"), recordId: z.string().min(1), expectedRevision: z.number().int().nonnegative(), timein: timestamp.nullable(), timeout: timestamp.nullable(), reason }),
  z.strictObject({ ...common, action: z.literal("VOID"), recordId: z.string().min(1), expectedRevision: z.number().int().nonnegative(), reason }),
  z.strictObject({ ...common, action: z.literal("RESTORE"), sourceChangeId: positiveChangeIdSchema, reason }),
]);
export type CorrectionCommand = z.infer<typeof correctionCommandSchema>;

export class CorrectionError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
    this.name = "CorrectionError";
  }
}

export type CorrectionReceipt = {
  eventId: string;
  studentId: string;
  changeId: string;
  commandId: string;
  action: CorrectionCommand["action"];
  before: RecordSnapshot | null;
  after: RecordSnapshot | null;
  replayed: boolean;
};

function hashCommand(eventId: string, actorId: string, command: CorrectionCommand) {
  return createHash("sha256").update(JSON.stringify([eventId, actorId, command])).digest("hex");
}

function receipt(change: { id: bigint; eventId: string; studentId: string; commandId: string | null; action: string; before: Prisma.JsonValue | null; after: Prisma.JsonValue | null }, replayed: boolean): CorrectionReceipt {
  return { eventId: change.eventId, studentId: change.studentId, changeId: change.id.toString(),
    commandId: change.commandId!, action: change.action as CorrectionCommand["action"],
    before: parseSnapshot(change.before), after: parseSnapshot(change.after), replayed };
}

export async function correctAttendance(db: PrismaClient, eventId: string, rawCommand: unknown, actor: { id: string; credentialVersion: number }): Promise<CorrectionReceipt> {
  const command = correctionCommandSchema.parse(rawCommand);
  const actorId = actor.id;
  const commandHash = hashCommand(eventId, actorId, command);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId} FOR SHARE`;
    const freshActor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, status: true, mustChangePassword: true, credentialVersion: true } });
    if (!freshActor || freshActor.status !== "ACTIVE" || freshActor.mustChangePassword || freshActor.credentialVersion !== actor.credentialVersion) throw new CorrectionError("Unauthorized", 401, "UNAUTHORIZED");
    await takeCommandLock(tx, command.commandId);
    await takeRosterSharedLock(tx);
    await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR SHARE`;
    const event = await tx.event.findUnique({ where: { id: eventId }, include: { includedGroups: true } });
    if (!event) throw new CorrectionError("Event not found", 404, "EVENT_NOT_FOUND");
    if (freshActor.role !== "ADMIN" && event.createdById !== actor.id) throw new CorrectionError("Forbidden", 403, "FORBIDDEN");

    const prior = await tx.attendanceChange.findUnique({ where: { actorId_commandId: { actorId, commandId: command.commandId } } });
    if (prior) {
      if (prior.commandHash !== commandHash || prior.actorId !== actorId || prior.eventId !== eventId) {
        throw new CorrectionError("Command ID was already used", 409, "COMMAND_ID_REUSED");
      }
      return receipt(prior, true);
    }

    if (command.action !== "VOID" && event.status !== "APPROVED") throw new CorrectionError("Invalid event status", 409, "INVALID_STATUS");
    await takeRecordPairLock(tx, eventId, command.studentId);
    const current = await tx.record.findUnique({ where: { eventId_studentId: { eventId, studentId: command.studentId } } });

    if (command.action === "RESTORE") {
      if (current) throw new CorrectionError("New attendance already exists", 409, "RESTORE_CONFLICT");
      const source = await tx.attendanceChange.findUnique({ where: { id: BigInt(command.sourceChangeId) } });
      const latest = await tx.attendanceChange.findFirst({ where: { eventId, studentId: command.studentId }, orderBy: { id: "desc" } });
      if (!source || source.eventId !== eventId || source.studentId !== command.studentId || source.action !== "VOID" || latest?.id !== source.id) {
        throw new CorrectionError("Void is no longer restorable", 409, "RESTORE_CONFLICT");
      }
      let before: RecordSnapshot | null;
      try { before = parseSnapshot(source.before); }
      catch { throw new CorrectionError("Voided evidence needs manual review", 409, "INVALID_HISTORICAL_RECORD"); }
      if (!before || before.id !== source.recordId || before.eventId !== eventId || before.studentId !== command.studentId ||
        (!before.timein && !before.timeout) ||
        (before.timein && new Date(before.timein).getTime() > Date.now()) ||
        (before.timeout && (new Date(before.timeout).getTime() > Date.now() || (before.timein && before.timeout < before.timein)))) {
        throw new CorrectionError("Voided evidence needs manual review", 409, "INVALID_HISTORICAL_RECORD");
      }
      const eligible = await tx.student.findFirst({ where: { id: command.studentId, ...buildEventStudentFilter(event) }, select: { id: true } });
      if (!eligible) throw new CorrectionError("Student is not included in the event", 409, "STUDENT_UNAVAILABLE");
      const originalActor = before.recordedById ? await tx.user.findUnique({ where: { id: before.recordedById }, select: { id: true } }) : null;
      const restored = await tx.record.create({ data: {
        eventId, studentId: command.studentId, method: before.method,
        timein: before.timein ? new Date(before.timein) : null, timeout: before.timeout ? new Date(before.timeout) : null,
        recordedById: originalActor?.id ?? null, lastModifiedById: actorId, revision: 1,
      } });
      const change = await appendAttendanceChange(tx, { eventId, studentId: command.studentId, recordId: restored.id,
        action: "RESTORE", actorId, before: null, after: restored, reason: command.reason,
        commandId: command.commandId, commandHash, sourceChangeId: source.id });
      return receipt(change, false);
    }

    if (current && current.id !== command.recordId) {
      throw new CorrectionError("Attendance was replaced; refresh before saving", 409, "RECORD_ALREADY_REPLACED");
    }
    if (!current || current.revision !== command.expectedRevision) {
      throw new CorrectionError("Attendance changed; refresh before saving", 409, "RECORD_CHANGED");
    }
    if (command.action === "VOID") {
      const deleted = await tx.record.deleteMany({ where: { id: current.id, eventId, studentId: command.studentId, revision: command.expectedRevision } });
      if (!deleted.count) throw new CorrectionError("Attendance changed; refresh before saving", 409, "RECORD_CHANGED");
      const change = await appendAttendanceChange(tx, { eventId, studentId: command.studentId, recordId: current.id,
        action: "VOID", actorId, before: current, after: null, reason: command.reason,
        commandId: command.commandId, commandHash });
      return receipt(change, false);
    }

    const timein = command.timein ? new Date(command.timein) : null;
    const timeout = command.timeout ? new Date(command.timeout) : null;
    if ((!timein && !timeout) || (timein && timein.getTime() > Date.now()) ||
      (timeout && timeout.getTime() > Date.now()) || (timein && timeout && timeout < timein)) {
      throw new CorrectionError("Invalid attendance timestamps", 400, "INVALID_TIMESTAMP");
    }
    if ((current.timein?.getTime() ?? null) === (timein?.getTime() ?? null) && (current.timeout?.getTime() ?? null) === (timeout?.getTime() ?? null)) {
      throw new CorrectionError("No attendance change requested", 400, "NO_CHANGE");
    }
    const changed = await tx.record.updateMany({ where: { id: current.id, eventId, studentId: command.studentId, revision: command.expectedRevision },
      data: { timein, timeout, lastModifiedById: actorId, revision: { increment: 1 } } });
    if (!changed.count) throw new CorrectionError("Attendance changed; refresh before saving", 409, "RECORD_CHANGED");
    const updated = await tx.record.findUniqueOrThrow({ where: { id: current.id } });
    const change = await appendAttendanceChange(tx, { eventId, studentId: command.studentId, recordId: current.id,
      action: "CORRECT", actorId, before: current, after: updated, reason: command.reason,
      commandId: command.commandId, commandHash });
    return receipt(change, false);
      }, { maxWait: 2000, timeout: 5000 });
    } catch (error) {
      if (error instanceof CorrectionError) throw error;
      if (isRetryableTransactionError(error) && attempt === 0) { lastError = error; continue; }
      throw error;
    }
  }
  throw lastError;
}
