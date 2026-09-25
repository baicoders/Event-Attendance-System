import { NextResponse } from "next/server";

import { err, ok } from "@/globals/utils/api";
import { requireAuth } from "@/globals/utils/auth";
import { buildEventReport, loadAuthorizedEventReportSnapshot, ReportAudienceTooLargeError } from "@/globals/utils/eventReport";
import { respondWithError } from "@/globals/utils/httpError";
import { serializeCsv } from "@/globals/utils/csvExport";
import { exportRequestSchema, prepareEventExport } from "@/features/reports/utils/eventExport";

const MAX_STUDENTS = 10_000;
const MAX_BYTES = 10 * 1024 * 1024;

export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const query = new URL(req.url).searchParams;
    const input = exportRequestSchema.parse(Object.fromEntries(query));
    if ([...query.keys()].length !== new Set(query.keys()).size) {
      return NextResponse.json(err("Duplicate export parameters."), { status: 400 });
    }
    const user = await requireAuth();
    const { eventId } = await params;
    const snapshot = await loadAuthorizedEventReportSnapshot(eventId, user, MAX_STUDENTS);
    if (!snapshot) return NextResponse.json(err("Event not found."), { status: 404 });
    const prepared = prepareEventExport(buildEventReport(snapshot), input.preset, input.groupBy);
    const response = JSON.stringify(ok(prepared));
    const csv = serializeCsv(prepared.columns.map((column) => column.label), prepared.rows);
    if (Buffer.byteLength(response, "utf8") > MAX_BYTES || Buffer.byteLength(csv, "utf8") > MAX_BYTES) {
      return NextResponse.json(err("Prepared export exceeds 10 MiB.", "EXPORT_TOO_LARGE"), { status: 413 });
    }
    return new NextResponse(response, {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof ReportAudienceTooLargeError) return NextResponse.json(err(error.message, "EXPORT_TOO_LARGE"), { status: 413 });
    return respondWithError(error);
  }
}
