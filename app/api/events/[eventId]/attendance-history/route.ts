import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/globals/libs/prisma";
import { requireAuth } from "@/globals/utils/auth";
import { ok } from "@/globals/utils/api";
import { getAttendanceHistory } from "@/features/attendance/server/attendanceReview";
import { respondWithCorrectionError } from "@/features/attendance/server/correctionHttp";
import { CorrectionError } from "@/features/attendance/server/correctAttendance";

export async function GET(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const user = await requireAuth();
    const { eventId } = await params;
    const query = req.nextUrl.searchParams;
    const studentId = query.get("studentId");
    if (!studentId) throw new CorrectionError("studentId is required", 400, "INVALID_QUERY");
    const result = await getAttendanceHistory(prisma, eventId, studentId, user, {
      beforeId: query.get("beforeId") ?? undefined,
      limit: Number(query.get("limit") ?? 25),
    });
    return NextResponse.json(ok(result));
  } catch (error) { return respondWithCorrectionError(error); }
}
