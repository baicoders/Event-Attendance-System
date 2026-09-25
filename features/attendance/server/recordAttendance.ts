import { PrismaClient, type Record as AttendanceRecord } from "@prisma/client";
import { buildEventStudentFilter } from "@/globals/utils/buildEventStudentFilter";

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

/** A mode read and its attendance write share one SQLite transaction. */
export async function recordAttendance(
  db: PrismaClient,
  input: RecordAttendanceInput,
  actor: Actor,
): Promise<RecordAttendanceResult> {
  const { eventId, studentId, method, expectedMode } = input;
  return db.$transaction(async (tx) => {
    // SQLite deferred transactions can deadlock when several readers all try
    // to upgrade to writers. Take the event-row write lock before reading
    // mode/eligibility so competing scans and mode changes linearize safely.
    // This raw no-op does not touch Prisma's @updatedAt column.
    await tx.$executeRaw`UPDATE Event SET isTimeout = isTimeout WHERE id = ${eventId}`;
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

    const existing = await tx.record.findUnique({
      where: { eventId_studentId: { eventId, studentId } },
    });
    const now = new Date();
    if (operation === "TIME_OUT") {
      if (!existing?.timein) throw new RecordingError("Student has not timed in for this event.", 409, "NO_TIME_IN");
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
}
