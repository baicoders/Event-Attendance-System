import { prisma } from "@/globals/libs/prisma";
import { err, ok } from "@/globals/utils/api";
import { requireAuth } from "@/globals/utils/auth";
import { respondWithError } from "@/globals/utils/httpError";
import { NextRequest, NextResponse } from "next/server";
import { fillRecordById } from "@/features/attendance/server/fillRecordById";
import { RecordingError } from "@/features/attendance/server/recordAttendance";
import { correctAttendance, CorrectionError } from "@/features/attendance/server/correctAttendance";
import { readCorrectionBody, respondWithCorrectionError } from "@/features/attendance/server/correctionHttp";
import { z } from "zod";

const voidBodySchema = z.strictObject({ commandId: z.uuid(), expectedRevision: z.number().int().nonnegative(), reason: z.string() });

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  try {
    const user = await requireAuth();
    const { recordId } = await params;

    if (!req.body) return NextResponse.json(err("Reasoned correction is required", "CORRECTION_REQUIRED"), { status: 400 });
    let rawBody: unknown;
    try { rawBody = await readCorrectionBody(req); }
    catch (error) {
      if (error instanceof CorrectionError && error.code === "INVALID_PAYLOAD") {
        return NextResponse.json(err("Reasoned correction is required", "CORRECTION_REQUIRED"), { status: 400 });
      }
      throw error;
    }
    const body = voidBodySchema.safeParse(rawBody);
    if (!body.success) return NextResponse.json(err("Reasoned correction is required", "CORRECTION_REQUIRED"), { status: 400 });
    const record = await prisma.record.findUnique({ where: { id: recordId }, select: { eventId: true, studentId: true } });
    // A successful VOID removes the Record. Resolve an actor-scoped receipt so
    // an exact retry can still reach the command service's authorized replay.
    const prior = record ? null : await prisma.attendanceChange.findUnique({
      where: { actorId_commandId: { actorId: user.id, commandId: body.data.commandId } },
      select: { eventId: true, studentId: true, recordId: true, action: true },
    });
    const target = record ?? (prior?.action === "VOID" && prior.recordId === recordId ? prior : null);
    if (!target) return NextResponse.json(err("Record not found", "RECORD_CHANGED"), { status: 409 });
    const result = await correctAttendance(prisma, target.eventId, {
      ...body.data, action: "VOID", recordId, studentId: target.studentId,
    }, user);
    return NextResponse.json(ok(result));
  } catch (error) {
    return respondWithCorrectionError(error);
  }
}

/**
 * Updates the attendance of the record timein timeout of the record
 */
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  try {
    const user = await requireAuth();
    const { recordId } = await params;
    const result = await fillRecordById(prisma, recordId, user);
    return NextResponse.json(ok({ ...result.record, changed: result.changed }), { status: 200 });
  } catch (error) {
    if (error instanceof RecordingError) return NextResponse.json(err(error.message, error.code), { status: error.status });
    return respondWithError(error);
  }
}
