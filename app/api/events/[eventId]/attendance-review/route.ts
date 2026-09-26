import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/globals/libs/prisma";
import { requireAuth } from "@/globals/utils/auth";
import { ok } from "@/globals/utils/api";
import { listAttendanceReview } from "@/features/attendance/server/attendanceReview";
import { respondWithCorrectionError } from "@/features/attendance/server/correctionHttp";

export async function GET(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const user = await requireAuth();
    const { eventId } = await params;
    const query = req.nextUrl.searchParams;
    const result = await listAttendanceReview(prisma, eventId, user, {
      search: query.get("search") ?? "", state: query.get("state") ?? "all",
      page: Number(query.get("page") ?? 1), pageSize: Number(query.get("pageSize") ?? 25),
    });
    return NextResponse.json(ok(result));
  } catch (error) { return respondWithCorrectionError(error); }
}
