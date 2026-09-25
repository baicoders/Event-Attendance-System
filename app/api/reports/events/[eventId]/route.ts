import { NextResponse } from "next/server";

import { err, ok } from "@/globals/utils/api";
import { requireAuth } from "@/globals/utils/auth";
import {
  buildEventReport,
  loadAuthorizedEventReportSnapshot,
} from "@/globals/utils/eventReport";
import { respondWithError } from "@/globals/utils/httpError";

/**
 * The full on-screen report for one event.
 *
 * Superset of `GET /api/events/[eventId]/stats` and
 * `GET /api/events/[eventId]/records?includeAbsent=true`, which are deliberately
 * left untouched — the live attendance screen polls them, and that is the one
 * screen operated under time pressure.
 *
 * @see globals/utils/eventReport.ts
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    const user = await requireAuth();
    const { eventId } = await params;

    const snapshot = await loadAuthorizedEventReportSnapshot(eventId, user);
    if (!snapshot) {
      return NextResponse.json(err("Event not found."), { status: 404 });
    }
    return NextResponse.json(ok(buildEventReport(snapshot)), { status: 200 });
  } catch (error) {
    return respondWithError(error);
  }
}
