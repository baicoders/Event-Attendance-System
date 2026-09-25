import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/globals/libs/prisma";
import { err, ok } from "@/globals/utils/api";
import { assertEventVisibility, requireAuth } from "@/globals/utils/auth";
import { respondWithError } from "@/globals/utils/httpError";
import { recordAttendance, RecordingError } from "@/features/attendance/server/recordAttendance";

const createRecordSchema = z.object({
  eventId: z.string().min(1),
  studentId: z.string().min(1),
  method: z.enum(["MANUAL", "SCANNED"]),
  expectedMode: z.enum(["TIME_IN", "TIME_OUT"]).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const input = createRecordSchema.parse(await req.json());
    const result = await recordAttendance(prisma, input, user);
    return NextResponse.json(ok({ ...result.record, changed: result.changed, operation: result.operation }),
      { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof RecordingError) {
      return NextResponse.json(err(error.message, error.code), { status: error.status });
    }
    return respondWithError(error);
  }
}

/**
 * Fetches attendance records scoped to an event the user is allowed to see.
 * eventId is required; add studentId for a single student's record.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();

    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get("eventId");
    const studentId = searchParams.get("studentId");

    if (!eventId) {
      return NextResponse.json(
        err("eventId query parameter is required."),
        { status: 400 }
      );
    }

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      return NextResponse.json(err("Event not found."), { status: 404 });
    }

    assertEventVisibility(event, user);

    if (studentId) {
      const record = await prisma.record.findUnique({
        where: { eventId_studentId: { eventId, studentId } },
      });

      return NextResponse.json(ok(record), { status: 200 });
    }

    const records = await prisma.record.findMany({
      where: { eventId },
    });

    return NextResponse.json(ok(records), { status: 200 });
  } catch (error) {
    return respondWithError(error);
  }
}
