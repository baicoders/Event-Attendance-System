import { PrismaClient } from "@prisma/client";
import { appendAttendanceChange } from "./attendanceChange";
import { RecordingError } from "./recordAttendance";
import { takeRecordPairLock, takeRosterSharedLock } from "@/globals/utils/pgLocks";
import { isRetryableTransactionError } from "@/globals/utils/prismaError";
import { buildEventStudentFilter } from "@/globals/utils/buildEventStudentFilter";

export async function fillRecordById(db: PrismaClient, recordId: string, actor: { id: string; credentialVersion: number }) {
  const target = await db.record.findUnique({ where: { id: recordId }, select: { eventId: true, studentId: true } });
  if (!target) throw new RecordingError("Record not found", 404, "RECORD_NOT_FOUND");
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR SHARE`;
    const freshActor = await tx.user.findUnique({ where: { id: actor.id }, select: { id: true, role: true, status: true, mustChangePassword: true, credentialVersion: true } });
    if (!freshActor || freshActor.status !== "ACTIVE" || freshActor.mustChangePassword || freshActor.credentialVersion !== actor.credentialVersion) throw new RecordingError("Unauthorized", 401, "UNAUTHORIZED");
    await takeRosterSharedLock(tx);
    await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${target.eventId} FOR SHARE`;
    const event = await tx.event.findUnique({ where: { id: target.eventId }, include: { includedGroups: true } });
    if (!event) throw new RecordingError("Record not found", 404, "RECORD_NOT_FOUND");
    if (freshActor.role !== "ADMIN" && event.createdById !== actor.id && event.status !== "APPROVED") throw new RecordingError("Forbidden", 403, "FORBIDDEN");
    if (event.status !== "APPROVED") throw new RecordingError("Invalid event status", 409, "INVALID_STATUS");
    await takeRecordPairLock(tx, target.eventId, target.studentId);
    const record = await tx.record.findUnique({ where: { id: recordId } });
    if (!record || record.eventId !== target.eventId || record.studentId !== target.studentId) throw new RecordingError("Record not found", 404, "RECORD_NOT_FOUND");
    const eligible = await tx.student.findFirst({ where: { id: record.studentId, ...buildEventStudentFilter(event) }, select: { id: true } });
    if (!eligible) throw new RecordingError("Student is not included in the event.", 404, "STUDENT_UNAVAILABLE");
    const field = event.isTimeout ? "timeout" : "timein";
    if (record[field]) return { record, changed: false };
    const changed = await tx.record.updateMany({ where: { id: record.id, revision: record.revision, [field]: null },
      data: { [field]: new Date(), lastModifiedById: actor.id, revision: { increment: 1 } } });
    const current = await tx.record.findUniqueOrThrow({ where: { id: record.id } });
    if (changed.count) await appendAttendanceChange(tx, { eventId: record.eventId, studentId: record.studentId,
      recordId: record.id, action: event.isTimeout ? "TIME_OUT" : "TIME_IN", actorId: actor.id, before: record, after: current });
    return { record: current, changed: changed.count > 0 };
      }, { maxWait: 2000, timeout: 5000 });
    } catch (error) {
      if (error instanceof RecordingError) throw error;
      if (isRetryableTransactionError(error) && attempt === 0) { lastError = error; continue; }
      throw error;
    }
  }
  throw lastError;
}
