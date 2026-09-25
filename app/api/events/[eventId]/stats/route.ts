import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/globals/libs/prisma";
import { err, ok } from "@/globals/utils/api";
import { buildEventStudentFilter } from "@/globals/utils/buildEventStudentFilter";
import { assertEventVisibility, requireAuth } from "@/globals/utils/auth";
import { respondWithError } from "@/globals/utils/httpError";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    const user = await requireAuth();
    const { eventId } = await params;

    const result = await prisma.$transaction(async (tx) => {
      const event = await tx.event.findUnique({ where: { id: eventId }, include: { includedGroups: true } });
      if (!event) return null;
      assertEventVisibility(event, user);
      const eligibleFilter = buildEventStudentFilter(event);
      const eligible = await tx.student.count({ where: eligibleFilter });
      const present = await tx.record.count({ where: { eventId, timein: { not: null }, student: eligibleFilter } });
      return { eligible, present };
    });
    if (!result) return NextResponse.json(err("Event not found."), { status: 404 });
    const eligibleStudentsCount = result.eligible;
    const presentStudentsCount = result.present;

    const absentStudentsCount = Math.max(
      eligibleStudentsCount - presentStudentsCount,
      0
    );

    return NextResponse.json(
      ok({
        eligible: eligibleStudentsCount,
        present: presentStudentsCount,
        absent: absentStudentsCount,
      }),
      { status: 200 },
    );
  } catch (error) {
    return respondWithError(error);
  }
}
