import { PrismaClient, type Record as AttendanceRecord } from "@prisma/client";
import { buildEventStudentFilter } from "@/globals/utils/buildEventStudentFilter";
import {
  takeRecordPairLock,
  takeRosterSharedLock,
} from "@/globals/utils/pgLocks";
import { isRetryableTransactionError } from "@/globals/utils/prismaError";

export type AttendanceMode = "TIME_IN" | "TIME_OUT";

export type RecordAttendanceInput = {
  eventId: string;
  studentId: string;
  method: "MANUAL" | "SCANNED";
  expectedMode?: AttendanceMode;
};

type Actor = { id: string; role: "ADMIN" | "ORGANIZER" };

export class RecordingError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
    this.name = "RecordingError";
  }
}

export type RecordAttendanceResult = {
  record: AttendanceRecord;
  changed: boolean;
  operation: AttendanceMode;
  created: boolean;
};

/**
 * PostgreSQL guarded-write protocol (issue #51 §4).
 *
 * 1. Bounded Read Committed transaction.
 * 2. Shared roster-state advisory lock — freezes eligibility across the write
 *    without making different-student scans exclusive with each other.
 * 3. `SELECT ... FOR SHARE` on the Event row (recording takes SHARE; mode
 *    mutations take UPDATE, so scans linearize against mode changes).
 * 4. Re-read event/permission/mode after locking.
 * 5. Exclusive transaction-scoped advisory lock for the (eventId, studentId)
 *    pair, including when no Record exists.
 * 6. Existing create/conditional-update logic with unique + affected-row checks.
 *
 * Retries the whole transaction once after a confirmed rollback for a
 * classified serialization/deadlock error only — never for unique,
 * validation, auth or unknown transport failures.
 */
export async function recordAttendance(
  db: PrismaClient,
  input: RecordAttendanceInput,
  actor: Actor,
): Promise<RecordAttendanceResult> {
  const { eventId, studentId, method, expectedMode } = input;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        await takeRosterSharedLock(tx);
        // Quoted fixed identifiers + parameterized value; re-reads below are
        // authoritative after the lock is held.
        await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR SHARE`;
        const event = await tx.event.findUnique({
          where: { id: eventId },
          include: { includedGroups: true },
        });
        if (!event) throw new RecordingError("Cannot create record with no event attached.", 404, "EVENT_NOT_FOUND");
        if (actor.role !== "ADMIN" && event.createdById !== actor.id && event.status !== "APPROVED") {
          throw new RecordingError("Forbidden", 403, "FORBIDDEN");
        }
        if (event.status !== "APPROVED") throw new RecordingError("Invalid event status", 409, "INVALID_STATUS");

        const operation: AttendanceMode = event.isTimeout ? "TIME_OUT" : "TIME_IN";
        if (expectedMode && expectedMode !== operation) {
          throw new RecordingError("Event mode changed. Review the current mode before recording.", 409, "EVENT_MODE_CHANGED");
        }

        const student = await tx.student.findFirst({
          where: { id: studentId, ...buildEventStudentFilter(event) },
          select: { id: true },
        });
        if (!student) throw new RecordingError("Student is not included in the event.", 404, "STUDENT_UNAVAILABLE");

        await takeRecordPairLock(tx, eventId, studentId);

        const existing = await tx.record.findUnique({
          where: { eventId_studentId: { eventId, studentId } },
        });
        const now = new Date();
        if (operation === "TIME_OUT") {
          if (!existing) {
            const record = await tx.record.create({
              data: { eventId, studentId, method, timeout: now, recordedById: actor.id },
            });
            return { record, changed: true, operation, created: true };
          }
          const changed = !existing.timeout && (await tx.record.updateMany({
            where: { id: existing.id, timeout: null },
            data: { timeout: now, lastModifiedById: actor.id },
          })).count > 0;
          const record = await tx.record.findUniqueOrThrow({ where: { id: existing.id } });
          return { record, changed: !!changed, operation, created: false };
        }

        if (!existing) {
          const record = await tx.record.create({
            data: { eventId, studentId, method, timein: now, recordedById: actor.id },
          });
          return { record, changed: true, operation, created: true };
        }
        const changed = !existing.timein && (await tx.record.updateMany({
          where: { id: existing.id, timein: null },
          data: { timein: now, lastModifiedById: actor.id },
        })).count > 0;
        const record = await tx.record.findUniqueOrThrow({ where: { id: existing.id } });
        return { record, changed: !!changed, operation, created: false };
      }, { maxWait: 1500, timeout: 4000 });
    } catch (error) {
      if (error instanceof RecordingError) throw error;
      if (isRetryableTransactionError(error) && attempt === 0) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
