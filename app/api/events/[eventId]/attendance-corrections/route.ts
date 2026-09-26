import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/globals/libs/prisma";
import { requireAuth } from "@/globals/utils/auth";
import { ok } from "@/globals/utils/api";
import { correctAttendance } from "@/features/attendance/server/correctAttendance";
import { readCorrectionBody, respondWithCorrectionError } from "@/features/attendance/server/correctionHttp";

export async function POST(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const user = await requireAuth();
    const { eventId } = await params;
    const body = await readCorrectionBody(req);
    const result = await correctAttendance(prisma, eventId, body, user);
    return NextResponse.json(ok(result));
  } catch (error) { return respondWithCorrectionError(error); }
}
