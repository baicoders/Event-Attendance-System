import { prisma } from "@/globals/libs/prisma";
import { err, ok } from "@/globals/utils/api";
import {
  assertEventOwnership,
  assertEventStatus,
  assertEventVisibility,
  requireAuth,
} from "@/globals/utils/auth";
import { respondWithError } from "@/globals/utils/httpError";
import { takeRecordPairLock, takeRosterSharedLock } from "@/globals/utils/pgLocks";
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  try {
    const user = await requireAuth();
    const { recordId } = await params;

    const deletedRecord = await prisma.$transaction(async (tx) => {
      await takeRosterSharedLock(tx);
      const record = await tx.record.findUnique({
        where: { id: recordId },
        include: { event: true },
      });
      if (!record) return null;
      // Only the event's owner or an admin may erase attendance evidence.
      assertEventOwnership(record.event, user);
      // Lock the Event for share and the pair exclusively so a concurrent
      // scan cannot recreate/rewrite the row mid-delete.
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${record.eventId} FOR SHARE`;
      await takeRecordPairLock(tx, record.eventId, record.studentId);
      // Re-read after locking: ownership could have changed under us.
      const fresh = await tx.record.findUnique({
        where: { id: recordId },
        include: { event: true },
      });
      if (!fresh) return null;
      assertEventOwnership(fresh.event, user);
      return tx.record.delete({ where: { id: recordId } });
    });

    if (!deletedRecord) {
      return NextResponse.json(err("Record not found"), { status: 404 });
    }

    console.info(
      `[audit] record ${recordId} (event ${deletedRecord.eventId}, student ${deletedRecord.studentId}) deleted by user ${user.id}`
    );

    return NextResponse.json(ok(deletedRecord), { status: 200 });
  } catch (error) {
    return respondWithError(error);
  }
}

/**
 * Updates the attendance of the record timein timeout of the record
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  try {
    const user = await requireAuth();
    const { recordId } = await params;

    const result = await prisma.$transaction(async (tx) => {
      await takeRosterSharedLock(tx);
      const record = await tx.record.findUnique({
        where: { id: recordId },
        include: { event: true },
      });
      if (!record) return null;
      if (!record?.event) return { missingEvent: true as const };
      // Attendance can only be updated on approved events the user can see.
      assertEventVisibility(record.event, user);
      assertEventStatus(record.event, "APPROVED");
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${record.eventId} FOR SHARE`;
      await takeRecordPairLock(tx, record.eventId, record.studentId);
      // Re-read mode after locking so a concurrent mode flip cannot mix in.
      const fresh = await tx.record.findUnique({
        where: { id: recordId },
        include: { event: true },
      });
      if (!fresh || !fresh.event) return null;
      assertEventVisibility(fresh.event, user);
      assertEventStatus(fresh.event, "APPROVED");

      const recordedAt = new Date();

      // Scan rules: exactly one scan each for time-in and time-out. Writes are conditional
      // (compare-and-set) so concurrent requests cannot overwrite the first.
      // `changed` distinguishes a real update from a repeat action, so the table
      // doesn't falsely report "Attendance updated" on a no-op.
      let changed = false;
      if (fresh.event.isTimeout) {
        if (!fresh.timeout) {
          const res = await tx.record.updateMany({
            where: { id: fresh.id, timeout: null },
            data: { timeout: recordedAt, lastModifiedById: user.id },
          });
          changed = res.count > 0;
        }
      } else if (!fresh.timein) {
        const res = await tx.record.updateMany({
          where: { id: fresh.id, timein: null },
          data: { timein: recordedAt, lastModifiedById: user.id },
        });
        changed = res.count > 0;
      }

      const updatedRecord = await tx.record.findUnique({ where: { id: fresh.id } });
      return { updatedRecord, changed };
    });

    if (!result || !("updatedRecord" in result) || !result.updatedRecord) {
      if (result && "missingEvent" in result) {
        return NextResponse.json(
          err("Cannot update record with no event attached"),
          { status: 404 }
        );
      }
      return NextResponse.json(err("Record not found"), { status: 404 });
    }

    return NextResponse.json(ok({ ...result.updatedRecord, changed: result.changed }), { status: 200 });
  } catch (error) {
    return respondWithError(error);
  }
}
