import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/globals/libs/prisma";
import { requireAuth } from "@/globals/utils/auth";
import { err, ok } from "@/globals/utils/api";
import { respondWithError } from "@/globals/utils/httpError";
import { parseProgressQuery, ProgressQueryError } from "@/globals/utils/attendanceProgressQuery";
import { readAttendanceProgress, ProgressReadError } from "@/globals/utils/attendanceProgressRead";

export async function GET(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const user = await requireAuth();
    const { eventId } = await params;
    const query = parseProgressQuery(req.nextUrl.searchParams);
    const progress = await readAttendanceProgress(prisma, eventId, user, query);
    return NextResponse.json(ok(progress));
  } catch (error) {
    if (error instanceof ProgressQueryError) return NextResponse.json(err(error.message, error.code), { status: 400 });
    if (error instanceof ProgressReadError) return NextResponse.json(err(error.message, error.code), { status: error.status });
    return respondWithError(error);
  }
}
